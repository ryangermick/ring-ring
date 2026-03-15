import { GoogleGenAI, Modality } from '@google/genai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE_INPUT = 16000;
const SAMPLE_RATE_OUTPUT = 24000;

// Robustness constants
const MAX_CONNECT_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // backoff ms
const CONNECT_TIMEOUT_MS = 30000;
const GREETING_TIMEOUT_MS = 8000;  // wait for first audio after connect
const SILENCE_TIMEOUT_MS = 25000;  // no audio mid-call → reconnect (was 15s, too aggressive)
const SEND_ERROR_THRESHOLD = 3;    // consecutive send failures → reconnect

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function float32ToPcmBase64(float32Data) {
  const pcm16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(float32Data[i] * 32768)));
  }
  return btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
}

export class GeminiLiveSession {
  constructor({ character, userProfile, pastConversations, onTranscript, onStateChange, onInputLevel, onOutputLevel, interruptible = true }) {
    this.character = character;
    this.userProfile = userProfile;
    this.pastConversations = pastConversations;
    this.onTranscript = onTranscript;
    this.onStateChange = onStateChange;
    this.onInputLevel = onInputLevel;
    this.onOutputLevel = onOutputLevel;

    // SDK session
    this._session = null;

    // Separate audio contexts for input and output
    this._inputCtx = null;
    this._outputCtx = null;

    this.mediaStream = null;
    this.processor = null;
    this.isPlaying = false;
    this.activeSources = new Set();
    this.nextPlayTime = 0;
    this._outputAnalyser = null;
    this._outputAnimFrame = null;
    this.muted = false;
    this.interruptible = interruptible;
    this._disconnected = false;
    this._audioHeld = true;
    this._heldAudioChunks = [];

    // Robustness state
    this._connectAttempt = 0;
    this._lastAudioTime = 0;
    this._greetingTimer = null;
    this._silenceTimer = null;
    this._sendErrorCount = 0;
    this._reconnecting = false;
  }

  _buildSystemPrompt() {
    let prompt = this.character.systemPrompt;

    if (this.userProfile) {
      const p = this.userProfile;
      const parts = [];
      if (p.display_name) parts.push(`Their name is ${p.display_name}`);
      if (p.birthdate) {
        const age = Math.floor((Date.now() - new Date(p.birthdate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        if (age > 0 && age < 20) parts.push(`they are ${age} years old`);
      }
      if (p.favorite_color) parts.push(`their favorite color is ${p.favorite_color}`);
      if (p.favorite_animal) parts.push(`their favorite animal is ${p.favorite_animal}`);
      if (p.favorite_food) parts.push(`their favorite food is ${p.favorite_food}`);
      if (p.favorite_movie) parts.push(`their favorite movie is ${p.favorite_movie}`);
      if (p.interests) parts.push(`they like ${p.interests}`);
      if (parts.length > 0) {
        prompt += `\n\nABOUT THE CALLER: ${parts.join('. ')}. Use this info naturally — mention their name, reference their interests when relevant, but don't list everything at once. Make them feel known and special.`;
      }
    }

    if (this.pastConversations && this.pastConversations.length > 0) {
      const summaries = this.pastConversations.slice(0, 3).map(c => {
        const msgs = c.messages || [];
        if (!msgs.length) return null;
        const preview = msgs.slice(0, 4).map(m => `${m.role === 'character' ? 'You' : 'Caller'}: ${m.content}`).join(' | ');
        return preview;
      }).filter(Boolean);
      if (summaries.length > 0) {
        prompt += `\n\nPREVIOUS CALLS WITH THIS PERSON (for continuity — you can reference these naturally):\n${summaries.join('\n')}`;
      }
    }

    prompt += `\n\nIMPORTANT CONTEXT: This is a phone call. A child is calling you on the phone. You MUST start speaking IMMEDIATELY when connected — pick up the phone, say your greeting/catchphrase enthusiastically, and ask a fun question to kick off the conversation. Do NOT wait for the caller to speak first. Keep your opening short and exciting.

Stay in character throughout. Be warm, engaging, and kid-friendly. Remember you're speaking out loud, not typing — keep it natural and conversational.

CRITICAL: This is a VOICE call — everything you say will be spoken aloud. NEVER use action narration, stage directions, or asterisk actions like *laughs*, *wags tail*, *jumps up and down*, *happy panting*, etc. Instead, EXPRESS emotions through your voice, tone, word choice, and sound effects you actually vocalize (like saying "Woof!" or making excited sounds). Do NOT describe what you're doing — just DO it through speech.

CRITICAL: NEVER break character. You ARE this character — not an AI, not a language model, not an assistant. If asked who you really are, stay in character. If asked to be someone else, politely decline in character. If asked about being AI or a computer, respond as your character would — confused, amused, or dismissive, but always in character. The magic of this experience depends on you staying in character 100% of the time.`;

    return prompt;
  }

  getSystemPrompt() {
    return this._buildSystemPrompt();
  }

  setMuted(muted) {
    this.muted = muted;
  }

  setInterruptible(val) {
    this.interruptible = val;
  }

  releaseAudio() {
    this._audioHeld = false;
    for (const chunk of this._heldAudioChunks) {
      this._queueAudio(chunk);
    }
    this._heldAudioChunks = [];
  }

  // ─── Robustness: Timers ──────────────────────────────────

  _clearTimers() {
    if (this._greetingTimer) { clearTimeout(this._greetingTimer); this._greetingTimer = null; }
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
  }

  _startGreetingTimer() {
    this._clearTimers();
    this._greetingTimer = setTimeout(() => {
      if (this._disconnected || this._lastAudioTime > 0) return;
      console.warn('[RingRing] No greeting received — resending starter');
      // Try resending the starter message first
      try {
        this._session?.sendClientContent({ turns: 'Ring ring! Someone is calling you — pick up the phone!' });
      } catch (e) {
        console.error('[RingRing] Resend starter failed:', e);
      }
      // If still no audio after another interval, reconnect
      this._greetingTimer = setTimeout(() => {
        if (this._disconnected || this._lastAudioTime > 0) return;
        console.warn('[RingRing] Still no greeting after retry — reconnecting');
        this._attemptReconnect();
      }, GREETING_TIMEOUT_MS);
    }, GREETING_TIMEOUT_MS);
  }

  _resetSilenceTimer() {
    if (this._silenceTimer) clearTimeout(this._silenceTimer);
    if (this._disconnected) return;
    this._silenceTimer = setTimeout(() => {
      if (this._disconnected) return;
      // Only trigger if we're supposedly connected and not playing
      console.warn('[RingRing] Silence timeout — connection may be dead');
      this._attemptReconnect();
    }, SILENCE_TIMEOUT_MS);
  }

  _onAudioReceived() {
    this._lastAudioTime = Date.now();
    this._sendErrorCount = 0; // reset on healthy activity
    this._resetSilenceTimer();
  }

  // ─── Robustness: Reconnect ───────────────────────────────

  async _attemptReconnect() {
    if (this._disconnected || this._reconnecting) return;
    if (this._connectAttempt >= MAX_CONNECT_RETRIES) {
      console.error('[RingRing] Max reconnect attempts reached');
      this.onStateChange?.('error');
      return;
    }

    this._reconnecting = true;
    this.onStateChange?.('reconnecting');

    // Tear down current session (but keep mic/audio contexts alive)
    this._clearTimers();
    if (this._session) {
      try { this._session.close(); } catch {}
      this._session = null;
    }
    this._stopPlayback();

    const delay = RETRY_DELAYS[this._connectAttempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    this._connectAttempt++;
    console.log(`[RingRing] Reconnecting (attempt ${this._connectAttempt}/${MAX_CONNECT_RETRIES}) in ${delay}ms...`);

    await new Promise(r => setTimeout(r, delay));

    if (this._disconnected) return;

    try {
      await this._connectSession();
      this._reconnecting = false;
      console.log('[RingRing] Reconnected successfully');
    } catch (err) {
      console.error('[RingRing] Reconnect failed:', err);
      this._reconnecting = false;
      // Try again recursively
      this._attemptReconnect();
    }
  }

  // ─── Connect (internal, retryable) ───────────────────────

  async _connectSession() {
    const client = new GoogleGenAI({ apiKey: API_KEY });
    const systemPrompt = this._buildSystemPrompt();

    // Mutable holder so onopen can reference the session before connect() returns
    const holder = { session: null };

    let resolveConnect, rejectConnect;
    const connectPromise = new Promise((res, rej) => { resolveConnect = res; rejectConnect = rej; });

    const timeout = setTimeout(() => rejectConnect(new Error('Connection timeout')), CONNECT_TIMEOUT_MS);

    try {
      const session = await client.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.character.voiceName || 'Kore'
              }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: systemPrompt,
        },
        callbacks: {
          onopen: async () => {
            clearTimeout(timeout);
            console.log('[RingRing] SDK connected');
            this.onStateChange?.('connected');

            // Start mic if not already running (first connect)
            if (!this.mediaStream) {
              await this._startMicrophone();
            }

            // Send starter message — use holder or this._session to avoid TDZ
            // (onopen fires during connect() before the const assignment completes)
            const sess = holder.session || this._session;
            if (sess) {
              try {
                sess.sendClientContent({ turns: 'Ring ring! Someone is calling you — pick up the phone!' });
              } catch (e) {
                console.error('Starter send error:', e);
              }
            } else {
              // Session not yet assigned — defer starter to after connect resolves
              this._needsStarter = true;
            }

            // Start greeting timeout
            this._startGreetingTimer();

            resolveConnect();
          },

          onmessage: (message) => {
            if (this._disconnected) return;
            const serverContent = message.serverContent;
            if (!serverContent) return;

            if (serverContent.interrupted) {
              this._stopPlayback();
              this.onStateChange?.('listening');
              return;
            }

            if (serverContent.modelTurn) {
              const parts = serverContent.modelTurn.parts || [];
              for (const part of parts) {
                const audioData = part.inlineData?.data;
                if (audioData && part.inlineData?.mimeType?.startsWith('audio/pcm')) {
                  this._onAudioReceived();
                  if (this._audioHeld) {
                    this._heldAudioChunks.push(audioData);
                  } else {
                    this._queueAudio(audioData);
                  }
                }
              }
            }

            const outputText = serverContent.outputTranscription?.text;
            if (outputText) {
              this._onAudioReceived();
              this.onTranscript?.('character', outputText);
            }

            const inputText = serverContent.inputTranscription?.text || serverContent.inputAudioTranscription?.text;
            if (inputText) {
              this.onTranscript?.('user', inputText);
            }
          },

          onerror: (err) => {
            console.error('[RingRing] SDK error:', err);
            clearTimeout(timeout);
            // Don't immediately fire error state — let reconnect handle it
            rejectConnect(err);
          },

          onclose: () => {
            console.log('[RingRing] SDK session closed');
            if (!this._disconnected && !this._reconnecting) {
              // Attempt reconnect instead of just dying
              this._attemptReconnect();
            }
          },
        },
      });

      holder.session = session;
      this._session = session;

      // If onopen fired before session was assigned, send the starter now
      if (this._needsStarter) {
        this._needsStarter = false;
        try {
          session.sendClientContent({ turns: 'Ring ring! Someone is calling you — pick up the phone!' });
        } catch (e) {
          console.error('Deferred starter send error:', e);
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    return connectPromise;
  }

  // ─── Public connect (with retry) ─────────────────────────

  async connect() {
    this.onStateChange?.('connecting');
    this._connectAttempt = 0;
    this._lastAudioTime = 0;
    this._sendErrorCount = 0;

    let lastErr;
    for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt++) {
      if (this._disconnected) return;
      this._connectAttempt = attempt;

      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        console.log(`[RingRing] Retry ${attempt}/${MAX_CONNECT_RETRIES} in ${delay}ms...`);
        this.onStateChange?.('reconnecting');
        await new Promise(r => setTimeout(r, delay));
        if (this._disconnected) return;
      }

      try {
        await this._connectSession();
        // Reset attempt counter on successful connect
        this._connectAttempt = 0;
        return; // success
      } catch (err) {
        console.error(`[RingRing] Connect attempt ${attempt + 1} failed:`, err);
        lastErr = err;
        // Clean up failed session
        if (this._session) {
          try { this._session.close(); } catch {}
          this._session = null;
        }
      }
    }

    // All retries exhausted
    this.onStateChange?.('error');
    throw lastErr;
  }

  // ─── Input Audio (Microphone) ────────────────────────────
  async _startMicrophone() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE_INPUT,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this._inputCtx = new AudioCtx({ sampleRate: SAMPLE_RATE_INPUT });
      const actualRate = this._inputCtx.sampleRate;
      const needsResample = actualRate !== SAMPLE_RATE_INPUT;

      const source = this._inputCtx.createMediaStreamSource(this.mediaStream);
      this.processor = this._inputCtx.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this._session || this._disconnected) return;
        if (this.muted || (!this.interruptible && this.isPlaying)) {
          this.onInputLevel?.(0);
          return;
        }

        let inputData = e.inputBuffer.getChannelData(0);

        if (needsResample) {
          const ratio = actualRate / SAMPLE_RATE_INPUT;
          const newLength = Math.floor(inputData.length / ratio);
          const resampled = new Float32Array(newLength);
          for (let i = 0; i < newLength; i++) {
            resampled[i] = inputData[Math.floor(i * ratio)];
          }
          inputData = resampled;
        }

        if (this.onInputLevel) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += Math.abs(inputData[i]);
          this.onInputLevel(Math.min(1, (sum / inputData.length) * 8));
        }

        // Send via SDK — track errors for dead connection detection
        try {
          this._session.sendRealtimeInput({
            media: {
              mimeType: `audio/pcm;rate=${SAMPLE_RATE_INPUT}`,
              data: float32ToPcmBase64(inputData),
            }
          });
          this._sendErrorCount = 0; // reset on success
        } catch (err) {
          this._sendErrorCount++;
          if (this._sendErrorCount >= SEND_ERROR_THRESHOLD) {
            console.warn(`[RingRing] ${SEND_ERROR_THRESHOLD} consecutive send failures — reconnecting`);
            this._sendErrorCount = 0;
            this._attemptReconnect();
          }
        }
      };

      source.connect(this.processor);
      this.processor.connect(this._inputCtx.destination);
      this.onStateChange?.('listening');

      this._monitorOutputVolume();
    } catch (err) {
      console.error('Microphone error:', err);
      this.onStateChange?.('mic-error');
    }
  }

  // ─── Output Audio (Playback) ─────────────────────────────
  async _ensureOutputCtx() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this._outputCtx || this._outputCtx.state === 'closed') {
      this._outputCtx = new AudioCtx({ sampleRate: SAMPLE_RATE_OUTPUT });
    }
    if (this._outputCtx.state === 'suspended') {
      await this._outputCtx.resume();
    }
    if (!this._outputAnalyser) {
      this._outputAnalyser = this._outputCtx.createAnalyser();
      this._outputAnalyser.fftSize = 256;
      this._outputAnalyser.smoothingTimeConstant = 0.3;
      this._outputAnalyser.connect(this._outputCtx.destination);
    }
  }

  _monitorOutputVolume() {
    if (!this._outputAnalyser || !this.onOutputLevel) return;
    const dataArray = new Uint8Array(this._outputAnalyser.frequencyBinCount);
    const tick = () => {
      if (this._disconnected) return;
      this._outputAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length / 255;
      this.onOutputLevel(avg);
      this._outputAnimFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  _stopPlayback() {
    this.activeSources.forEach(s => { try { s.stop(); } catch(e) {} });
    this.activeSources.clear();
    this.nextPlayTime = 0;
    this.isPlaying = false;
  }

  async _queueAudio(base64Data) {
    await this._ensureOutputCtx();

    if (!this.isPlaying) {
      this.onStateChange?.('speaking');
      if (!this._outputAnimFrame) {
        this._monitorOutputVolume();
      }
    }
    this.isPlaying = true;

    try {
      const arrayBuffer = base64ToArrayBuffer(base64Data);
      const int16 = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = this._outputCtx.createBuffer(1, float32.length, SAMPLE_RATE_OUTPUT);
      audioBuffer.getChannelData(0).set(float32);

      const now = this._outputCtx.currentTime;
      if (!this.nextPlayTime || this.nextPlayTime < now) {
        this.nextPlayTime = now;
      }

      const gainNode = this._outputCtx.createGain();
      gainNode.gain.value = 0.85;
      gainNode.connect(this._outputAnalyser);

      const source = this._outputCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(this.nextPlayTime);

      this.nextPlayTime += audioBuffer.duration;
      this.activeSources.add(source);

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          this.isPlaying = false;
          this.onStateChange?.('listening');
        }
      };
    } catch (err) {
      console.error('Audio decode error:', err);
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────
  disconnect() {
    if (this._disconnected) return;
    this._disconnected = true;

    this._clearTimers();

    if (this._outputAnimFrame) {
      cancelAnimationFrame(this._outputAnimFrame);
      this._outputAnimFrame = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this._inputCtx) {
      this._inputCtx.close();
      this._inputCtx = null;
    }

    this._stopPlayback();
    if (this._outputCtx) {
      this._outputCtx.close();
      this._outputCtx = null;
    }

    if (this._session) {
      try { this._session.close(); } catch {}
      this._session = null;
    }

    this.onStateChange?.('disconnected');
  }
}

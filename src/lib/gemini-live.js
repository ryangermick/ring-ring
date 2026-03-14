import { GoogleGenAI, Modality } from '@google/genai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE_INPUT = 16000;
const SAMPLE_RATE_OUTPUT = 24000;

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
    this._inputCtx = null;   // 16 kHz for mic capture
    this._outputCtx = null;  // 24 kHz for playback

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
  }

  _buildSystemPrompt() {
    let prompt = this.character.systemPrompt;

    // Add user profile context
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

    // Add past conversation summaries
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
    // Flush any audio that arrived during the ring period
    for (const chunk of this._heldAudioChunks) {
      this._queueAudio(chunk);
    }
    this._heldAudioChunks = [];
  }

  async connect() {
    this.onStateChange?.('connecting');

    const client = new GoogleGenAI({ apiKey: API_KEY });
    const systemPrompt = this._buildSystemPrompt();

    // Track whether onopen has fired for starter message
    let resolveConnect, rejectConnect;
    const connectPromise = new Promise((res, rej) => { resolveConnect = res; rejectConnect = rej; });

    // Connection timeout
    const timeout = setTimeout(() => rejectConnect(new Error('Connection timeout')), 30000);

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

            // Start microphone capture
            await this._startMicrophone();

            // Send starter message to trigger character greeting
            try {
              session.sendClientContent({ turns: 'Ring ring! Someone is calling you — pick up the phone!' });
            } catch (e) {
              console.error('Starter send error:', e);
            }

            resolveConnect();
          },

          onmessage: (message) => {
            if (this._disconnected) return;
            const serverContent = message.serverContent;
            if (!serverContent) return;

            // Handle interruption
            if (serverContent.interrupted) {
              this._stopPlayback();
              this.onStateChange?.('listening');
              return;
            }

            // Handle audio data
            if (serverContent.modelTurn) {
              const parts = serverContent.modelTurn.parts || [];
              for (const part of parts) {
                const audioData = part.inlineData?.data;
                if (audioData && part.inlineData?.mimeType?.startsWith('audio/pcm')) {
                  if (this._audioHeld) {
                    this._heldAudioChunks.push(audioData);
                  } else {
                    this._queueAudio(audioData);
                  }
                }
              }
            }

            // Capture spoken transcription (what the user hears)
            const outputText = serverContent.outputTranscription?.text;
            if (outputText) {
              this.onTranscript?.('character', outputText);
            }

            // Capture user's spoken words
            const inputText = serverContent.inputTranscription?.text || serverContent.inputAudioTranscription?.text;
            if (inputText) {
              this.onTranscript?.('user', inputText);
            }
          },

          onerror: (err) => {
            console.error('[RingRing] SDK error:', err);
            clearTimeout(timeout);
            this.onStateChange?.('error');
            rejectConnect(err);
          },

          onclose: () => {
            console.log('[RingRing] SDK session closed');
            if (!this._disconnected) {
              this.disconnect();
            }
          },
        },
      });

      this._session = session;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    return connectPromise;
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

      // Dedicated input AudioContext at 16kHz
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

        // Downsample if browser didn't honor 16kHz request
        if (needsResample) {
          const ratio = actualRate / SAMPLE_RATE_INPUT;
          const newLength = Math.floor(inputData.length / ratio);
          const resampled = new Float32Array(newLength);
          for (let i = 0; i < newLength; i++) {
            resampled[i] = inputData[Math.floor(i * ratio)];
          }
          inputData = resampled;
        }

        // Calculate input level for visualizer
        if (this.onInputLevel) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += Math.abs(inputData[i]);
          this.onInputLevel(Math.min(1, (sum / inputData.length) * 8));
        }

        // Send via SDK
        try {
          this._session.sendRealtimeInput({
            media: {
              mimeType: `audio/pcm;rate=${SAMPLE_RATE_INPUT}`,
              data: float32ToPcmBase64(inputData),
            }
          });
        } catch (err) {
          // Session may have closed
        }
      };

      source.connect(this.processor);
      this.processor.connect(this._inputCtx.destination);
      this.onStateChange?.('listening');

      // Start output volume monitoring
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

    if (this._outputAnimFrame) {
      cancelAnimationFrame(this._outputAnimFrame);
      this._outputAnimFrame = null;
    }

    // Stop mic
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

    // Stop playback
    this._stopPlayback();
    if (this._outputCtx) {
      this._outputCtx.close();
      this._outputCtx = null;
    }

    // Close SDK session
    if (this._session) {
      try { this._session.close(); } catch {}
      this._session = null;
    }

    this.onStateChange?.('disconnected');
  }
}

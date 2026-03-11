import { authFetch } from './api';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

async function blobToJSON(blob) {
  const text = await blob.text();
  return JSON.parse(text);
}

function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export class GeminiLiveClonedSession {
  constructor({ character, userProfile, pastConversations, onTranscript, onStateChange, onInputLevel, onOutputLevel, clonedVoiceId }) {
    this.character = character;
    this.userProfile = userProfile;
    this.pastConversations = pastConversations;
    this.onTranscript = onTranscript;
    this.onStateChange = onStateChange;
    this.onInputLevel = onInputLevel;
    this.onOutputLevel = onOutputLevel;
    this.clonedVoiceId = clonedVoiceId;
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.isPlaying = false;
    this.activeSources = [];
    this.setupComplete = false;
    this.outputAnalyser = null;
    this._outputAnimFrame = null;
    this._textBuffer = '';
    this._activeAbortControllers = [];
    this._nextPlayTime = 0;
    this._sentenceQueue = [];
    this._ttsFirstSentenceTime = null;
    this._ttsFirstChunkPlayed = false;
    this._transcriptBuffer = '';
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

    prompt += `\n\nIMPORTANT CONTEXT: This is a phone call. A child is calling you on the phone. Answer like you're picking up a phone call — start with your greeting as if answering the phone. Stay in character throughout the conversation. Be warm, engaging, and kid-friendly. Remember you're speaking out loud, not typing — keep it natural and conversational.\n\nCRITICAL: NEVER break character. You ARE this character — not an AI, not a language model, not an assistant. If asked who you really are, stay in character. If asked to be someone else, politely decline in character. If asked about being AI or a computer, respond as your character would — confused, amused, or dismissive, but always in character. The magic of this experience depends on you staying in character 100% of the time.`;

    return prompt;
  }

  getSystemPrompt() {
    return this._buildSystemPrompt();
  }

  async connect() {
    this.onStateChange?.('connecting');

    this.ws = new WebSocket(WS_URL);

    return new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        const setupMessage = {
          setup: {
            model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: 'Kore'
                  }
                }
              },
            },
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: this._buildSystemPrompt() }]
            }
          }
        };
        this.ws.send(JSON.stringify(setupMessage));
      };

      this.ws.onmessage = async (event) => {
        let data;
        try {
        if (event.data instanceof Blob) {
          data = await blobToJSON(event.data);
        } else {
          data = JSON.parse(event.data);
        }
        console.log('[cloned] WS message:', JSON.stringify(data).slice(0, 300));

        if (data.setupComplete) {
          this.setupComplete = true;
          this.onStateChange?.('connected');
          this._startMicrophone();

          this.ws.send(JSON.stringify({
            clientContent: {
              turns: [{
                role: 'user',
                parts: [{ text: `A child just called you! Greet them enthusiastically in character. Say your catchphrase and ask them a fun question to start the conversation. Keep it short and exciting — you're picking up the phone!` }]
              }],
              turnComplete: true
            }
          }));

          resolve();
          return;
        }

        if (data.serverContent) {
          const { serverContent } = data;

          if (serverContent.interrupted) {
            this._handleInterruption();
            return;
          }

          // IGNORE Gemini's native audio — we don't play it

          // Capture the transcription of what Gemini said — process incrementally for streaming TTS
          if (serverContent.outputTranscription?.text) {
            const chunk = serverContent.outputTranscription.text;
            console.log('[cloned] outputTranscription chunk:', JSON.stringify(chunk));
            this._processTranscriptionChunk(chunk);
          }

          // Capture user's spoken words
          if (serverContent.inputTranscription?.text) {
            this.onTranscript?.('user', serverContent.inputTranscription.text);
          }

          // When the turn is complete, flush remaining text buffer
          if (serverContent.turnComplete) {
            this._flushTextBuffer();
          }
        }
        } catch (msgErr) {
          console.error('[cloned] Error in WS message handler:', msgErr);
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        this.onStateChange?.('error');
        reject(err);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.onStateChange?.('disconnected');
      };

      setTimeout(() => reject(new Error('Connection timeout')), 15000);
    });
  }

  _processTranscriptionChunk(chunk) {
    this._textBuffer += chunk;

    // Split on sentence endings (. ! ? followed by space or at end of buffer)
    const sentenceEnd = /[.!?](?:\s|$)/g;
    let match;
    let lastIndex = 0;
    const sentences = [];

    while ((match = sentenceEnd.exec(this._textBuffer)) !== null) {
      const sentence = this._textBuffer.slice(lastIndex, match.index + 1).trim();
      if (sentence.length > 5) {
        sentences.push(sentence);
      }
      lastIndex = match.index + match[0].length;
    }

    this._textBuffer = this._textBuffer.slice(lastIndex);

    for (const sentence of sentences) {
      // Report transcript for each sentence
      this.onTranscript?.('character', sentence + ' ');
      this._streamSynthesizeAndPlay(sentence);
    }
  }

  _flushTextBuffer() {
    const remaining = this._textBuffer.trim();
    this._textBuffer = '';
    if (remaining.length > 2) {
      this.onTranscript?.('character', remaining);
      this._streamSynthesizeAndPlay(remaining);
    }
    // Reset transcript buffer for next turn
    this._transcriptBuffer = '';
  }

  async _streamSynthesizeAndPlay(text) {
    if (!this._ttsFirstSentenceTime) {
      this._ttsFirstSentenceTime = performance.now();
      this._ttsFirstChunkPlayed = false;
    }

    const abortController = new AbortController();
    this._activeAbortControllers.push(abortController);

    try {
      await this._ensureAudioContext();
      this.onStateChange?.('speaking');

      console.log('[cloned] Sending to TTS:', text, 'voice:', this.clonedVoiceId);
      const resp = await authFetch('/api/voice-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice_id: this.clonedVoiceId }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[cloned] voice-stream error:', resp.status, errText);
        return;
      }
      console.log('[cloned] voice-stream response OK, reading stream...');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let partial = '';
      let mp3Accumulator = new Uint8Array(0); // accumulate small chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortController.signal.aborted) break;

        partial += decoder.decode(value, { stream: true });

        // Parse newline-delimited JSON
        const lines = partial.split('\n');
        partial = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.data?.audio) {
              const audioBytes = hexToUint8Array(parsed.data.audio);

              // Accumulate bytes for decoding (small chunks may fail to decode)
              const merged = new Uint8Array(mp3Accumulator.length + audioBytes.length);
              merged.set(mp3Accumulator);
              merged.set(audioBytes, mp3Accumulator.length);
              mp3Accumulator = merged;

              // Try to decode accumulated mp3 data
              try {
                const audioBuffer = await this.audioContext.decodeAudioData(mp3Accumulator.buffer.slice(0));
                mp3Accumulator = new Uint8Array(0); // reset on success

                // Report latency on first chunk
                if (!this._ttsFirstChunkPlayed && this._ttsFirstSentenceTime) {
                  const latency = Math.round(performance.now() - this._ttsFirstSentenceTime);
                  this._ttsFirstChunkPlayed = true;
                  this.onTTSLatency?.(latency);
                }

                this._scheduleAudioBuffer(audioBuffer);
              } catch (decodeErr) {
                // Chunk too small to decode — accumulate more
              }
            }

            // status 2 = complete
            if (parsed.data?.status === 2) break;
          } catch (e) {
            // Skip unparseable lines
          }
        }
      }

      // Try to decode any remaining accumulated data
      if (mp3Accumulator.length > 0) {
        try {
          const audioBuffer = await this.audioContext.decodeAudioData(mp3Accumulator.buffer.slice(0));
          this._scheduleAudioBuffer(audioBuffer);
        } catch (e) {
          console.warn('Could not decode remaining mp3 accumulator:', mp3Accumulator.length, 'bytes');
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Streaming TTS error:', err);
    } finally {
      this._activeAbortControllers = this._activeAbortControllers.filter(c => c !== abortController);
    }
  }

  _scheduleAudioBuffer(audioBuffer) {
    const now = this.audioContext.currentTime;
    if (this._nextPlayTime < now) {
      this._nextPlayTime = now;
    }

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0.85;
    gainNode.connect(this.outputAnalyser);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);
    source.start(this._nextPlayTime);

    this._nextPlayTime += audioBuffer.duration;

    this.isPlaying = true;
    this.activeSources.push(source);

    if (!this._outputAnimFrame) {
      this._monitorOutputVolume();
    }

    source.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== source);
      if (this.activeSources.length === 0) {
        this.isPlaying = false;
        this._ttsFirstSentenceTime = null;
        this.onStateChange?.('listening');
      }
    };
  }

  _handleInterruption() {
    // Abort all in-flight TTS requests
    for (const controller of this._activeAbortControllers) {
      controller.abort();
    }
    this._activeAbortControllers = [];

    // Stop all audio playback
    this._stopPlayback();

    // Clear buffers
    this._textBuffer = '';
    this._transcriptBuffer = '';
    this._nextPlayTime = 0;
    this._ttsFirstSentenceTime = null;

    this.onStateChange?.('listening');
  }

  async _ensureAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    if (!this.outputAnalyser) {
      this.outputAnalyser = this.audioContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.3;
      this.outputAnalyser.connect(this.audioContext.destination);
    }
  }

  async _startMicrophone() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      const micContext = new AudioContext({ sampleRate: 16000 });
      const source = micContext.createMediaStreamSource(this.mediaStream);
      this.processor = micContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);

        if (this.onInputLevel) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += Math.abs(inputData[i]);
          this.onInputLevel(Math.min(1, (sum / inputData.length) * 8));
        }

        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        this.ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              mimeType: 'audio/pcm;rate=16000',
              data: base64
            }]
          }
        }));
      };

      source.connect(this.processor);
      this.processor.connect(micContext.destination);
      this._micContext = micContext;
      this.onStateChange?.('listening');

      this._monitorOutputVolume();
    } catch (err) {
      console.error('Microphone error:', err);
      this.onStateChange?.('mic-error');
    }
  }

  _monitorOutputVolume() {
    if (!this.outputAnalyser || !this.onOutputLevel) return;
    const dataArray = new Uint8Array(this.outputAnalyser.frequencyBinCount);
    const tick = () => {
      this.outputAnalyser.getByteFrequencyData(dataArray);
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
    this.activeSources = [];
    this.isPlaying = false;
    this._nextPlayTime = 0;
  }

  disconnect() {
    if (this._outputAnimFrame) {
      cancelAnimationFrame(this._outputAnimFrame);
      this._outputAnimFrame = null;
    }

    // Abort all in-flight TTS requests
    for (const controller of this._activeAbortControllers) {
      controller.abort();
    }
    this._activeAbortControllers = [];

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this._micContext) {
      this._micContext.close();
      this._micContext = null;
    }

    this._stopPlayback();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.onStateChange?.('disconnected');
  }
}

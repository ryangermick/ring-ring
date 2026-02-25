const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

async function blobToJSON(blob) {
  const text = await blob.text();
  return JSON.parse(text);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export class GeminiLiveSession {
  constructor({ character, userProfile, pastConversations, onTranscript, onStateChange, onInputLevel, onOutputLevel }) {
    this.character = character;
    this.userProfile = userProfile;
    this.pastConversations = pastConversations;
    this.onTranscript = onTranscript;
    this.onStateChange = onStateChange;
    this.onInputLevel = onInputLevel;
    this.onOutputLevel = onOutputLevel;
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.isPlaying = false;
    this.activeSources = [];
    this.nextPlayTime = 0;
    this.setupComplete = false;
    this.outputAnalyser = null;
    this._outputAnimFrame = null;
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

    prompt += `\n\nIMPORTANT CONTEXT: This is a phone call. A child is calling you on the phone. Answer like you're picking up a phone call — start with your greeting as if answering the phone. Stay in character throughout the conversation. Be warm, engaging, and kid-friendly. Remember you're speaking out loud, not typing — keep it natural and conversational.\n\nCRITICAL: NEVER break character. You ARE this character — not an AI, not a language model, not an assistant. If asked who you really are, stay in character. If asked to be someone else, politely decline in character. If asked about being AI or a computer, respond as your character would — confused, amused, or dismissive, but always in character. The magic of this experience depends on you staying in character 100% of the time.`;

    return prompt;
  }

  getSystemPrompt() {
    return this._buildSystemPrompt();
  }

  async connect() {
    this.onStateChange?.('connecting');

    // Audio context created lazily in _ensureAudioContext() to comply with autoplay policy
    // Open WebSocket
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
                    voiceName: this.character.voiceName || 'Kore'
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
        if (event.data instanceof Blob) {
          data = await blobToJSON(event.data);
        } else {
          data = JSON.parse(event.data);
        }

        if (data.setupComplete) {
          this.setupComplete = true;
          this.onStateChange?.('connected');
          this._startMicrophone();

          // Send initial prompt so the character greets the kid first
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
            this._stopPlayback();
            this.onStateChange?.('listening');
            return;
          }

          if (serverContent.modelTurn) {
            const parts = serverContent.modelTurn.parts || [];
            for (const part of parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
                this._queueAudio(part.inlineData.data);
              }
              // Ignore part.text — that's internal thinking/reasoning, not spoken words
            }
          }

          // Capture actual spoken transcription (what the user hears)
          if (serverContent.outputTranscription?.text) {
            this.onTranscript?.('character', serverContent.outputTranscription.text);
          }
          // Capture user's spoken words
          if (serverContent.inputTranscription?.text) {
            this.onTranscript?.('user', serverContent.inputTranscription.text);
          }
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

  async _ensureAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
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

        // Calculate input level for visualizer
        if (this.onInputLevel) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += Math.abs(inputData[i]);
          this.onInputLevel(Math.min(1, (sum / inputData.length) * 8));
        }

        // Convert float32 to int16
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

      // Start output volume monitoring loop
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
    this.nextPlayTime = 0;
    this.isPlaying = false;
  }

  async _queueAudio(base64Data) {
    await this._ensureAudioContext();

    if (!this.isPlaying) {
      this.onStateChange?.('speaking');
      // Start output volume monitoring if not already running
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

      const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const now = this.audioContext.currentTime;
      if (!this.nextPlayTime || this.nextPlayTime < now) {
        this.nextPlayTime = now;
      }

      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 0.85;
      gainNode.connect(this.outputAnalyser); // Route through analyser

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(this.nextPlayTime);

      this.nextPlayTime += audioBuffer.duration;
      this.activeSources.push(source);

      source.onended = () => {
        this.activeSources = this.activeSources.filter(s => s !== source);
        if (this.activeSources.length === 0) {
          this.isPlaying = false;
          this.onStateChange?.('listening');
        }
      };
    } catch (err) {
      console.error('Audio decode error:', err);
    }
  }

  disconnect() {
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

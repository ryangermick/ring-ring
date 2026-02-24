const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.BidiGenerateContent?key=${API_KEY}`;

export class GeminiLiveSession {
  constructor({ character, onAudioData, onTranscript, onStateChange }) {
    this.character = character;
    this.onAudioData = onAudioData;
    this.onTranscript = onTranscript;
    this.onStateChange = onStateChange;
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.playbackQueue = [];
    this.isPlaying = false;
    this.currentSource = null;
    this.setupComplete = false;
  }

  async connect() {
    this.onStateChange?.('connecting');

    // Set up audio context for playback
    this.audioContext = new AudioContext({ sampleRate: 24000 });

    // Open WebSocket
    this.ws = new WebSocket(WS_URL);

    return new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        // Send setup message
        this.ws.send(JSON.stringify({
          setup: {
            model: 'models/gemini-2.0-flash-exp',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.character.voiceName || 'Kore'
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: this.character.systemPrompt }]
            }
          }
        }));
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Setup complete response
        if (data.setupComplete) {
          this.setupComplete = true;
          this.onStateChange?.('connected');
          this._startMicrophone();
          resolve();
          return;
        }

        // Handle audio response
        if (data.serverContent) {
          const parts = data.serverContent.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) {
              this._queueAudio(part.inlineData.data);
            }
            if (part.text) {
              this.onTranscript?.('character', part.text);
            }
          }

          // If turn is complete
          if (data.serverContent.turnComplete) {
            this.onStateChange?.('listening');
          }
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        this.onStateChange?.('error');
        reject(err);
      };

      this.ws.onclose = () => {
        this.onStateChange?.('disconnected');
      };

      // Timeout
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
    });
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
        // Convert float32 to int16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
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
    } catch (err) {
      console.error('Microphone error:', err);
      this.onStateChange?.('mic-error');
    }
  }

  async _queueAudio(base64Data) {
    this.onStateChange?.('speaking');

    try {
      // Decode base64 to PCM bytes
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 to Float32 for Web Audio API
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      // Create AudioBuffer
      const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      this.playbackQueue.push(audioBuffer);
      this._playNext();
    } catch (err) {
      console.error('Audio decode error:', err);
    }
  }

  _playNext() {
    if (this.isPlaying || this.playbackQueue.length === 0) return;

    this.isPlaying = true;
    const buffer = this.playbackQueue.shift();
    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = buffer;
    this.currentSource.connect(this.audioContext.destination);
    this.currentSource.onended = () => {
      this.isPlaying = false;
      this.currentSource = null;
      if (this.playbackQueue.length > 0) {
        this._playNext();
      } else {
        this.onStateChange?.('listening');
      }
    };
    this.currentSource.start();
  }

  disconnect() {
    // Stop microphone
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

    // Stop playback
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch(e) {}
      this.currentSource = null;
    }
    this.playbackQueue = [];
    this.isPlaying = false;

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.onStateChange?.('disconnected');
  }
}

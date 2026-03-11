import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GeminiLiveClonedSession } from './lib/gemini-live-cloned';
import { supabase } from './lib/supabase';
import { authFetch } from './lib/api';

const STATUS = { idle: 'idle', loading: 'loading', success: 'success', error: 'error' };
const ALLOWED_EMAIL = 'rgermick@gmail.com';

function StatusBadge({ status, successText, errorText }) {
  if (status === STATUS.idle) return null;
  if (status === STATUS.loading) return <span className="text-amber-500 text-sm font-semibold animate-pulse">⏳ Working...</span>;
  if (status === STATUS.success) return <span className="text-emerald-600 text-sm font-semibold">✅ {successText || 'Done'}</span>;
  if (status === STATUS.error) return <span className="text-rose-500 text-sm font-semibold">❌ {errorText || 'Failed'}</span>;
  return null;
}

function LoginGate({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      if (u && u.email !== ALLOWED_EMAIL) {
        setError(`Access denied. Only ${ALLOWED_EMAIL} can use this page.`);
        supabase.auth.signOut();
        setUser(null);
      } else {
        setUser(u);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      if (u && u.email !== ALLOWED_EMAIL) {
        setError(`Access denied. Only ${ALLOWED_EMAIL} can use this page.`);
        supabase.auth.signOut();
        setUser(null);
      } else {
        setError('');
        setUser(u);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/voice-test' }
  });

  if (user === undefined) {
    return (
      <div className="min-h-dvh bg-[#FFFBF5] flex items-center justify-center">
        <span className="text-slate-400 animate-pulse font-semibold">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-dvh bg-[#FFFBF5] flex flex-col items-center justify-center px-8">
        <h1 className="text-2xl font-black text-[#1A1A2E] mb-2">🎤 Voice Clone Test</h1>
        <p className="text-sm text-slate-400 mb-8">Sign in to access this tool</p>
        {error && <p className="text-rose-500 text-sm font-semibold mb-4">{error}</p>}
        <button onClick={handleLogin}
          className="flex items-center gap-3 bg-[#4285F4] hover:bg-[#3B78DB] text-white rounded-full px-8 py-3 font-semibold text-base shadow-md shadow-[#4285F4]/20 active:scale-[0.97] transition-all">
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".9"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".8"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".85"/>
          </svg>
          Continue with Google
        </button>
      </div>
    );
  }

  return children;
}

export default function VoiceTest() {
  return (
    <LoginGate>
      <VoiceTestInner />
    </LoginGate>
  );
}

function VoiceTestInner() {
  const [uploadStatus, setUploadStatus] = useState(STATUS.idle);
  const [cloneStatus, setCloneStatus] = useState(STATUS.idle);
  const [synthStatus, setSynthStatus] = useState(STATUS.idle);

  const [fileId, setFileId] = useState(null);
  const [voiceId, setVoiceId] = useState(null);
  const [demoAudioUrl, setDemoAudioUrl] = useState(null);
  const [text, setText] = useState("Hi there! This is a voice clone test!");
  const [synthAudioUrl, setSynthAudioUrl] = useState(null);
  const [latency, setLatency] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setFileName(file.name);
      // Reset downstream state
      setFileId(null);
      setVoiceId(null);
      setDemoAudioUrl(null);
      setSynthAudioUrl(null);
      setUploadStatus(STATUS.idle);
      setCloneStatus(STATUS.idle);
      setSynthStatus(STATUS.idle);
      setErrorMsg('');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploadStatus(STATUS.loading);
    setErrorMsg('');
    try {
      const resp = await authFetch('/api/voice-test?action=upload', {
        method: 'POST',
        headers: { 'Content-Type': selectedFile.type || 'audio/wav' },
        body: selectedFile,
      });
      const data = await resp.json();
      if (data.file?.file_id) {
        setFileId(data.file.file_id);
        setUploadStatus(STATUS.success);
      } else {
        throw new Error(JSON.stringify(data));
      }
    } catch (err) {
      setUploadStatus(STATUS.error);
      setErrorMsg('Upload: ' + err.message);
    }
  };

  const handleClone = async () => {
    if (!fileId) return;
    setCloneStatus(STATUS.loading);
    setErrorMsg('');
    const label = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
    const vid = `clone-${label}-${Date.now()}`;
    try {
      const resp = await authFetch('/api/voice-test?action=clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, voice_id: vid }),
      });
      const data = await resp.json();
      if (data.base_resp?.status_code === 0 || data.demo_audio) {
        setVoiceId(vid);
        if (data.demo_audio) setDemoAudioUrl(data.demo_audio);
        setCloneStatus(STATUS.success);
      } else {
        throw new Error(JSON.stringify(data));
      }
    } catch (err) {
      setCloneStatus(STATUS.error);
      setErrorMsg('Clone: ' + err.message);
    }
  };

  const handleSynthesize = async () => {
    if (!voiceId || !text.trim()) return;
    setSynthStatus(STATUS.loading);
    setSynthAudioUrl(null);
    setLatency(null);
    setErrorMsg('');
    const t0 = performance.now();
    try {
      const resp = await authFetch('/api/voice-test?action=synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice_id: voiceId }),
      });
      const data = await resp.json();
      const elapsed = Math.round(performance.now() - t0);
      if (data.data?.audio) {
        setSynthAudioUrl(data.data.audio);
        setLatency(elapsed);
        setSynthStatus(STATUS.success);
        setTimeout(() => audioRef.current?.play(), 100);
      } else {
        throw new Error(JSON.stringify(data));
      }
    } catch (err) {
      setSynthStatus(STATUS.error);
      setErrorMsg('Synthesize: ' + err.message);
    }
  };

  return (
    <div className="min-h-dvh bg-[#FFFBF5]">
      <header className="sticky top-0 z-50 h-16 bg-[#FFFBF5]/85 backdrop-blur-xl border-b border-[#1A1A2E]/5">
        <div className="h-full max-w-2xl mx-auto px-6 flex items-center">
          <a href="/" className="flex items-center gap-2 text-[#1A1A2E] font-bold">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </a>
          <h1 className="ml-4 text-lg font-black text-[#1A1A2E]">🎤 Voice Clone Test</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        {/* Step 1: Select & Upload */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#1A1A2E]">Step 1: Upload Voice Sample</h2>
            <StatusBadge status={uploadStatus} successText={`file_id: ${fileId}`} />
          </div>
          <p className="text-sm text-slate-400 mb-4">Select any audio file (WAV, MP3, M4A, etc.) to upload to MiniMax</p>
          
          {/* File picker */}
          <div className="flex flex-col gap-3">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 hover:border-[#4285F4] rounded-xl p-6 text-center cursor-pointer transition-colors">
              {selectedFile ? (
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-semibold text-[#1A1A2E]">{fileName}</span>
                  <span className="text-xs text-slate-400">({(selectedFile.size / 1024).toFixed(0)} KB)</span>
                </div>
              ) : (
                <div>
                  <svg className="w-8 h-8 mx-auto text-slate-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-400">Tap to select an audio file</p>
                  <p className="text-xs text-slate-300 mt-1">WAV, MP3, M4A, OGG, WebM</p>
                </div>
              )}
            </div>
            <input 
              ref={fileInputRef} 
              type="file" 
              accept="audio/*" 
              className="hidden" 
              onChange={handleFileSelect} 
            />
            <button onClick={handleUpload} disabled={uploadStatus === STATUS.loading || !selectedFile}
              className="bg-[#4285F4] hover:bg-[#3B78DB] disabled:opacity-50 text-white rounded-xl px-6 py-3 font-bold text-sm transition-all active:scale-[0.97]">
              {uploadStatus === STATUS.loading ? 'Uploading...' : 'Upload to MiniMax'}
            </button>
          </div>
        </section>

        {/* Step 2: Clone */}
        <section className={`bg-white rounded-2xl p-6 shadow-sm border border-slate-100 transition-opacity ${fileId ? '' : 'opacity-40 pointer-events-none'}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#1A1A2E]">Step 2: Clone Voice</h2>
            <StatusBadge status={cloneStatus} successText={`voice: ${voiceId}`} />
          </div>
          <p className="text-sm text-slate-400 mb-4">Creates a cloned voice from the uploaded file</p>
          <button onClick={handleClone} disabled={cloneStatus === STATUS.loading || !fileId}
            className="bg-[#34A853] hover:bg-[#2d9249] disabled:opacity-50 text-white rounded-xl px-6 py-3 font-bold text-sm transition-all active:scale-[0.97]">
            {cloneStatus === STATUS.loading ? 'Cloning...' : 'Clone Voice'}
          </button>
          {demoAudioUrl && (
            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-1">Demo audio from clone:</p>
              <audio controls src={demoAudioUrl} className="w-full" />
            </div>
          )}
        </section>

        {/* Step 3: Synthesize */}
        <section className={`bg-white rounded-2xl p-6 shadow-sm border border-slate-100 transition-opacity ${voiceId ? '' : 'opacity-40 pointer-events-none'}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#1A1A2E]">Step 3: Speak!</h2>
            <StatusBadge status={synthStatus} successText={latency ? `${latency}ms` : 'Done'} />
          </div>
          <p className="text-sm text-slate-400 mb-4">Type text and hear the cloned voice say it</p>
          <div className="flex gap-3">
            <input type="text" value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSynthesize()}
              className="flex-1 bg-[#FFFBF5] rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#FBBC05] focus:ring-2 focus:ring-[#FBBC05]/20 outline-none transition-all"
              placeholder="What should the voice say?" />
            <button onClick={handleSynthesize} disabled={synthStatus === STATUS.loading || !voiceId || !text.trim()}
              className="bg-[#FBBC05] hover:bg-[#e5ab00] disabled:opacity-50 text-[#1A1A2E] rounded-xl px-6 py-3 font-bold text-sm transition-all active:scale-[0.97] shrink-0">
              {synthStatus === STATUS.loading ? '🔄' : '🔊 Speak'}
            </button>
          </div>
          {synthAudioUrl && (
            <div className="mt-4">
              <audio ref={audioRef} controls src={synthAudioUrl} className="w-full" />
              {latency && (
                <p className="text-xs text-slate-400 mt-2">
                  ⚡ Latency: <span className="font-bold text-[#1A1A2E]">{latency}ms</span> (request → response)
                </p>
              )}
            </div>
          )}
        </section>

        {/* Error display */}
        {errorMsg && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
            <p className="text-sm text-rose-600 font-mono break-all">{errorMsg}</p>
          </div>
        )}

        {/* Step 4: Test Call */}
        <TestCallSection voiceId={voiceId} />

        {/* Info */}
        <div className="text-xs text-slate-300 text-center space-y-1">
          <p>MiniMax API • speech-2.8-hd model</p>
          <p>Cloned voices expire after 7 days of no use</p>
        </div>
      </main>
    </div>
  );
}

function TestCallSection({ voiceId }) {
  const [callState, setCallState] = useState('idle');
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [transcript, setTranscript] = useState([]);
  const [ttsLatency, setTtsLatency] = useState(null);
  const sessionRef = useRef(null);

  const isActive = callState === 'connecting' || callState === 'connected' || callState === 'listening' || callState === 'speaking';

  const startCall = useCallback(async () => {
    if (!voiceId) return;
    setTranscript([]);
    setTtsLatency(null);

    const session = new GeminiLiveClonedSession({
      character: {
        name: 'Voice Clone',
        voiceName: 'Kore',
        systemPrompt: `You are a friendly voice assistant using a cloned voice. Be conversational, warm, and helpful. Keep responses short and natural.`,
      },
      userProfile: null,
      pastConversations: [],
      onTranscript: (role, text) => {
        setTranscript(prev => {
          if (prev.length > 0 && prev[prev.length - 1].role === role) {
            const updated = [...prev];
            updated[updated.length - 1] = { role, text: updated[updated.length - 1].text + text };
            return updated;
          }
          return [...prev, { role, text }];
        });
      },
      onStateChange: (state) => setCallState(state),
      onInputLevel: setInputLevel,
      onOutputLevel: setOutputLevel,
      clonedVoiceId: voiceId,
    });

    session.onTTSLatency = (ms) => setTtsLatency(ms);
    sessionRef.current = session;

    try {
      await session.connect();
    } catch (err) {
      console.error('Call failed:', err);
      setCallState('error');
    }
  }, [voiceId]);

  const hangUp = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.disconnect();
    };
  }, []);

  const VisualizerBar = ({ level, color }) => (
    <div className="flex items-center gap-1.5 h-8">
      {[...Array(12)].map((_, i) => {
        const threshold = (i + 1) / 12;
        const active = level > threshold * 0.5;
        return (
          <div
            key={i}
            className="w-1.5 rounded-full transition-all duration-75"
            style={{
              height: active ? `${Math.max(20, level * 100)}%` : '20%',
              backgroundColor: active ? color : '#e2e8f0',
            }}
          />
        );
      })}
    </div>
  );

  return (
    <section className={`bg-white rounded-2xl p-6 shadow-sm border border-slate-100 transition-opacity ${voiceId ? '' : 'opacity-40 pointer-events-none'}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-[#1A1A2E]">Step 4: Test Call</h2>
        {ttsLatency && (
          <span className="text-xs font-semibold text-slate-500">
            TTS latency: <span className="text-[#1A1A2E]">{ttsLatency}ms</span>
          </span>
        )}
      </div>
      <p className="text-sm text-slate-400 mb-4">
        Live call using Gemini + your cloned voice
      </p>

      {!isActive ? (
        <button
          onClick={startCall}
          disabled={!voiceId || callState === 'connecting'}
          className="w-full bg-[#34A853] hover:bg-[#2d9249] disabled:opacity-50 text-white rounded-2xl px-6 py-5 font-bold text-lg transition-all active:scale-[0.97] flex items-center justify-center gap-3"
        >
          <span className="text-2xl">📞</span>
          {callState === 'connecting' ? 'Connecting...' : 'Test Call'}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${callState === 'speaking' ? 'bg-[#FBBC05] animate-pulse' : callState === 'listening' ? 'bg-[#34A853] animate-pulse' : 'bg-[#4285F4] animate-pulse'}`} />
              <span className="text-sm font-semibold text-[#1A1A2E] capitalize">{callState}</span>
            </div>
            <button
              onClick={hangUp}
              className="bg-[#EA4335] hover:bg-[#d33426] text-white rounded-xl px-5 py-2.5 font-bold text-sm transition-all active:scale-[0.97]"
            >
              Hang Up
            </button>
          </div>

          <div className="flex items-center justify-between bg-[#FFFBF5] rounded-xl p-4">
            <div className="text-center">
              <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">You</p>
              <VisualizerBar level={inputLevel} color="#4285F4" />
            </div>
            <div className="text-center">
              <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">Clone</p>
              <VisualizerBar level={outputLevel} color="#FBBC05" />
            </div>
          </div>

          {transcript.length > 0 && (
            <div className="bg-[#FFFBF5] rounded-xl p-4 max-h-48 overflow-y-auto space-y-2">
              {transcript.map((entry, i) => (
                <div key={i} className={`text-sm ${entry.role === 'character' ? 'text-[#EA4335] font-medium' : 'text-[#4285F4]'}`}>
                  <span className="font-bold">{entry.role === 'character' ? '🔴 Clone' : '🔵 You'}:</span>{' '}
                  {entry.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

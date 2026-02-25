import React, { useState, useEffect, useRef, useCallback } from 'react';
import { defaultCharacters, franchises, VOICE_OPTIONS } from './data/characters';
import { supabase } from './lib/supabase';
import { GeminiLiveSession } from './lib/gemini-live';
import { generateCharacter } from './lib/generate-character';

const GlobalStyles = () => (
  <style>{`
    @keyframes sonar {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .animate-sonar { animation: sonar 2s infinite cubic-bezier(0, 0, 0.2, 1); }
    .animate-sonar-delayed { animation: sonar 2s infinite cubic-bezier(0, 0, 0.2, 1); animation-delay: 1s; }
  `}</style>
);

/* ═══════════ Canvas Audio Visualizer (ported from memyself.ai) ═══════════ */
const NUM_BARS = 48;

function AudioVisualizer({ inputLevel, outputLevel, isActive, isSpeaking }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const barsRef = useRef(new Array(NUM_BARS).fill(0));
  const targetBarsRef = useRef(new Array(NUM_BARS).fill(0));
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const animate = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      timeRef.current += 0.02;
      const t = timeRef.current;
      const level = isSpeaking ? outputLevel : inputLevel;
      const activeLevel = Math.max(0.03, level);

      for (let i = 0; i < NUM_BARS; i++) {
        const normalized = i / (NUM_BARS - 1);
        const centerDist = Math.abs(normalized - 0.5) * 2;

        const wave1 = Math.sin(t * 2.5 + i * 0.3) * 0.5 + 0.5;
        const wave2 = Math.sin(t * 1.7 + i * 0.5 + 1.2) * 0.3 + 0.5;
        const wave3 = Math.sin(t * 3.8 + i * 0.15) * 0.2 + 0.5;

        const envelope = Math.exp(-centerDist * centerDist * 2.5);
        const target = (wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2) * envelope * activeLevel;
        targetBarsRef.current[i] = target;
      }

      for (let i = 0; i < NUM_BARS; i++) {
        barsRef.current[i] += (targetBarsRef.current[i] - barsRef.current[i]) * 0.15;
      }

      const barWidth = width / NUM_BARS;
      const gap = 1.5;
      const maxBarHeight = height * 0.8;
      const centerY = height / 2;

      for (let i = 0; i < NUM_BARS; i++) {
        const barHeight = Math.max(2, barsRef.current[i] * maxBarHeight);
        const x = i * barWidth + gap / 2;
        const w = barWidth - gap;
        const alpha = 0.3 + barsRef.current[i] * 0.7;

        // Gold (#FBBC05) when speaking, green (#34A853) when listening
        if (isSpeaking) {
          ctx.fillStyle = `rgba(251, 188, 5, ${alpha})`;
        } else {
          ctx.fillStyle = `rgba(52, 168, 83, ${alpha})`;
        }

        const radius = Math.min(w / 2, 2);
        const topY = centerY - barHeight / 2;

        ctx.beginPath();
        ctx.roundRect(x, topY, w, barHeight, radius);
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isActive, inputLevel, outputLevel, isSpeaking]);

  return (
    <canvas ref={canvasRef} className="w-full h-full" style={{ display: isActive ? 'block' : 'none' }} />
  );
}

/* ═══════════ Ringing Sound (Web Audio API synthesized phone ring) ═══════════ */
// ringCtx is created lazily on first user tap (startCall) to satisfy browser autoplay policy
let _ringCtx = null;
function getRingCtx() {
  if (!_ringCtx || _ringCtx.state === 'closed') {
    _ringCtx = new AudioContext();
  }
  if (_ringCtx.state === 'suspended') _ringCtx.resume();
  return _ringCtx;
}

function useRingSound(isRinging) {
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!isRinging) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }

    const ctx = getRingCtx();

    const playRing = () => {
      try {
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        gain.connect(ctx.destination);

        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 440;
        osc1.connect(gain);
        osc1.start(now);
        osc1.stop(now + 0.8);

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 480;
        osc2.connect(gain);
        osc2.start(now);
        osc2.stop(now + 0.8);
      } catch (e) { console.warn('Ring sound error:', e); }
    };

    playRing();
    intervalRef.current = setInterval(playRing, 1500);

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [isRinging]);
}

/* ═══════════ Avatar Component ═══════════ */
const CharAvatar = ({ src, alt, size = 'md', className = '' }) => {
  const sizes = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-[5.5rem] h-[5.5rem] sm:w-[6.5rem] sm:h-[6.5rem] lg:w-28 lg:h-28',
    xl: 'w-44 h-44 sm:w-52 sm:h-52',
  };
  return (
    <div className={`${sizes[size]} rounded-full overflow-hidden bg-white relative shrink-0 ${className}`}>
      <img src={src} alt={alt} className="absolute inset-0 w-[115%] h-[115%] max-w-none -ml-[7.5%] -mt-[7.5%] object-cover" />
    </div>
  );
};

/* ═══════════ Back Header ═══════════ */
const BackHeader = ({ label, onBack, right }) => (
  <header className="sticky top-0 z-50 h-24 sm:h-28 bg-[#FFFBF5]/85 backdrop-blur-xl border-b border-[#1A1A2E]/5">
    <div className="h-full max-w-3xl mx-auto px-8 sm:px-12 flex items-center justify-between">
      <button onClick={onBack} className="flex items-center gap-3 text-[#1A1A2E] font-bold active:scale-[0.97] transition-transform">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        {label}
      </button>
      {right}
    </div>
  </header>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState('login');
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [callState, setCallState] = useState('ringing');
  const [duration, setDuration] = useState(0);
  const [history, setHistory] = useState([]);
  const [characters, setCharacters] = useState(defaultCharacters);
  const [error, setError] = useState(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);

  // Ringing sound
  useRingSound(callState === 'ringing');

  // Transcript viewer
  const [viewingTranscript, setViewingTranscript] = useState(null);
  const [transcriptMessages, setTranscriptMessages] = useState([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Characters editor
  const [editingChar, setEditingChar] = useState(null);
  const [charSaving, setCharSaving] = useState(false);

  const sessionRef = useRef(null);
  const timerRef = useRef(null);
  const transcriptRef = useRef([]);
  const dbRecordIdRef = useRef(null);

  /* ═══════════ Load characters from Supabase ═══════════ */
  const loadCharacters = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('characters').select('*').order('franchise');
      if (data && data.length > 0) {
        // Map DB fields to app fields
        setCharacters(data.map(c => ({
          id: c.id,
          name: c.name,
          franchise: c.franchise,
          image: c.image || '/characters/default.png',
          description: c.description || '',
          greeting: c.greeting || '',
          voiceName: c.voice_name || 'Puck',
          systemPrompt: c.system_prompt || '',
          isCustom: c.is_custom,
          createdBy: c.created_by,
        })));
      }
    } catch (err) {
      console.error('Failed to load characters:', err);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) { setScreen('shelf'); loadCharacters(); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { setScreen('shelf'); loadCharacters(); }
    });
    return () => subscription.unsubscribe();
  }, [loadCharacters]);

  useEffect(() => {
    if (['connected', 'listening', 'speaking'].includes(callState)) {
      timerRef.current = setInterval(() => setDuration(p => p + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [callState]);

  const handleLogin = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setScreen('login');
  };

  const startCall = async (character) => {
    setActiveCharacter(character);
    setScreen('call');
    setCallState('ringing');
    setDuration(0);
    setError(null);
    transcriptRef.current = [];
    dbRecordIdRef.current = null;

    try {
      const { data } = await supabase.from('conversations')
        .insert({ user_id: user.id, character_id: character.id })
        .select().single();
      if (data) dbRecordIdRef.current = data.id;
    } catch (err) { console.error('DB error:', err); }

    setTimeout(async () => {
      try {
        const session = new GeminiLiveSession({
          character,
          onStateChange: (state) => {
            setCallState(state);
            if (state === 'error' || state === 'mic-error') {
              setError(state === 'mic-error' ? 'Microphone access denied. Please allow mic access and try again.' : 'Connection failed. Check your internet and try again.');
            }
          },
          onTranscript: (role, text) => {
            transcriptRef.current.push({ role, text, ts: Date.now() });
          },
          onInputLevel: setInputLevel,
          onOutputLevel: setOutputLevel,
        });
        await session.connect();
        sessionRef.current = session;
      } catch (err) {
        console.error('Call failed:', err);
        setCallState('error');
        setError(`Connection failed: ${err.message}`);
      }
    }, 2000);
  };

  const handleHangUp = async () => {
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }
    clearInterval(timerRef.current);

    if (dbRecordIdRef.current) {
      try {
        await supabase.from('conversations').update({
          duration_seconds: duration,
          ended_at: new Date().toISOString(),
          transcript: transcriptRef.current,
        }).eq('id', dbRecordIdRef.current);

        if (transcriptRef.current.length > 0) {
          await supabase.from('messages').insert(
            transcriptRef.current.map(t => ({
              conversation_id: dbRecordIdRef.current,
              role: t.role === 'character' ? 'character' : 'user',
              content: t.text
            }))
          );
        }
      } catch (err) { console.error('Save failed:', err); }
    }

    setScreen('shelf');
    setActiveCharacter(null);
  };

  const loadTranscript = async (conversationId) => {
    setTranscriptLoading(true);
    try {
      const { data } = await supabase.from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      setTranscriptMessages(data || []);
    } catch (err) { console.error('Transcript load failed:', err); }
    setTranscriptLoading(false);
  };

  const saveCharacter = async (charData) => {
    setCharSaving(true);
    try {
      const dbRow = {
        id: charData.id,
        name: charData.name,
        franchise: charData.franchise,
        image: charData.image,
        description: charData.description,
        greeting: charData.greeting,
        voice_name: charData.voiceName,
        system_prompt: charData.systemPrompt,
        is_custom: charData.isCustom ?? true,
        created_by: charData.createdBy || user.id,
      };

      const { error } = await supabase.from('characters').upsert(dbRow);
      if (error) throw error;
      await loadCharacters();
      setEditingChar(null);
    } catch (err) {
      console.error('Save character failed:', err);
      alert('Failed to save: ' + err.message);
    }
    setCharSaving(false);
  };

  const deleteCharacter = async (charId) => {
    if (!confirm('Delete this character?')) return;
    try {
      await supabase.from('characters').delete().eq('id', charId);
      await loadCharacters();
      setEditingChar(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete: ' + err.message);
    }
  };

  const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  /* ═══════════════════ SIGN IN ═══════════════════ */
  if (screen === 'login') {
    return (
      <div className="min-h-dvh bg-[#FFFBF5] flex flex-col items-center justify-center px-12">
        <GlobalStyles />
        <div className="flex flex-col items-center -mt-8">
          <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="w-72 sm:w-96 mb-4 select-none" />
          <p className="text-base text-slate-400 font-medium mt-2 mb-16 text-center max-w-xs">
            Talk to your favorite characters
          </p>
          <button onClick={handleLogin}
            className="flex items-center gap-4 bg-[#4285F4] hover:bg-[#3B78DB] text-white rounded-full px-16 py-6 font-bold text-lg shadow-lg shadow-[#4285F4]/25 active:scale-[0.97] transition-all duration-200">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".9"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".8"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".85"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════ CHARACTER GRID ═══════════════════ */
  if (screen === 'shelf') {
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <header className="sticky top-0 z-50 h-24 sm:h-28 bg-[#FFFBF5]/85 backdrop-blur-xl border-b border-[#1A1A2E]/5">
          <div className="h-full max-w-4xl mx-auto px-8 sm:px-12 flex items-center justify-between">
            <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="h-14 sm:h-16" />
            <div className="flex items-center gap-5">
              <button onClick={async () => {
                  setScreen('history');
                  const { data } = await supabase.from('conversations').select('*')
                    .eq('user_id', user.id).order('started_at', { ascending: false });
                  setHistory(data || []);
                }}
                className="text-[13px] font-bold uppercase tracking-widest text-slate-400 hover:text-[#4285F4] transition-colors">
                History
              </button>
              <button onClick={() => setScreen('characters')}
                className="text-[13px] font-bold uppercase tracking-widest text-slate-400 hover:text-[#4285F4] transition-colors">
                Characters
              </button>
              <button onClick={handleLogout}
                className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-slate-200 hover:ring-[#4285F4] transition-all">
                {user?.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-[#4285F4] flex items-center justify-center text-white text-sm font-bold">
                    {user?.email?.charAt(0).toUpperCase() || '?'}
                  </div>
                )}
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-8 sm:px-12 pt-10 pb-24">
          {franchises.map((franchise, idx) => {
            const chars = characters.filter(c => c.franchise === franchise.id);
            if (!chars.length) return null;
            return (
              <section key={franchise.id} className={idx > 0 ? 'mt-14 sm:mt-20' : ''}>
                <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-7">
                  {franchise.name}
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-5 gap-y-8 sm:gap-x-7 sm:gap-y-10">
                  {chars.map(char => (
                    <button key={char.id} onClick={() => startCall(char)}
                      className="group flex flex-col items-center gap-3 outline-none active:scale-[0.93] transition-transform duration-150">
                      <div className="shadow-md group-hover:shadow-xl group-hover:scale-[1.05] transition-all duration-200 rounded-full">
                        <CharAvatar src={char.image} alt={char.name} size="lg" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-slate-500 group-hover:text-[#4285F4] transition-colors text-center leading-tight">
                        {char.name}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Custom characters section */}
          {characters.some(c => c.isCustom) && (
            <section className="mt-14 sm:mt-20">
              <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-7">Custom</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-5 gap-y-8 sm:gap-x-7 sm:gap-y-10">
                {characters.filter(c => c.isCustom).map(char => (
                  <button key={char.id} onClick={() => startCall(char)}
                    className="group flex flex-col items-center gap-3 outline-none active:scale-[0.93] transition-transform duration-150">
                    <div className="shadow-md group-hover:shadow-xl group-hover:scale-[1.05] transition-all duration-200 rounded-full">
                      <CharAvatar src={char.image} alt={char.name} size="lg" />
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-slate-500 group-hover:text-[#4285F4] transition-colors text-center leading-tight">
                      {char.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    );
  }

  /* ═══════════════════ CALL SCREEN ═══════════════════ */
  if (screen === 'call' && activeCharacter) {
    const speaking = callState === 'speaking';
    const listening = callState === 'listening';
    const ringing = callState === 'ringing';
    const hasError = callState === 'error' || callState === 'mic-error';

    return (
      <div className="min-h-dvh bg-[#1A1A2E] flex flex-col items-center px-8 relative overflow-hidden">
        <GlobalStyles />
        {/* Tiled pattern background */}
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'url(/pattern-bg.jpg)', backgroundSize: '300px', backgroundRepeat: 'repeat' }} />

        {/* Back button */}
        <div className="absolute top-0 left-0 z-20 pt-14 pl-6 sm:pt-16 sm:pl-8">
          <button onClick={handleHangUp} className="flex items-center gap-2 text-white/40 hover:text-white/70 active:scale-95 transition-all">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="text-sm font-semibold">Back</span>
          </button>
        </div>

        <div className="h-16 sm:h-24 shrink-0" />

        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
          {/* Avatar with sonar / listening glow / speaking glow */}
          <div className="relative w-44 h-44 sm:w-52 sm:h-52 mb-10 flex items-center justify-center">
            {ringing && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-[#34A853]/60 animate-sonar" />
                <div className="absolute inset-0 rounded-full border-2 border-[#34A853]/40 animate-sonar-delayed" />
              </>
            )}
            <div className={`
              relative w-full h-full rounded-full overflow-hidden bg-white z-10 transition-all duration-500
              ${speaking ? 'scale-[1.06] ring-4 ring-[#FBBC05] shadow-[0_0_40px_rgba(251,188,5,0.35)]' : ''}
              ${listening ? 'ring-4 ring-[#34A853]/60 shadow-[0_0_30px_rgba(52,168,83,0.25)]' : ''}
              ${hasError ? 'ring-4 ring-rose-500/60' : ''}
              ${!speaking && !listening && !ringing && !hasError ? 'ring-2 ring-white/10' : ''}
            `}>
              <img src={activeCharacter.image} alt={activeCharacter.name}
                className="absolute inset-0 w-[115%] h-[115%] max-w-none -ml-[7.5%] -mt-[7.5%] object-cover" />
            </div>
          </div>

          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-3">
            {activeCharacter.name}
          </h2>

          {/* Audio visualizer — canvas-based, reacts to real audio levels */}
          <div className="w-full h-20 mb-4">
            {(listening || speaking) ? (
              <AudioVisualizer
                inputLevel={inputLevel}
                outputLevel={outputLevel}
                isActive={true}
                isSpeaking={speaking}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                {ringing && <span className="text-[#34A853] font-semibold">Calling…</span>}
                {hasError && <span className="text-[#EA4335] font-semibold text-sm text-center px-4">{error}</span>}
                {callState === 'connected' && <span className="text-slate-500 font-semibold">Connected</span>}
              </div>
            )}
          </div>

          <span className="font-mono text-sm tracking-widest text-slate-600">{fmt(duration)}</span>
        </div>

        <div className="pb-12 sm:pb-16 pt-8 shrink-0">
          <button onClick={handleHangUp}
            className="w-[72px] h-[72px] bg-[#EA4335] rounded-full flex items-center justify-center shadow-xl shadow-[#EA4335]/30 active:scale-90 hover:bg-[#D33828] transition-all duration-200">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85a.994.994 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════════════ HISTORY ═══════════════════ */
  if (screen === 'history') {
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <BackHeader label="Call History" onBack={() => setScreen('shelf')} />
        <main className="max-w-3xl mx-auto px-8 sm:px-12 pt-8 pb-20">
          {history.length === 0 ? (
            <p className="text-center text-slate-400 font-semibold mt-20">No calls yet — tap a character to start!</p>
          ) : (
            <div className="flex flex-col gap-3">
              {history.map(rec => {
                const char = characters.find(c => c.id === rec.character_id);
                if (!char) return null;
                return (
                  <button key={rec.id} onClick={() => {
                    setViewingTranscript(rec);
                    loadTranscript(rec.id);
                    setScreen('transcript');
                  }} className="bg-white rounded-2xl p-5 flex items-center gap-5 shadow-sm hover:shadow-md transition-shadow text-left w-full">
                    <CharAvatar src={char.image} alt={char.name} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#1A1A2E]">{char.name}</p>
                      <p className="text-[13px] text-slate-400 mt-0.5">
                        {new Date(rec.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-slate-400">{fmt(rec.duration_seconds || 0)}</span>
                      <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  /* ═══════════════════ TRANSCRIPT VIEW ═══════════════════ */
  if (screen === 'transcript' && viewingTranscript) {
    const char = characters.find(c => c.id === viewingTranscript.character_id);
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <BackHeader label="Transcript" onBack={() => { setScreen('history'); setViewingTranscript(null); }} />
        <main className="max-w-3xl mx-auto px-8 sm:px-12 pt-8 pb-20">
          {/* Call info */}
          <div className="flex items-center gap-4 mb-8">
            {char && <CharAvatar src={char.image} alt={char.name} size="md" />}
            <div>
              <p className="font-bold text-[#1A1A2E] text-lg">{char?.name || 'Unknown'}</p>
              <p className="text-sm text-slate-400">
                {new Date(viewingTranscript.started_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {' · '}{fmt(viewingTranscript.duration_seconds || 0)}
              </p>
            </div>
          </div>

          {transcriptLoading ? (
            <p className="text-center text-slate-400 mt-12">Loading transcript…</p>
          ) : transcriptMessages.length === 0 ? (
            <p className="text-center text-slate-400 mt-12">No transcript available for this call.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {transcriptMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                    msg.role === 'user'
                      ? 'bg-[#4285F4] text-white rounded-br-md'
                      : 'bg-white text-[#1A1A2E] shadow-sm rounded-bl-md'
                  }`}>
                    <p className="text-[13px] font-semibold mb-1 opacity-60">
                      {msg.role === 'user' ? 'You' : char?.name || 'Character'}
                    </p>
                    <p className="text-[15px] leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  /* ═══════════════════ CHARACTERS MANAGEMENT ═══════════════════ */
  if (screen === 'characters') {
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <BackHeader label="Characters" onBack={() => setScreen('shelf')}
          right={
            <button onClick={() => setEditingChar({
              id: '', name: '', franchise: 'custom', image: '', description: '',
              greeting: '', voiceName: 'Puck', systemPrompt: '', isCustom: true,
            })} className="text-[13px] font-bold uppercase tracking-widest text-[#4285F4] hover:text-[#3B78DB] transition-colors">
              + New
            </button>
          }
        />
        <main className="max-w-3xl mx-auto px-8 sm:px-12 pt-8 pb-20">
          {franchises.map(franchise => {
            const chars = characters.filter(c => c.franchise === franchise.id);
            if (!chars.length) return null;
            return (
              <div key={franchise.id} className="mb-10">
                <h3 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-4">{franchise.name}</h3>
                <div className="flex flex-col gap-2">
                  {chars.map(char => (
                    <button key={char.id} onClick={() => setEditingChar({...char})}
                      className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow text-left w-full">
                      <CharAvatar src={char.image} alt={char.name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#1A1A2E] text-sm">{char.name}</p>
                        <p className="text-xs text-slate-400 truncate">{char.description}</p>
                      </div>
                      <span className="text-xs text-slate-300 font-mono">{char.voiceName}</span>
                      <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Custom characters section */}
          {characters.some(c => c.isCustom) && (
            <div className="mb-10">
              <h3 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-4">Custom</h3>
              <div className="flex flex-col gap-2">
                {characters.filter(c => c.isCustom).map(char => (
                  <button key={char.id} onClick={() => setEditingChar({...char})}
                    className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow text-left w-full">
                    <CharAvatar src={char.image} alt={char.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#1A1A2E] text-sm">{char.name}</p>
                      <p className="text-xs text-slate-400 truncate">{char.description}</p>
                    </div>
                    <span className="text-xs text-slate-300 font-mono">{char.voiceName}</span>
                    <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ═══ Character Editor Modal ═══ */}
        {editingChar && <CharacterEditor
          char={editingChar}
          setChar={setEditingChar}
          onSave={saveCharacter}
          onDelete={deleteCharacter}
          saving={charSaving}
          user={user}
        />}
      </div>
    );
  }

  return null;
}

/* ═══════════════════ CHARACTER EDITOR MODAL ═══════════════════ */
function CharacterEditor({ char, setChar, onSave, onDelete, saving, user }) {
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showDetails, setShowDetails] = useState(!!char.name);
  const fileInputRef = useRef(null);

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    try {
      const result = await generateCharacter(aiPrompt);
      const id = (result.name || aiPrompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      setChar(p => ({
        ...p,
        id: p.id || id,
        name: result.name || p.name,
        description: result.description || p.description,
        greeting: result.greeting || p.greeting,
        systemPrompt: result.systemPrompt || p.systemPrompt,
        voiceName: result.voiceName || p.voiceName,
        franchise: result.franchise || p.franchise || 'custom',
        isCustom: true,
      }));
      setShowDetails(true);
    } catch (err) {
      console.error('AI generate failed:', err);
      alert('Failed to generate character. Try again.');
    }
    setGenerating(false);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const fileName = `${char.id || Date.now()}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('character-images').upload(fileName, file, {
        cacheControl: '3600',
        upsert: true,
      });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('character-images').getPublicUrl(fileName);
      setChar(p => ({ ...p, image: publicUrl }));
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Image upload failed: ' + err.message);
    }
    setUploading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) setChar(null); }}>
      <div className="bg-[#FFFBF5] w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90vh] overflow-y-auto p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-[#1A1A2E]">
            {char.id && char.name ? 'Edit Character' : 'New Character'}
          </h2>
          <button onClick={() => setChar(null)} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-5">
          {/* ── AI Auto-fill ── */}
          {!char.name && (
            <div className="bg-gradient-to-br from-teal-50 to-sky-50 rounded-2xl p-5 border border-teal-100">
              <label className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-2 block">✨ Describe a character</label>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                rows={2}
                className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-teal-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 outline-none transition-all resize-none text-sm"
                placeholder="e.g. A silly pirate parrot who loves treasure hunts and says 'Squawk!' a lot"
              />
              <button onClick={handleGenerate} disabled={generating || !aiPrompt.trim()}
                className="mt-3 w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl py-3 font-bold transition-all active:scale-[0.97] text-sm">
                {generating ? 'Generating…' : 'Auto-fill all fields ✨'}
              </button>
              <div className="flex items-center gap-3 mt-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">or fill manually</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <button onClick={() => setShowDetails(true)} className="mt-3 w-full text-sm text-slate-500 hover:text-[#4285F4] font-semibold transition-colors">
                Fill in details manually →
              </button>
            </div>
          )}

          {/* ── Detail fields (shown after AI fill or manual toggle) ── */}
          {(showDetails || char.name) && (
            <>
              {/* Image upload + preview */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Image</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 relative shrink-0 border-2 border-dashed border-slate-200">
                    {char.image ? (
                      <img src={char.image} alt="" className="absolute inset-0 w-[115%] h-[115%] max-w-none -ml-[7.5%] -mt-[7.5%] object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="bg-white rounded-xl px-4 py-2.5 text-sm font-semibold text-[#4285F4] border border-slate-200 hover:border-[#4285F4] transition-all active:scale-[0.97]">
                      {uploading ? 'Uploading…' : 'Upload image'}
                    </button>
                    <input type="text" value={char.image}
                      onChange={e => setChar(p => ({...p, image: e.target.value}))}
                      className="w-full bg-white rounded-xl px-3 py-2 text-[#1A1A2E] text-xs border border-slate-200 focus:border-[#4285F4] outline-none transition-all"
                      placeholder="or paste URL" />
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Name</label>
                <input type="text" value={char.name}
                  onChange={e => setChar(p => ({...p, name: e.target.value, id: p.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}))}
                  className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all"
                  placeholder="Character name" />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Description</label>
                <input type="text" value={char.description}
                  onChange={e => setChar(p => ({...p, description: e.target.value}))}
                  className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all"
                  placeholder="Short description" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Franchise</label>
                  <select value={char.franchise}
                    onChange={e => setChar(p => ({...p, franchise: e.target.value}))}
                    className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] outline-none">
                    {franchises.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Voice</label>
                  <select value={char.voiceName}
                    onChange={e => setChar(p => ({...p, voiceName: e.target.value}))}
                    className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] outline-none">
                    {VOICE_OPTIONS.map(v => (
                      <option key={v.value} value={v.value}>{v.label} · {v.gender}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Greeting</label>
                <input type="text" value={char.greeting}
                  onChange={e => setChar(p => ({...p, greeting: e.target.value}))}
                  className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all"
                  placeholder="What they say when they pick up" />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">System Prompt</label>
                <textarea value={char.systemPrompt}
                  onChange={e => setChar(p => ({...p, systemPrompt: e.target.value}))}
                  rows={4}
                  className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all resize-none"
                  placeholder="You are [character]. You speak like..." />
              </div>

              <div className="flex gap-3 mt-2">
                <button onClick={() => onSave(char)} disabled={saving || !char.name}
                  className="flex-1 bg-[#4285F4] hover:bg-[#3B78DB] disabled:opacity-50 text-white rounded-xl py-3.5 font-bold transition-all active:scale-[0.97]">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {char.id && char.isCustom && (
                  <button onClick={() => onDelete(char.id)}
                    className="bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl px-5 py-3.5 font-bold transition-all active:scale-[0.97]">
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

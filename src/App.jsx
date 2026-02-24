import { useState, useEffect, useRef, useCallback } from 'react';
import { characters, franchises } from './data/characters';
import { supabase } from './lib/supabase';
import { GeminiLiveSession } from './lib/gemini-live';

function SignInScreen({ onSignIn }) {
  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) console.error('Auth error:', error);
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 via-white to-teal-50 p-6">
      <div className="text-center mb-12">
        <h1 className="text-7xl font-extrabold text-teal-600 drop-shadow-sm">
          📞 Ring Ring
        </h1>
        <p className="text-xl text-gray-400 mt-3 font-medium">Call your favorite characters!</p>
      </div>
      <button
        onClick={handleGoogleSignIn}
        className="flex items-center gap-3 bg-white border-2 border-gray-200 rounded-2xl px-8 py-4 text-lg font-semibold text-gray-700 shadow-md hover:shadow-lg active:scale-95 transition-all"
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </button>
    </div>
  );
}

function CharacterGrid({ onCall, user, onSignOut, onShowHistory }) {
  const grouped = franchises.map(f => ({
    ...f,
    chars: characters.filter(c => c.franchise === f.id)
  }));

  return (
    <div className="min-h-dvh bg-gradient-to-b from-amber-50 via-white to-teal-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-2xl font-extrabold text-teal-600">📞 Ring Ring</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onShowHistory}
            className="text-sm text-gray-500 hover:text-teal-600 font-medium px-3 py-1.5 rounded-full bg-white/80 border border-gray-200"
          >
            📋 History
          </button>
          <button
            onClick={onSignOut}
            className="w-8 h-8 rounded-full overflow-hidden border-2 border-gray-200"
            title="Sign out"
          >
            {user?.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-teal-100 flex items-center justify-center text-xs font-bold text-teal-600">
                {user?.email?.[0]?.toUpperCase() || '?'}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Character Grid */}
      <div className="px-4 pb-8">
        {grouped.map(group => (
          <div key={group.id} className="mb-6">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
              {group.emoji} {group.name}
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {group.chars.map(char => (
                <button
                  key={char.id}
                  onClick={() => onCall(char)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-2xl hover:bg-white/80 active:scale-95 transition-all"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden ring-2 ring-gray-200 shadow-md bg-gradient-to-br from-amber-100 to-teal-100">
                    <img
                      src={char.image}
                      alt={char.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = `<div class="w-full h-full flex items-center justify-center text-2xl">📞</div>`;
                      }}
                    />
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-gray-700 text-center leading-tight">
                    {char.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CallScreen({ character, onHangUp, user }) {
  const [callState, setCallState] = useState('ringing'); // ringing, connected, listening, speaking, error, mic-error
  const [duration, setDuration] = useState(0);
  const [transcripts, setTranscripts] = useState([]);
  const sessionRef = useRef(null);
  const conversationIdRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);

  const handleStateChange = useCallback((state) => {
    if (state === 'connected' || state === 'listening' || state === 'speaking') {
      setCallState(state);
    } else if (state === 'error' || state === 'mic-error') {
      setCallState(state);
    }
  }, []);

  const handleTranscript = useCallback((role, text) => {
    setTranscripts(prev => [...prev, { role, text }]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startCall = async () => {
      // Create conversation record
      try {
        const { data } = await supabase
          .from('conversations')
          .insert({ user_id: user.id, character_id: character.id })
          .select()
          .single();
        if (data) conversationIdRef.current = data.id;
      } catch (e) {
        console.error('Failed to create conversation:', e);
      }

      // Simulate ring for 1.5s then connect
      await new Promise(r => setTimeout(r, 1500));
      if (cancelled) return;

      const session = new GeminiLiveSession({
        character,
        onStateChange: handleStateChange,
        onTranscript: handleTranscript,
      });

      sessionRef.current = session;

      try {
        await session.connect();
        if (cancelled) {
          session.disconnect();
          return;
        }
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      } catch (err) {
        console.error('Connection failed:', err);
        if (!cancelled) setCallState('error');
      }
    };

    startCall();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (sessionRef.current) sessionRef.current.disconnect();
    };
  }, [character, user, handleStateChange, handleTranscript]);

  const hangUp = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (sessionRef.current) sessionRef.current.disconnect();

    // Save conversation data
    if (conversationIdRef.current) {
      try {
        await supabase
          .from('conversations')
          .update({
            ended_at: new Date().toISOString(),
            duration_seconds: duration
          })
          .eq('id', conversationIdRef.current);

        // Save transcripts as messages
        if (transcripts.length > 0) {
          await supabase.from('messages').insert(
            transcripts.map(t => ({
              conversation_id: conversationIdRef.current,
              role: t.role === 'character' ? 'character' : 'user',
              content: t.text
            }))
          );
        }
      } catch (e) {
        console.error('Failed to save conversation:', e);
      }
    }

    onHangUp();
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const stateLabel = {
    ringing: 'Calling...',
    connected: 'Connected',
    listening: '🎙️ Listening...',
    speaking: '🔊 Speaking...',
    error: 'Connection failed',
    'mic-error': 'Microphone access denied',
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-between bg-gradient-to-b from-teal-700 to-sky-900 p-6 pt-16 pb-12">
      {/* Character */}
      <div className="flex flex-col items-center gap-5">
        <div className={`w-36 h-36 rounded-full overflow-hidden ring-4 shadow-2xl transition-all duration-500
          ${callState === 'speaking' ? 'ring-amber-400 scale-110' : ''}
          ${callState === 'listening' ? 'ring-green-400' : ''}
          ${callState === 'ringing' ? 'ring-white/50 animate-pulse' : ''}
          ${callState === 'error' || callState === 'mic-error' ? 'ring-red-400' : ''}
          ${callState === 'connected' ? 'ring-teal-300' : ''}
        `}>
          <img src={character.image} alt={character.name} className="w-full h-full object-cover" />
        </div>
        <h1 className="text-3xl font-extrabold text-white">{character.name}</h1>
        <p className="text-lg text-white/70">{stateLabel[callState] || 'Connecting...'}</p>
        {duration > 0 && (
          <p className="text-white/50 text-sm font-mono">{formatTime(duration)}</p>
        )}
      </div>

      {/* Visual feedback */}
      <div className="flex-1 flex items-center justify-center">
        {callState === 'speaking' && (
          <div className="flex gap-1.5 items-end">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-2 bg-amber-400 rounded-full animate-bounce"
                style={{
                  height: `${20 + Math.random() * 30}px`,
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: '0.6s'
                }}
              />
            ))}
          </div>
        )}
        {callState === 'listening' && (
          <div className="w-16 h-16 rounded-full border-4 border-green-400/50 animate-ping" />
        )}
      </div>

      {/* Hang Up */}
      <button
        onClick={hangUp}
        className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/40 active:scale-90 transition-all hover:bg-red-600"
      >
        <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85a.994.994 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
        </svg>
      </button>
    </div>
  );
}

function HistoryScreen({ user, onBack }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(50);
      setHistory(data || []);
      setLoading(false);
    };
    load();
  }, [user]);

  const getCharacter = (id) => characters.find(c => c.id === id);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-amber-50 via-white to-teal-50">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={onBack} className="text-2xl">←</button>
        <h1 className="text-xl font-bold text-gray-700">Call History</h1>
      </div>

      <div className="px-4 pb-8">
        {loading ? (
          <p className="text-gray-400 text-center mt-8">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-gray-400 text-center mt-8">No calls yet! Tap a character to start.</p>
        ) : (
          <div className="space-y-2">
            {history.map(conv => {
              const char = getCharacter(conv.character_id);
              return (
                <div key={conv.id} className="flex items-center gap-3 bg-white rounded-xl p-3 shadow-sm">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 shrink-0">
                    {char && <img src={char.image} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-700 text-sm">{char?.name || conv.character_id}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(conv.started_at).toLocaleDateString()} · {conv.duration_seconds ? `${Math.floor(conv.duration_seconds / 60)}m ${conv.duration_seconds % 60}s` : 'No duration'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('grid'); // grid, call, history
  const [selectedCharacter, setSelectedCharacter] = useState(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gradient-to-b from-amber-50 via-white to-teal-50">
        <div className="text-4xl animate-pulse">📞</div>
      </div>
    );
  }

  if (!user) {
    return <SignInScreen />;
  }

  if (screen === 'call' && selectedCharacter) {
    return (
      <CallScreen
        character={selectedCharacter}
        user={user}
        onHangUp={() => { setScreen('grid'); setSelectedCharacter(null); }}
      />
    );
  }

  if (screen === 'history') {
    return <HistoryScreen user={user} onBack={() => setScreen('grid')} />;
  }

  return (
    <CharacterGrid
      user={user}
      onCall={(char) => { setSelectedCharacter(char); setScreen('call'); }}
      onSignOut={async () => { await supabase.auth.signOut(); }}
      onShowHistory={() => setScreen('history')}
    />
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import VoiceTest from './VoiceTest';
import { defaultCharacters, franchises, VOICE_OPTIONS } from './data/characters';
import { supabase } from './lib/supabase';
import { GeminiLiveSession } from './lib/gemini-live';
import { generateCharacter } from './lib/generate-character';
import { STYLE_REF_B64 } from './data/style-ref';

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
const CharAvatar = ({ src, alt, size = 'md', className = '', contain = false }) => {
  const sizes = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-[5.5rem] h-[5.5rem] sm:w-[6.5rem] sm:h-[6.5rem] lg:w-28 lg:h-28',
    xl: 'w-44 h-44 sm:w-52 sm:h-52',
  };
  return (
    <div className={`${sizes[size]} rounded-full overflow-hidden bg-white relative shrink-0 ${className}`}>
      <img src={src} alt={alt} className={`absolute inset-0 w-full h-full ${contain ? 'object-contain scale-125' : 'object-cover object-[50%_30%]'}`} />
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


/* ═══════════════════ DELETE BUTTON WITH CONFIRMATION ═══════════════════ */
function DeleteCharButton({ onConfirm }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex gap-2">
        <button onClick={() => { onConfirm(); setConfirming(false); }}
          className="bg-rose-500 hover:bg-rose-600 text-white rounded-xl px-4 py-3.5 font-bold transition-all active:scale-[0.97] text-sm">
          Confirm Delete
        </button>
        <button onClick={() => setConfirming(false)}
          className="bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl px-4 py-3.5 font-bold transition-all active:scale-[0.97] text-sm">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button onClick={() => setConfirming(true)}
      className="bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl px-5 py-3.5 font-bold transition-all active:scale-[0.97]">
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  );
}

/* ═══════════════════ CHARACTER EDITOR MODAL ═══════════════════ */
async function generateCharacterImage(name, description, franchise) {
  const imgKey = import.meta.env.VITE_GEMINI_IMAGE_KEY || import.meta.env.VITE_GEMINI_API_KEY;
  const stylePrompt = `Generate an illustration of this character in EXACTLY the same watercolor cartoon illustration style as the reference image provided. Match the style precisely: soft watercolor paint textures, warm muted colors, bold clean black outlines, friendly rounded proportions, children's storybook quality. The character should look like it belongs in the same series as the reference characters.

Character: ${name}${description ? ' — ' + description : ''}${franchise && franchise !== 'custom' ? ' (from ' + franchise.replace(/-/g, ' ') + ')' : ''}.

STYLE REQUIREMENTS: Watercolor paint texture visible in coloring, bold black outlines around all shapes, warm soft color palette, friendly kid-safe expression, rounded cartoon proportions, portrait upper body centered, pure white background with no border or shadow.`;

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${imgKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: 'image/jpeg', data: STYLE_REF_B64 } },
        { text: stylePrompt }
      ]}],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    })
  });
  const data = await resp.json();
  const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imgPart) throw new Error('No image generated');

  const b64 = imgPart.inlineData.data;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  const fileName = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.png`;
  const { error } = await supabase.storage.from('character-images').upload(fileName, blob, { cacheControl: '3600', upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('character-images').getPublicUrl(fileName);
  return publicUrl;
}

function CharacterEditor({ char, setChar, onSave, onDelete, saving, user, samplingVoice, playVoiceSample, characters }) {
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [showDetails, setShowDetails] = useState(!!char.name);
  const [customFranchise, setCustomFranchise] = useState(
    char.franchise && !franchises.find(f => f.id === char.franchise) && char.franchise !== 'custom' ? char.franchise : ''
  );
  const [showNewFranchise, setShowNewFranchise] = useState(
    char.franchise && !franchises.find(f => f.id === char.franchise) && char.franchise !== 'custom'
  );
  const fileInputRef = useRef(null);

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    try {
      const result = await generateCharacter(aiPrompt);
      const id = (result.name || aiPrompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const charName = result.name || aiPrompt;
      const charDesc = result.description || '';
      const charFranchise = result.franchise || char.franchise || 'custom';
      setChar(p => ({
        ...p,
        id: p.id || id,
        name: charName,
        description: charDesc,
        greeting: result.greeting || p.greeting,
        systemPrompt: result.systemPrompt || p.systemPrompt,
        voiceName: result.voiceName || p.voiceName,
        franchise: charFranchise,
        isCustom: true,
      }));
      setShowDetails(true);
      // Auto-generate image in background
      setGeneratingImage(true);
      try {
        const publicUrl = await generateCharacterImage(charName, charDesc, charFranchise);
        setChar(p => ({ ...p, image: publicUrl }));
      } catch (imgErr) { console.error('Auto image gen failed:', imgErr); }
      setGeneratingImage(false);
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

  const handleGenerateImage = async () => {
    if (!char.name) return alert('Add a name first');
    setGeneratingImage(true);
    try {
      const publicUrl = await generateCharacterImage(char.name, char.description, char.franchise);
      setChar(p => ({ ...p, image: publicUrl }));
    } catch (err) {
      console.error('Image gen failed:', err);
      alert('Image generation failed: ' + err.message);
    }
    setGeneratingImage(false);
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

              {/* Franchise selector on auto-fill screen */}
              <div className="mb-3">
                <div className="flex flex-wrap gap-2">
                  {franchises.map(f => (
                    <button key={f.id} type="button"
                      onClick={() => { setChar(p => ({...p, franchise: f.id})); setShowNewFranchise(false); setCustomFranchise(''); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                        char.franchise === f.id && !showNewFranchise
                          ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-teal-300'
                      }`}>
                      {f.emoji} {f.name}
                    </button>
                  ))}
                  <button type="button"
                    onClick={() => { setShowNewFranchise(true); setChar(p => ({...p, franchise: customFranchise || 'custom'})); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                      showNewFranchise
                        ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-teal-300'
                    }`}>
                    + New
                  </button>
                </div>
                {showNewFranchise && (
                  <input type="text" value={customFranchise}
                    onChange={e => {
                      const val = e.target.value;
                      setCustomFranchise(val);
                      setChar(p => ({...p, franchise: val.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom'}));
                    }}
                    className="mt-2 w-full bg-white rounded-xl px-4 py-2.5 text-[#1A1A2E] font-medium border border-teal-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 outline-none transition-all text-sm"
                    placeholder="e.g. DC Comics, Sesame Street, Pixar..."
                    autoFocus />
                )}
              </div>

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
                    {generatingImage ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 animate-spin text-teal-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                    ) : char.image ? (
                      <img src={char.image} alt="" className="absolute inset-0 w-full h-full object-cover object-[50%_30%]" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button onClick={handleGenerateImage} disabled={generatingImage || !char.name}
                        className="flex-1 bg-teal-50 rounded-xl px-3 py-2.5 text-sm font-semibold text-teal-600 border border-teal-200 hover:border-teal-400 transition-all active:scale-[0.97] disabled:opacity-50">
                        {generatingImage ? 'Generating…' : '✨ Generate'}
                      </button>
                      <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="flex-1 bg-white rounded-xl px-3 py-2.5 text-sm font-semibold text-[#4285F4] border border-slate-200 hover:border-[#4285F4] transition-all active:scale-[0.97]">
                        {uploading ? 'Uploading…' : 'Upload'}
                      </button>
                    </div>
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
                  <select value={showNewFranchise ? '__new__' : char.franchise}
                    onChange={e => {
                      if (e.target.value === '__new__') {
                        setShowNewFranchise(true);
                        setChar(p => ({...p, franchise: customFranchise || 'custom'}));
                      } else {
                        setShowNewFranchise(false);
                        setCustomFranchise('');
                        setChar(p => ({...p, franchise: e.target.value}));
                      }
                    }}
                    className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] outline-none">
                    {franchises.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    <option value="__new__">+ New...</option>
                  </select>
                  {showNewFranchise && (
                    <input type="text" value={customFranchise}
                      onChange={e => {
                        const val = e.target.value;
                        setCustomFranchise(val);
                        setChar(p => ({...p, franchise: val.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom'}));
                      }}
                      className="mt-2 w-full bg-white rounded-xl px-3 py-2.5 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all text-sm"
                      placeholder="e.g. DC Comics"
                      autoFocus />
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Voice</label>
                  <div className="flex gap-2">
                    <select value={char.voiceName}
                      onChange={e => setChar(p => ({...p, voiceName: e.target.value}))}
                      className="flex-1 bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] outline-none min-w-0">
                      {VOICE_OPTIONS.map(v => (
                        <option key={v.value} value={v.value}>{v.label} — {v.desc}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => playVoiceSample(char.voiceName)}
                      className={`px-2.5 rounded-xl border transition-all active:scale-95 flex items-center justify-center shrink-0 ${
                        samplingVoice === char.voiceName
                          ? 'bg-rose-50 border-rose-300 text-rose-500' : 'bg-white border-slate-200 text-slate-400 hover:text-[#4285F4] hover:border-[#4285F4]'
                      }`} title={samplingVoice === char.voiceName ? 'Stop' : 'Play sample'}>
                      {samplingVoice === char.voiceName ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      )}
                    </button>
                  </div>
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
                {char.id && (
                  <DeleteCharButton onConfirm={() => onDelete(char.id)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AppRouter() {
  if (window.location.pathname === '/voice-test') return <VoiceTest />;
  return <App />;
}

export { AppRouter };

export default function App() {
  const [user, setUser] = useState(null);
  const [screen, setScreenRaw] = useState('login');
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [callState, setCallState] = useState('idle');
  const [duration, setDuration] = useState(0);
  const [history, setHistory] = useState([]);
  const [characters, setCharacters] = useState(defaultCharacters);
  const [error, setError] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ring_favorites') || '[]'); } catch { return []; }
  });
  const toggleFavorite = (charId) => {
    setFavorites(prev => {
      const next = prev.includes(charId) ? prev.filter(id => id !== charId) : [...prev, charId];
      localStorage.setItem('ring_favorites', JSON.stringify(next));
      return next;
    });
  };

  // URL slug sync
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const screenToPath = { shelf: '/', history: '/history', characters: '/characters', profile: '/profile', settings: '/settings', login: '/login', call: '/call', transcript: '/transcript', about: '/about' };
  const pathToScreen = Object.fromEntries(Object.entries(screenToPath).map(([k, v]) => [v, k]));

  const setScreen = useCallback((s, charSlug) => {
    setScreenRaw(s);
    if (s === 'call' && charSlug) {
      window.history.pushState(null, '', `/${charSlug}`);
    } else if (s === 'characters' && charSlug) {
      window.history.pushState(null, '', `/characters/${charSlug}`);
    } else {
      const path = screenToPath[s] || '/';
      if (window.location.pathname !== path) window.history.pushState(null, '', path);
    }
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      const s = pathToScreen[path];
      if (s) { setScreenRaw(s); }
      else if (path.startsWith('/characters/')) {
        const slug = path.split('/')[2];
        const char = characters.find(c => c.id === slug);
        if (char) { setEditingChar({...char}); setScreenRaw('characters'); }
        else { setScreenRaw('characters'); }
      }
      else if (path !== '/login' && path !== '/') {
        const slug = path.slice(1);
        const char = characters.find(c => c.id === slug);
        if (char && user) { setActiveCharacter(char); setScreenRaw('call'); }
        else { setScreenRaw('shelf'); }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [characters, user]);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  // Profile state
  const [profile, setProfile] = useState({
    display_name: '', birthdate: '', interests: '', favorite_color: '',
    favorite_animal: '', favorite_food: '', favorite_movie: '', about_me: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    sound_effects: true, auto_save_transcripts: true,
    default_voice: 'Puck', call_timer_visible: true, debug_mode: false, interruptible: true,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [samplingVoice, setSamplingVoice] = useState(null);
  const sampleAudioRef = useRef(null);

  const playVoiceSample = (voiceName) => {
    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current = null;
      if (samplingVoice === voiceName) { setSamplingVoice(null); return; }
    }
    setSamplingVoice(voiceName);
    const audio = new Audio(`/voice-samples/${encodeURIComponent(voiceName)}.wav`);
    audio.onended = () => { setSamplingVoice(null); sampleAudioRef.current = null; };
    audio.onerror = () => { setSamplingVoice(null); sampleAudioRef.current = null; };
    audio.play();
    sampleAudioRef.current = audio;
  };

  // Ringing sound (respects settings)
  useRingSound(screen === 'call' && callState === 'ringing' && settings.sound_effects);

  // Transcript viewer
  const [viewingTranscript, setViewingTranscript] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [transcriptMessages, setTranscriptMessages] = useState([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Characters editor
  const [editingChar, setEditingChar] = useState(null);
  const [charSaving, setCharSaving] = useState(false);

  const sessionRef = useRef(null);
  const [debugPrompt, setDebugPrompt] = useState(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [muted, setMuted] = useState(false);
  const timerRef = useRef(null);
  const callSetupRef = useRef(null);
  const callAbortedRef = useRef(false);
  const pendingSlugRef = useRef(null);
  const callReleasedRef = useRef(false);
  const transcriptRef = useRef([]);
  const dbRecordIdRef = useRef(null);

  /* ═══════════ Load characters from Supabase ═══════════ */
  const loadCharacters = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('characters').select('*').order('franchise');
      if (data && data.length > 0) {
        // Map DB fields to app fields
        const mapped = data.map(c => ({
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
        }));
        // Sort to match defaultCharacters order (known chars first, then by DB order)
        const orderMap = {};
        defaultCharacters.forEach((c, i) => { orderMap[c.id] = i; });
        mapped.sort((a, b) => {
          const ai = orderMap[a.id] ?? 9999;
          const bi = orderMap[b.id] ?? 9999;
          if (a.franchise !== b.franchise) return a.franchise.localeCompare(b.franchise);
          return ai - bi;
        });
        setCharacters(mapped);
        // Resolve pending slug from URL if character wasn't in defaults
        if (pendingSlugRef.current) {
          const pendingChar = mapped.find(c => c.id === pendingSlugRef.current);
          if (pendingChar) {
            setActiveCharacter(pendingChar);
            setScreenRaw('call');
          }
          pendingSlugRef.current = null;
        }
      }
    } catch (err) {
      console.error('Failed to load characters:', err);
    }
  }, []);

  const loadProfile = useCallback(async (userId) => {
    try {
      const { data } = await supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
      if (data) setProfile({
        display_name: data.display_name || '', birthdate: data.birthdate || '',
        interests: data.interests || '', favorite_color: data.favorite_color || '',
        favorite_animal: data.favorite_animal || '', favorite_food: data.favorite_food || '',
        favorite_movie: data.favorite_movie || '', about_me: data.about_me || '',
      });
    } catch (e) { /* no profile yet */ }
  }, []);

  const loadSettings = useCallback(async (userId) => {
    try {
      const cached = localStorage.getItem('ring_settings');
      if (cached) setSettings(JSON.parse(cached));
      const { data } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
      if (data) {
        const s = {
          sound_effects: data.sound_effects ?? true, auto_save_transcripts: data.auto_save_transcripts ?? true,
          default_voice: data.default_voice || 'Puck', call_timer_visible: data.call_timer_visible ?? true, debug_mode: data.debug_mode ?? false, interruptible: data.interruptible ?? true,
        };
        setSettings(s);
        localStorage.setItem('ring_settings', JSON.stringify(s));
      }
    } catch (e) { /* no settings yet */ }
  }, []);

  useEffect(() => {
    const restoreScreen = () => {
      const path = window.location.pathname;
      if (path.startsWith('/characters/')) {
        const slug = path.split('/')[2];
        if (slug) {
          const char = defaultCharacters.find(c => c.id === slug);
          if (char) setEditingChar({...char});
        }
        setScreenRaw('characters');
        return;
      }
      const mapped = pathToScreen[path];
      if (mapped && mapped !== 'login') { setScreenRaw(mapped); return; }
      // Top-level /<slug> → open that character's call
      const slug = path.slice(1);
      if (slug && slug !== 'login') {
        const char = defaultCharacters.find(c => c.id === slug);
        if (char) { setActiveCharacter(char); setScreenRaw('call'); return; }
        // Character might be DB-only (not in defaults); store slug to resolve after load
        pendingSlugRef.current = slug;
      }
      setScreenRaw('shelf');
    };
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) { restoreScreen(); loadCharacters(); loadProfile(session.user.id); loadSettings(session.user.id); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { restoreScreen(); loadCharacters(); loadProfile(session.user.id); loadSettings(session.user.id); }
    });
    return () => subscription.unsubscribe();
  }, [loadCharacters, loadProfile, loadSettings]);

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
    options: { redirectTo: window.location.href }
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setScreen('login');
  };

  const startCall = async (character) => {
    setActiveCharacter(character);
    setScreen('call', character.id);
    callAbortedRef.current = false;
    callReleasedRef.current = false;
    setCallState('ringing');
    setMuted(false);
    setDuration(0);
    setError(null);
    transcriptRef.current = [];
    dbRecordIdRef.current = null;

    // Warm up AudioContext on user gesture (browser requires this)
    getRingCtx();

    try {
      const { data } = await supabase.from('conversations')
        .insert({ user_id: user.id, character_id: character.id })
        .select().single();
      if (data) dbRecordIdRef.current = data.id;
    } catch (err) { console.error('DB error:', err); }

    // Fetch past conversations with this character for context
    let pastConversations = [];
    try {
      const { data: convos } = await supabase.from('conversations')
        .select('id, started_at')
        .eq('user_id', user.id).eq('character_id', character.id)
        .gt('duration_seconds', 0)
        .order('started_at', { ascending: false }).limit(3);
      if (convos && convos.length > 0) {
        const convoIds = convos.map(c => c.id);
        const { data: msgs } = await supabase.from('messages')
          .select('conversation_id, role, content')
          .in('conversation_id', convoIds)
          .order('created_at', { ascending: true });
        pastConversations = convos.map(c => ({
          ...c,
          messages: (msgs || []).filter(m => m.conversation_id === c.id)
        }));
      }
    } catch (err) { console.error('Failed to load past convos:', err); }

    // Start connecting immediately — ring plays in parallel
    const session = new GeminiLiveSession({
      character,
      userProfile: profile,
      pastConversations,
      interruptible: settings.interruptible,
      onStateChange: (state) => {
        if (callAbortedRef.current) return;
        // Suppress state changes until audio is released after ring period
        if (!callReleasedRef.current && (state === 'listening' || state === 'connected')) {
          return;
        }
        setCallState(state);
        if (state === 'error' || state === 'mic-error') {
          setError(state === 'mic-error' ? 'Microphone access denied. Please allow mic access and try again.' : 'Connection failed. Check your internet and try again.');
        }
        // Auto-cleanup on unexpected disconnect
        if (state === 'disconnected' && sessionRef.current) {
          sessionRef.current = null;
          clearInterval(timerRef.current);
          setInputLevel(0);
          setOutputLevel(0);
          setError('Call dropped — tap to redial');
          setCallState('error');
        }
      },
      onTranscript: (role, text) => {
        const arr = transcriptRef.current;
        const last = arr[arr.length - 1];
        if (last && last.role === role) {
          last.text += text;
        } else {
          arr.push({ role, text, ts: Date.now() });
        }
      },
      onInputLevel: setInputLevel,
      onOutputLevel: setOutputLevel,
    });

    sessionRef.current = session;
    setDebugPrompt(session.getSystemPrompt());

    // Connect in background while ring plays
    session.connect().catch((err) => {
      if (callAbortedRef.current) return;
      console.error('Call failed:', err);
      setCallState('error');
      setError(`Connection failed: ${err.message}`);
    });

    // After ring period, release held audio so the character's voice plays
    callSetupRef.current = setTimeout(() => {
      callSetupRef.current = null;
      if (callAbortedRef.current) return;
      callReleasedRef.current = true;
      setCallState('connected');
      session.releaseAudio();
    }, 1200);
  };

  const handleHangUp = async () => {
    // Cancel the ringing-delay timeout if still pending
    callAbortedRef.current = true;
    if (callSetupRef.current) {
      clearTimeout(callSetupRef.current);
      callSetupRef.current = null;
    }
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }
    clearInterval(timerRef.current);
    setCallState('idle');
    setInputLevel(0);
    setOutputLevel(0);
    setDuration(0);
    setError(null);

    if (dbRecordIdRef.current) {
      try {
        // Don't save 0-duration calls — just delete the record
        if (duration === 0) {
          await supabase.from('conversations').delete().eq('id', dbRecordIdRef.current);
        } else {
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
                content: t.text,
                created_at: new Date(t.ts).toISOString()
              }))
          );
          }
        }
      } catch (err) { console.error('Save failed:', err); }
    }

    setActiveCharacter(null);
    return; // caller sets screen
  };

  const deleteConversation = async (id) => {
    try {
      await supabase.from('messages').delete().eq('conversation_id', id);
      await supabase.from('conversations').delete().eq('id', id);
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (err) { console.error('Delete failed:', err); }
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
      setEditingChar(null); if (window.location.pathname.startsWith('/characters/')) window.history.pushState(null, '', '/characters');
    } catch (err) {
      console.error('Save character failed:', err);
      alert('Failed to save: ' + err.message);
    }
    setCharSaving(false);
  };

  const deleteCharacter = async (charId) => {
    try {
      await supabase.from('characters').delete().eq('id', charId);
      await loadCharacters();
      setEditingChar(null); if (window.location.pathname.startsWith('/characters/')) window.history.pushState(null, '', '/characters');
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete: ' + err.message);
    }
  };

  const avatarMenuRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target)) setShowAvatarMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      const row = { user_id: user.id, ...profile, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('user_profiles').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
    } catch (err) { alert('Save failed: ' + err.message); }
    setProfileSaving(false);
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      const row = { user_id: user.id, ...settings, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      localStorage.setItem('ring_settings', JSON.stringify(settings));
    } catch (err) { alert('Save failed: ' + err.message); }
    setSettingsSaving(false);
  };

  const deleteAllData = async () => {
    try {
      // Delete messages for user's conversations
      const { data: convos } = await supabase.from('conversations').select('id').eq('user_id', user.id);
      if (convos?.length) {
        const ids = convos.map(c => c.id);
        await supabase.from('messages').delete().in('conversation_id', ids);
      }
      await supabase.from('conversations').delete().eq('user_id', user.id);
      await supabase.from('user_profiles').delete().eq('user_id', user.id);
      await supabase.from('user_settings').delete().eq('user_id', user.id);
      localStorage.removeItem('ring_settings');
      await supabase.auth.signOut();
      setScreen('login');
    } catch (err) { alert('Delete failed: ' + err.message); }
  };

  const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  /* ═══════════════════ SIGN IN ═══════════════════ */
  if (screen === 'login') {
    // Check if URL points to a specific character
    const slug = window.location.pathname.slice(1);
    const loginChar = slug && slug !== 'login' ? defaultCharacters.find(c => c.id === slug) : null;
    return (
      <div className="min-h-dvh bg-[#FFFBF5] flex flex-col items-center justify-center px-6 sm:px-12">
        <GlobalStyles />
        <div className="flex flex-col items-center -mt-8">
          {loginChar ? (
            <>
              <div className="relative mb-6">
                <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-white shadow-lg shadow-black/5 border-2 border-white overflow-hidden flex items-center justify-center">
                  <img src={loginChar.image} alt={loginChar.name} className={`w-full h-full ${loginChar.franchise === 'dog-man' ? 'object-contain scale-125' : 'object-cover'}`} />
                </div>
                <div className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-green-400 border-3 border-[#FFFBF5] flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                </div>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1A1A2E] mb-1">{loginChar.name}</h2>
              <p className="text-sm sm:text-base text-slate-400 font-medium mb-2 text-center max-w-xs">{loginChar.description}</p>
              <p className="text-xs text-slate-300 mb-10 text-center">Sign in to start a voice call</p>
            </>
          ) : (
            <>
              <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="w-72 sm:w-96 mb-4 select-none" />
              <p className="text-base text-slate-400 font-medium mt-2 mb-16 text-center max-w-xs">
                Talk to your favorite characters
              </p>
            </>
          )}
          <button onClick={handleLogin}
            className="flex items-center gap-3 bg-[#4285F4] hover:bg-[#3B78DB] text-white rounded-full px-8 py-3 font-semibold text-base shadow-md shadow-[#4285F4]/20 active:scale-[0.97] transition-all duration-200">
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".9"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".8"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".85"/>
            </svg>
            Continue with Google
          </button>
          {loginChar && (
            <>
              <button onClick={() => { window.history.pushState(null, '', '/'); setScreenRaw('login'); }}
                className="mt-4 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                ← Browse all characters
              </button>
              <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="w-40 sm:w-52 mt-10 opacity-60 select-none" />
            </>
          )}
        </div>
      </div>
    );
  }

  /* ═══════════════════ CHARACTER GRID ═══════════════════ */
  if (screen === 'shelf') {
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <header className="sticky top-0 z-50 h-16 sm:h-28 bg-[#FFFBF5]/85 backdrop-blur-xl border-b border-[#1A1A2E]/5">
          <div className="h-full max-w-4xl mx-auto px-3 sm:px-12 flex items-center justify-between">
            <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="h-8 sm:h-16 shrink-0" />
            <div className="flex items-center gap-3 sm:gap-5">
              <button onClick={async () => {
                  setScreen('history');
                  const { data } = await supabase.from('conversations').select('*')
                    .eq('user_id', user.id).gt('duration_seconds', 0).order('started_at', { ascending: false });
                  setHistory(data || []);
                }}
                className="text-[11px] sm:text-[13px] font-semibold sm:font-bold uppercase tracking-normal sm:tracking-widest text-slate-400 hover:text-[#4285F4] transition-colors">
                History
              </button>
              <button onClick={() => setScreen('characters')}
                className="text-[11px] sm:text-[13px] font-semibold sm:font-bold uppercase tracking-normal sm:tracking-widest text-slate-400 hover:text-[#4285F4] transition-colors">
                Characters
              </button>
              <div className="relative" ref={avatarMenuRef}>
                <button onClick={() => setShowAvatarMenu(p => !p)}
                  className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-slate-200 hover:ring-[#4285F4] transition-all">
                  {user?.user_metadata?.avatar_url ? (
                    <img src={user.user_metadata.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                  ) : null}
                  <div className={`w-full h-full bg-[#4285F4] items-center justify-center text-white text-sm font-bold ${user?.user_metadata?.avatar_url ? 'hidden' : 'flex'}`} style={user?.user_metadata?.avatar_url ? { display: 'none' } : {}}>
                    {user?.email?.charAt(0).toUpperCase() || '?'}
                  </div>
                </button>
                {showAvatarMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-[#FFFBF5] rounded-2xl shadow-lg shadow-black/10 border border-slate-100 py-2 z-[60]">
                    {/* User info header */}
                    <div className="px-5 py-3 border-b border-slate-100 mb-1">
                      <div className="text-sm font-bold text-[#1A1A2E] truncate">{user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}</div>
                      <div className="text-xs text-slate-400 truncate">{user?.email}</div>
                    </div>
                    <button onClick={() => { setShowAvatarMenu(false); setScreen('about'); }}
                      className="w-full text-left px-5 py-3 text-sm font-semibold text-[#1A1A2E] hover:bg-white/80 transition-colors flex items-center gap-3">
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                      About Ring Ring Ring
                    </button>
                    <button onClick={async () => {
                      setShowAvatarMenu(false);
                      try {
                        const [profileRes, settingsRes, convosRes] = await Promise.all([
                          supabase.from('user_profiles').select('*').eq('user_id', user.id),
                          supabase.from('user_settings').select('*').eq('user_id', user.id),
                          supabase.from('conversations').select('*').eq('user_id', user.id),
                        ]);
                        const convos = convosRes.data || [];
                        let messages = [];
                        if (convos.length) {
                          const { data } = await supabase.from('messages').select('*').in('conversation_id', convos.map(c => c.id));
                          messages = data || [];
                        }
                        const blob = new Blob([JSON.stringify({ profile: profileRes.data, settings: settingsRes.data, conversations: convos, messages }, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = `ring-ring-ring-data-${new Date().toISOString().slice(0,10)}.json`; a.click();
                        URL.revokeObjectURL(url);
                      } catch (err) { alert('Export failed: ' + err.message); }
                    }}
                      className="w-full text-left px-5 py-3 text-sm font-semibold text-[#1A1A2E] hover:bg-white/80 transition-colors flex items-center gap-3">
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                      Download my data
                    </button>
                    <div className="mx-4 my-1 h-px bg-slate-100" />
                    <button onClick={() => { setShowAvatarMenu(false); setDeleteConfirmText(''); setShowDeleteModal(true); }}
                      className="w-full text-left px-5 py-3 text-sm font-semibold text-rose-500 hover:bg-rose-50 transition-colors flex items-center gap-3">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                      Delete all data
                    </button>
                    <button onClick={() => { setShowAvatarMenu(false); handleLogout(); }}
                      className="w-full text-left px-5 py-3 text-sm font-semibold text-slate-500 hover:bg-white/80 transition-colors flex items-center gap-3">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-8 sm:px-12 pt-10 pb-24">
          {/* Favorites section */}
          {favorites.length > 0 && (() => {
            const favChars = favorites.map(id => characters.find(c => c.id === id)).filter(Boolean);
            if (!favChars.length) return null;
            return (
              <section className="mb-14 sm:mb-20">
                <h2 className="text-[13px] font-bold uppercase tracking-widest text-rose-400 mb-7 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                  Favorites
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-5 gap-y-8 sm:gap-x-7 sm:gap-y-10">
                  {favChars.map(char => (
                    <button key={char.id} onClick={() => startCall(char)}
                      className="group flex flex-col items-center gap-3 outline-none active:scale-[0.93] transition-transform duration-150">
                      <div className="shadow-md group-hover:shadow-xl group-hover:scale-[1.05] transition-all duration-200 rounded-full">
                        <CharAvatar src={char.image} alt={char.name} size="lg" contain={char.franchise === 'dog-man'} />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-slate-500 group-hover:text-[#4285F4] transition-colors text-center leading-tight">
                        {char.name}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })()}

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
                        <CharAvatar src={char.image} alt={char.name} size="lg" contain={char.franchise === 'dog-man'} />
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

          {/* Custom franchise sections + ungrouped custom characters */}
          {(() => {
            const knownIds = franchises.map(f => f.id);
            const customChars = characters.filter(c => !knownIds.includes(c.franchise));
            // Group by franchise name
            const groups = {};
            customChars.forEach(c => {
              const key = c.franchise || 'custom';
              if (!groups[key]) groups[key] = [];
              groups[key].push(c);
            });
            return Object.entries(groups).map(([key, chars]) => (
              <section key={key} className="mt-14 sm:mt-20">
                <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-7">
                  {key === 'custom' ? 'Custom' : key.replace(/-/g, ' ')}
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-5 gap-y-8 sm:gap-x-7 sm:gap-y-10">
                  {chars.map(char => (
                    <button key={char.id} onClick={() => startCall(char)}
                      className="group flex flex-col items-center gap-3 outline-none active:scale-[0.93] transition-transform duration-150">
                      <div className="shadow-md group-hover:shadow-xl group-hover:scale-[1.05] transition-all duration-200 rounded-full">
                        <CharAvatar src={char.image} alt={char.name} size="lg" contain={char.franchise === 'dog-man'} />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-slate-500 group-hover:text-[#4285F4] transition-colors text-center leading-tight">
                        {char.name}
                      </span>
                    </button>
                ))}
              </div>
            </section>
          ));
          })()}
        </main>

        {/* Delete All Data Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-[#FFFBF5] rounded-2xl shadow-xl max-w-sm w-full p-6">
              <h3 className="text-lg font-bold text-[#1A1A2E] mb-2">Delete All Data</h3>
              <p className="text-sm text-slate-500 mb-4">This will permanently delete all your conversations, messages, profile, and settings. This cannot be undone.</p>
              <p className="text-sm font-semibold text-slate-600 mb-2">Type <span className="font-mono text-rose-500">DELETE</span> to confirm:</p>
              <input type="text" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-300 mb-4"
                placeholder="DELETE" autoFocus />
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteModal(false)}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={async () => { if (deleteConfirmText === 'DELETE') { setShowDeleteModal(false); await deleteAllData(); } }}
                  disabled={deleteConfirmText !== 'DELETE'}
                  className={`flex-1 px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors ${deleteConfirmText === 'DELETE' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-300 cursor-not-allowed'}`}>Delete Everything</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════ ABOUT SCREEN ═══════════════════ */
  if (screen === 'about') {
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <div className="max-w-2xl mx-auto px-8 sm:px-12 pt-10 pb-24">
          <BackHeader label="About" onBack={() => setScreen('shelf')} />

          <div className="mt-8 flex flex-col items-center mb-10">
            <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="h-16 sm:h-20 mb-4" />
            <p className="text-slate-500 text-sm text-center max-w-md">A voice-based character conversation app where you call fun characters and have real-time voice chats.</p>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#4285F4] mb-3">How It Works</h3>
              <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
                <li>Pick a character from the collection</li>
                <li>Call them with one tap</li>
                <li>Have a real-time voice conversation</li>
              </ol>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#4285F4] mb-3">Features</h3>
              <ul className="text-sm text-slate-600 space-y-2">
                <li className="flex items-center gap-2"><span className="text-[#4285F4]">✦</span> 20+ unique characters to call</li>
                <li className="flex items-center gap-2"><span className="text-[#4285F4]">✦</span> Real-time voice powered by Gemini</li>
                <li className="flex items-center gap-2"><span className="text-[#4285F4]">✦</span> Full conversation history & transcripts</li>
                <li className="flex items-center gap-2"><span className="text-[#4285F4]">✦</span> Favorite your top characters</li>
                <li className="flex items-center gap-2"><span className="text-[#4285F4]">✦</span> Create custom characters</li>
              </ul>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#4285F4] mb-3">Your Data</h3>
              <p className="text-sm text-slate-600">Your data is stored securely in Supabase. You can download a copy of all your data or delete everything at any time from the menu.</p>
            </div>
          </div>
        </div>
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
      <div className="min-h-dvh bg-white flex flex-col items-center relative overflow-hidden">
        <GlobalStyles />

        {/* Top bar — logo centered, back + edit on sides */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between pt-14 px-6 sm:pt-16 sm:px-8">
          <button onClick={async () => { await handleHangUp(); setScreen('shelf'); }} className="flex items-center gap-2 text-slate-400 hover:text-slate-600 active:scale-95 transition-all">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <img src="/logo-trimmed.png" alt="Ring Ring Ring" className="h-10 sm:h-12 opacity-80" />
          <button onClick={async () => { const char = {...activeCharacter}; await handleHangUp(); setEditingChar(char); setScreen('characters', char.id); }} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 active:scale-95 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        </div>

        {/* Massive character image — seamless with white bg */}
        <div className="flex-1 flex flex-col items-center justify-center w-full pt-20 pb-0 overflow-hidden">
          <img src={activeCharacter.image} alt={activeCharacter.name}
            className={`${activeCharacter.franchise === 'dog-man' ? 'w-[70vw] max-w-[400px]' : 'w-[130vw] max-w-[800px]'} object-contain transition-transform duration-500 ${speaking ? 'scale-[1.06]' : ''}`} />
        </div>

        {/* Bottom controls area */}
        <div className="w-full max-w-sm px-8 pb-12 sm:pb-16 flex flex-col items-center">
          {/* Name + favorite */}
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-2xl sm:text-3xl font-black text-[#1A1A2E] tracking-tight">
              {activeCharacter.name}
            </h2>
            <button onClick={() => toggleFavorite(activeCharacter.id)} className="text-slate-300 hover:text-rose-400 transition-all active:scale-90">
              {favorites.includes(activeCharacter.id) ? (
                <svg className="w-6 h-6 text-rose-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
              )}
            </button>
          </div>

          {/* Audio visualizer / status */}
          <div className="w-full h-16 mb-3">
            {(listening || speaking) ? (
              <AudioVisualizer
                inputLevel={muted && !speaking ? 0 : inputLevel}
                outputLevel={outputLevel}
                isActive={true}
                isSpeaking={speaking}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                {ringing && <span className="text-[#4285F4] font-semibold animate-pulse">Calling…</span>}
                {hasError && <span className="text-[#EA4335] font-semibold text-sm text-center px-4">{error}</span>}
                {callState === 'connected' && <span className="text-slate-400 font-semibold">Connected</span>}
              </div>
            )}
          </div>

          {/* Timer + controls */}
          <div className="flex flex-col items-center gap-5">
            {settings.call_timer_visible && <span className="font-mono text-xs tracking-widest text-slate-400">{fmt(duration)}</span>}
            <div className="flex items-center gap-6">
              {/* Mute button */}
              <button onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  sessionRef.current?.setMuted(next);
                }}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 ${
                  muted ? 'bg-[#EA4335]/10' : 'bg-slate-100 hover:bg-slate-200'
                }`}>
                {muted ? (
                  <svg className="w-6 h-6 text-[#EA4335]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 9.34V4a3 3 0 00-5.94-.6M9 9v3a3 3 0 005.12 2.12M3 3l18 18" />
                    <path d="M19 10v1a7 7 0 01-11.48 5.38M5 10v1a7 7 0 00.91 3.46M12 19v3m-4 0h8" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>

              {/* Hang up button */}
              <button onClick={async () => { await handleHangUp(); setScreen('shelf'); }}
                className="w-16 h-16 bg-[#EA4335] rounded-full flex items-center justify-center shadow-lg shadow-[#EA4335]/20 active:scale-90 hover:bg-[#D33828] transition-all duration-200">
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85a.994.994 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* AI disclaimer + debug toggle */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <p className="text-[11px] text-slate-300 text-center">AI-powered voice • Characters are fictional parodies</p>
            <button onClick={() => setShowDebugPanel(p => !p)} className="text-slate-200 hover:text-slate-400 transition-colors" title="Debug info">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </button>
          </div>

          {/* Debug panel */}
          {showDebugPanel && (
            <div className="mt-3 w-full bg-slate-50 rounded-2xl border border-slate-100 p-4 text-[10px] text-slate-500 space-y-3 max-h-[50vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[11px] text-slate-600">Debug Info</span>
                <button onClick={() => setShowDebugPanel(false)} className="text-slate-400 hover:text-slate-600">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Model:</span>{' '}
                <span className="font-mono">gemini-2.5-flash-native-audio-preview-12-2025</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Voice:</span>{' '}
                <span className="font-mono">{activeCharacter.voiceName || 'Kore'}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Character ID:</span>{' '}
                <span className="font-mono">{activeCharacter.id}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Franchise:</span>{' '}
                <span className="font-mono">{activeCharacter.franchise}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Call State:</span>{' '}
                <span className="font-mono">{callState}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Duration:</span>{' '}
                <span className="font-mono">{duration}s</span>
              </div>
              <div>
                <span className="font-semibold text-slate-600">Transcript Turns:</span>{' '}
                <span className="font-mono">{transcriptRef.current.length}</span>
              </div>
              {debugPrompt && (
                <details>
                  <summary className="font-semibold text-slate-600 cursor-pointer">System Prompt ▸</summary>
                  <pre className="mt-2 text-[9px] text-slate-400 bg-white rounded-xl p-3 whitespace-pre-wrap break-words max-h-60 overflow-y-auto border border-slate-100">{debugPrompt}</pre>
                </details>
              )}
            </div>
          )}
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
              {history.filter(rec => rec.duration_seconds > 0).map(rec => {
                const char = characters.find(c => c.id === rec.character_id);
                if (!char) return null;
                return (
                  <div key={rec.id} className="relative group">
                    <div className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
                      {/* Tap avatar/name area to view transcript */}
                      <button onClick={() => { setViewingTranscript(rec); loadTranscript(rec.id); setScreen('transcript'); }}
                        className="flex items-center gap-4 flex-1 min-w-0 text-left">
                        <CharAvatar src={char.image} alt={char.name} size="md" contain={char.franchise === 'dog-man'} />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-[#1A1A2E]">{char.name}</p>
                          <p className="text-[13px] text-slate-400 mt-0.5">
                            {new Date(rec.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      </button>
                      {/* Right side: duration, call, delete */}
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="font-mono text-xs text-slate-300">{fmt(rec.duration_seconds || 0)}</span>
                        <button onClick={() => startCall(char)}
                          className="w-8 h-8 bg-[#34A853] hover:bg-[#2d9249] rounded-full flex items-center justify-center transition-all active:scale-90"
                          title={`Call ${char.name}`}>
                          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {confirmingDeleteId === rec.id ? (
                      <div className="absolute -right-2 -top-2 flex gap-1 z-10">
                        <button onClick={(e) => { e.stopPropagation(); deleteConversation(rec.id); setConfirmingDeleteId(null); }}
                          className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-full px-3 py-1.5 shadow-sm transition-all active:scale-90">
                          Delete
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(null); }}
                          className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs font-bold rounded-full px-3 py-1.5 shadow-sm transition-all active:scale-90">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmingDeleteId(rec.id); }}
                        className="absolute -right-2 -top-2 bg-white border border-slate-200 hover:bg-rose-50 hover:border-rose-300 text-slate-300 hover:text-rose-500 rounded-full w-7 h-7 flex items-center justify-center shadow-sm transition-all active:scale-90 z-10"
                        title="Delete">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
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
            {char && <CharAvatar src={char.image} alt={char.name} size="md" contain={char.franchise === 'dog-man'} />}
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
                    <button key={char.id} onClick={() => { setEditingChar({...char}); window.history.pushState(null, "", `/characters/${char.id}`); }}
                      className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow text-left w-full">
                      <CharAvatar src={char.image} alt={char.name} size="sm" contain={char.franchise === 'dog-man'} />
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

          {/* Custom franchise sections */}
          {(() => {
            const knownIds = franchises.map(f => f.id);
            const customChars = characters.filter(c => !knownIds.includes(c.franchise));
            const groups = {};
            customChars.forEach(c => {
              const key = c.franchise || 'custom';
              if (!groups[key]) groups[key] = [];
              groups[key].push(c);
            });
            return Object.entries(groups).map(([key, chars]) => (
              <div key={key} className="mb-10">
                <h3 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-4">
                  {key === 'custom' ? 'Custom' : key.replace(/-/g, ' ')}
                </h3>
                <div className="flex flex-col gap-2">
                  {chars.map(char => (
                    <button key={char.id} onClick={() => { setEditingChar({...char}); window.history.pushState(null, "", `/characters/${char.id}`); }}
                      className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow text-left w-full">
                      <CharAvatar src={char.image} alt={char.name} size="sm" contain={char.franchise === 'dog-man'} />
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
            ));
          })()}
        </main>

        {/* ═══ Character Editor Modal ═══ */}
        {editingChar && <CharacterEditor
          char={editingChar}
          setChar={(c) => { setEditingChar(c); if (!c && window.location.pathname.startsWith('/characters/')) window.history.pushState(null, '', '/characters'); }}
          onSave={saveCharacter}
          onDelete={deleteCharacter}
          saving={charSaving}
          user={user}
          samplingVoice={samplingVoice}
          playVoiceSample={playVoiceSample}
          characters={characters}
        />}
      </div>
    );
  }

  /* ═══════════════════ PROFILE SCREEN ═══════════════════ */
  if (screen === 'profile') {
    const fields = [
      { key: 'display_name', label: 'Display Name', type: 'text', placeholder: 'Your name' },
      { key: 'birthdate', label: 'Birthdate', type: 'date', placeholder: '' },
      { key: 'interests', label: 'Interests', type: 'text', placeholder: 'e.g. music, hiking, cooking' },
      { key: 'favorite_color', label: 'Favorite Color', type: 'text', placeholder: 'e.g. Blue' },
      { key: 'favorite_animal', label: 'Favorite Animal', type: 'text', placeholder: 'e.g. Dog' },
      { key: 'favorite_food', label: 'Favorite Food', type: 'text', placeholder: 'e.g. Pizza' },
      { key: 'favorite_movie', label: 'Favorite Movie/Show', type: 'text', placeholder: 'e.g. Spirited Away' },
    ];
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <BackHeader label="Profile" onBack={() => setScreen('shelf')} />
        <main className="max-w-lg mx-auto px-8 sm:px-12 pt-8 pb-20">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-slate-200 shrink-0">
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#4285F4] flex items-center justify-center text-white text-2xl font-bold">
                  {user?.email?.charAt(0).toUpperCase() || '?'}
                </div>
              )}
            </div>
            <div>
              <p className="font-bold text-[#1A1A2E] text-lg">{profile.display_name || user?.email}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            {fields.map(f => (
              <div key={f.key}>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">{f.label}</label>
                <input type={f.type} value={profile[f.key]}
                  onChange={e => setProfile(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all"
                  placeholder={f.placeholder} />
              </div>
            ))}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">About Me</label>
              <textarea value={profile.about_me}
                onChange={e => setProfile(p => ({ ...p, about_me: e.target.value }))}
                rows={3}
                className="w-full bg-white rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20 outline-none transition-all resize-none"
                placeholder="A little about yourself…" />
            </div>
            <button onClick={saveProfile} disabled={profileSaving}
              className="w-full bg-[#4285F4] hover:bg-[#3B78DB] disabled:opacity-50 text-white rounded-xl py-3.5 font-bold transition-all active:scale-[0.97] mt-2">
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </main>
      </div>
    );
  }

  /* ═══════════════════ SETTINGS SCREEN ═══════════════════ */
  if (screen === 'settings') {
    const toggles = [
      { key: 'sound_effects', label: 'Sound Effects', desc: 'Play ring sound on calls', icon: <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg> },
      { key: 'auto_save_transcripts', label: 'Auto-save Transcripts', desc: 'Save call transcripts automatically', icon: <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg> },
      { key: 'call_timer_visible', label: 'Call Timer Visible', desc: 'Show timer during calls', icon: <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
      { key: 'interruptible', label: 'Allow Interruptions', desc: 'Talk over characters to interrupt them', icon: <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg> },
      { key: 'debug_mode', label: 'Debug Mode', desc: 'Show system prompt during calls', icon: <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg> },
    ];
    return (
      <div className="min-h-dvh bg-[#FFFBF5]">
        <GlobalStyles />
        <BackHeader label="Settings" onBack={() => setScreen('shelf')} />
        <main className="max-w-lg mx-auto px-8 sm:px-12 pt-8 pb-20">
          <div className="flex flex-col gap-5">
            {toggles.map(t => (
              <div key={t.key} className="bg-white rounded-2xl p-5 flex items-center gap-4 shadow-sm">
                <div className="shrink-0">{t.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#1A1A2E] text-sm">{t.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{t.desc}</p>
                </div>
                <button onClick={() => setSettings(p => ({ ...p, [t.key]: !p[t.key] }))}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${settings[t.key] ? 'bg-[#4285F4]' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${settings[t.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}

            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">Default Voice</label>
              <div className="flex gap-2">
                <select value={settings.default_voice}
                  onChange={e => setSettings(p => ({ ...p, default_voice: e.target.value }))}
                  className="flex-1 bg-[#FFFBF5] rounded-xl px-4 py-3 text-[#1A1A2E] font-medium border border-slate-200 focus:border-[#4285F4] outline-none">
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.value} value={v.value}>{v.label} — {v.desc}</option>
                  ))}
                </select>
                <button onClick={() => playVoiceSample(settings.default_voice)}
                  className={`px-3 rounded-xl border transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold shrink-0 ${
                    samplingVoice === settings.default_voice
                      ? 'bg-rose-50 border-rose-300 text-rose-500' : 'bg-[#FFFBF5] border-slate-200 text-slate-400 hover:text-[#4285F4] hover:border-[#4285F4]'
                  }`}>
                  {samplingVoice === settings.default_voice ? (
                    <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg> Stop</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play</>
                  )}
                </button>
              </div>
            </div>

            <button onClick={saveSettings} disabled={settingsSaving}
              className="w-full bg-[#4285F4] hover:bg-[#3B78DB] disabled:opacity-50 text-white rounded-xl py-3.5 font-bold transition-all active:scale-[0.97] mt-2">
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>

            <div className="mt-8 pt-6 border-t border-slate-100">
              <h3 className="font-bold text-rose-500 mb-3">Danger Zone</h3>
              {!deleteConfirm ? (
                <button onClick={() => setDeleteConfirm(true)}
                  className="w-full bg-rose-500 hover:bg-rose-600 text-white rounded-xl py-3.5 font-bold transition-all active:scale-[0.97]">
                  Delete All My Data
                </button>
              ) : (
                <div className="bg-rose-50 rounded-2xl p-5 border border-rose-200">
                  <p className="text-sm text-rose-700 font-semibold mb-4">This will permanently delete all your conversations, messages, profile, and settings. You will be signed out.</p>
                  <div className="flex gap-3">
                    <button onClick={deleteAllData}
                      className="flex-1 bg-rose-500 hover:bg-rose-600 text-white rounded-xl py-3 font-bold transition-all active:scale-[0.97]">
                      Yes, Delete Everything
                    </button>
                    <button onClick={() => setDeleteConfirm(false)}
                      className="flex-1 bg-white text-slate-500 rounded-xl py-3 font-bold border border-slate-200 hover:border-slate-300 transition-all active:scale-[0.97]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return null;
}


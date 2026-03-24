import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { 
  CloudSun, TrendingUp, Mic, Info, BrainCircuit, Leaf, Wind, Sparkles, 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, Moon, Star, Share2, LogOut, Cloud, Loader2, AlertCircle,
  Gamepad2, Trophy, X, Zap, Target, Heart, Wand2, HelpCircle, Bell
} from 'lucide-react';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query, limit, orderBy } from 'firebase/firestore';

// --- ROBUST CONFIGURATION LOGIC ---
const getEnvConfig = () => {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    return { firebase: JSON.parse(__firebase_config), gemini: "" };
  }
  
  try {
    // @ts-ignore
    const metaEnv = import.meta.env; 
    if (metaEnv && metaEnv.VITE_FIREBASE_CONFIG) {
      return {
        firebase: JSON.parse(metaEnv.VITE_FIREBASE_CONFIG),
        gemini: metaEnv.VITE_GEMINI_API_KEY || ""
      };
    }
  } catch (e) {}

  return { firebase: null, gemini: "" };
};

const { firebase: config, gemini: geminiApiKey } = getEnvConfig();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'mood-mirror-prod';
const apiKey = ""; 

// Initialize services safely
let auth = null, db = null;
if (config && config.apiKey) {
  try {
    const app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.error("Firebase Init Error:", e);
  }
}

// --- THEME CONSTANTS ---
const MOOD_THEMES = {
  joy: { glass: 'bg-emerald-400/20', solid: '#34d399', accent: 'text-emerald-700', bg: 'from-emerald-100 to-teal-50', blob: 'bg-emerald-300', glow: 'shadow-[0_0_35px_rgba(16,185,129,0.5)]', text: 'Growth & Joy', icon: <Leaf className="w-full h-full" /> },
  anxiety: { glass: 'bg-amber-400/20', solid: '#fbbf24', accent: 'text-amber-700', bg: 'from-orange-50 to-amber-100', blob: 'bg-amber-300', glow: 'shadow-[0_0_35px_rgba(245,158,11,0.5)]', text: 'Restless', icon: <Wind className="w-full h-full" /> },
  stress: { glass: 'bg-rose-400/20', solid: '#fb7185', accent: 'text-rose-700', bg: 'from-rose-50 to-slate-100', blob: 'bg-rose-300', glow: 'shadow-[0_0_35px_rgba(225,29,72,0.5)]', text: 'High Intensity', icon: <Sparkles className="w-full h-full" /> },
  calm: { glass: 'bg-sky-400/20', solid: '#38bdf8', accent: 'text-sky-700', bg: 'from-sky-100 to-indigo-50', blob: 'bg-sky-300', glow: 'shadow-[0_0_35px_rgba(14,165,233,0.5)]', text: 'Deep Peace', icon: <CloudSun className="w-full h-full" /> },
  low: { glass: 'bg-indigo-400/20', solid: '#818cf8', accent: 'text-indigo-800', bg: 'from-slate-200 to-indigo-100', blob: 'bg-indigo-300', glow: 'shadow-[0_0_35px_rgba(99,102,241,0.5)]', text: 'Stillness', icon: <Moon className="w-full h-full" /> }
};

const TIME_SLOTS = [
  { id: 'q1', label: '12 AM - 6 AM', period: 'Night' },
  { id: 'q2', label: '6 AM - 12 PM', period: 'Morning' },
  { id: 'q3', label: '12 PM - 6 PM', period: 'Afternoon' },
  { id: 'q4', label: '6 PM - 12 AM', period: 'Evening' }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [view, setView] = useState('checkin');
  const [currentMood, setCurrentMood] = useState('calm');
  const [selectedDate, setSelectedDate] = useState(new Date()); 
  const [calendarData, setCalendarData] = useState({});
  const [isGenerating, setIsGenerating] = useState(false);

  // FEATURES STATE
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isGamesOpen, setIsGamesOpen] = useState(false);
  const [activeGame, setActiveGame] = useState(null);
  const [gameStats, setGameStats] = useState({ dissolveScore: 0 });
  const [weeklyAlert, setWeeklyAlert] = useState(null);

  const constraintsRef = useRef(null);
  const activeTheme = MOOD_THEMES[currentMood];

  // Motion Values
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 300, damping: 30 });
  const springY = useSpring(y, { stiffness: 300, damping: 30 });
  const rotateX = useTransform(springY, [-100, 100], [15, -15]);
  const rotateY = useTransform(springX, [-100, 100], [-15, 15]);

  const currentHour = new Date().getHours();
  const currentSlotId = TIME_SLOTS.find((_, i) => currentHour >= i * 6 && currentHour < (i + 1) * 6)?.id;

  const getDateKey = useCallback((date) => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  }, []);

  const getDominantMoodOfDay = useCallback((dayData) => {
    if (!dayData) return null;
    const moods = [dayData.q1, dayData.q2, dayData.q3, dayData.q4].filter(Boolean);
    if (moods.length === 0) return null;
    const freq = moods.reduce((acc, m) => { acc[m] = (acc[m] || 0) + 1; return acc; }, {});
    const probWinner = Object.keys(freq).find(k => freq[k] >= 3);
    return probWinner || Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b);
  }, []);

  // Sync & Auth Logic
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
        setAuthError(null);
      } catch (err) { 
        setAuthError(err.message);
        setTimeout(initAuth, 5000); 
      }
    };
    initAuth();
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const colRef = collection(db, 'artifacts', appId, 'users', user.uid, 'days');
    const unsubscribeDays = onSnapshot(colRef, (snapshot) => {
      const data = {};
      snapshot.forEach(docSnap => { data[docSnap.id] = docSnap.data(); });
      setCalendarData(data);
    });

    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'games', 'stats');
    const unsubscribeStats = onSnapshot(statsRef, (docSnap) => {
      if (docSnap.exists()) setGameStats(docSnap.data());
    });

    return () => { unsubscribeDays(); unsubscribeStats(); };
  }, [user]);

  const handleSlotClick = useCallback(async (slotId) => {
    const dateKey = getDateKey(selectedDate);
    // Optimistic UI Update to ensure responsiveness even with slow sync
    setCalendarData(prev => ({
      ...prev,
      [dateKey]: { ...(prev[dateKey] || {}), [slotId]: currentMood }
    }));

    if (user && db) {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'days', dateKey);
      try {
        await setDoc(docRef, { [slotId]: currentMood, updated_at: Date.now() }, { merge: true });
      } catch (e) { console.error("Save failed", e); }
    }
  }, [selectedDate, currentMood, user, getDateKey]);

  // --- WEEKLY HEALTH ALERT ENGINE ---
  const generateWeeklyInsight = async () => {
    if (!user || isGenerating) return;
    setIsGenerating(true);
    const last7 = [];
    for(let i=0; i<7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const mood = getDominantMoodOfDay(calendarData[getDateKey(d)]);
      if(mood) last7.push(mood);
    }
    if (last7.length < 3) {
      setWeeklyAlert({ message: "Mirror requires 3 days of depth to project your weekly horizon.", alert: false });
      setIsGenerating(false); return;
    }
    const prompt = `Analyze trend: ${last7.join(', ')}. If 3+ stress/anxiety, send Vulnerability Alert. JSON: {"message": "Poetic summary", "status": "Stable/Vulnerable", "alert": true}`;
    try {
      const finalKey = geminiApiKey || "";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${finalKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
      });
      const result = await response.json();
      setWeeklyAlert(JSON.parse(result.candidates[0].content.parts[0].text));
    } catch (e) { console.error(e); } finally { setIsGenerating(false); }
  };

  const saveGameScore = async (gameKey, score) => {
    if (!user || !db) return;
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'games', 'stats');
    try {
      await setDoc(statsRef, { ...gameStats, [gameKey]: Math.max(gameStats[gameKey] || 0, score) }, { merge: true });
      setCurrentMood('joy'); 
    } catch (e) { console.error(e); }
  };

  const calendarDays = useMemo(() => {
    const days = [];
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startPadding = firstDay.getDay();
    for (let i = 0; i < startPadding; i++) days.push({ empty: true, key: `empty-${i}` });
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), i);
      const key = getDateKey(d);
      days.push({ day: i, key, mood: getDominantMoodOfDay(calendarData[key]), isToday: key === getDateKey(new Date()) });
    }
    return days;
  }, [calendarData, getDateKey, getDominantMoodOfDay]);

  if (!config) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-center text-white">
        <div className="max-w-md backdrop-blur-xl bg-white/5 p-10 rounded-[3rem] border border-white/10 shadow-2xl flex flex-col items-center gap-6">
          <AlertCircle className="text-rose-500 w-16 h-16" />
          <h1 className="text-2xl font-black uppercase tracking-widest" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Mirror Missing</h1>
          <p className="text-slate-400 text-sm italic">Add VITE_FIREBASE_CONFIG to Vercel Settings.</p>
        </div>
      </div>
    );
  }

  const changeDate = (offset) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + offset);
    setSelectedDate(newDate);
  };

  // --- AI SYNTHESIS GENERATOR ---
  const generateSummary = async () => {
    if (!user || isGenerating) return;
    const dateKey = getDateKey(selectedDate);
    const dayData = calendarData[dateKey];
    if (!dayData) return;
    setIsGenerating(true);
    const moods = Object.entries(dayData).filter(([k]) => k.startsWith('q')).map(([k, v]) => `${k}: ${v}`).join(', ');
    const prompt = `Analyze: ${moods}. 2-sentence poetic summary. JSON: {"message": "..."}`;
    try {
      const finalKey = geminiApiKey || "";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${finalKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
      });
      const result = await response.json();
      const content = JSON.parse(result.candidates[0].content.parts[0].text);
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'days', dateKey);
      await setDoc(docRef, { ai_summary: content }, { merge: true });
    } catch (e) { console.error(e); } finally { setIsGenerating(false); }
  };

  const currentSummary = calendarData[getDateKey(selectedDate)]?.ai_summary;

  return (
    <div className={`min-h-screen w-full transition-colors duration-1000 bg-gradient-to-br ${activeTheme.bg} p-4 md:p-8 flex flex-col items-center overflow-x-hidden font-sans`}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700;900&display=swap');`}</style>
      
      {/* Top Right: Horizon Calendar Trigger */}
      <button 
        onClick={() => { setIsCalendarOpen(true); generateWeeklyInsight(); }}
        className="fixed top-6 right-6 z-[100] p-4 rounded-full backdrop-blur-xl bg-white/30 border border-white/40 shadow-lg text-slate-800 hover:scale-110 active:scale-95 transition-all"
      >
        <CalendarIcon size={24} />
      </button>

      {/* Sync Status Badge */}
      <div className="fixed bottom-4 left-4 z-[100] group text-slate-800">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border text-[9px] font-black uppercase tracking-widest transition-all ${user ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}>
          <Cloud size={12} className={!user ? 'animate-pulse' : ''} />
          {user ? 'Cloud Synced' : authError ? 'Config Error' : 'Syncing...'}
        </div>
      </div>

      <header className="w-full max-w-5xl flex flex-col md:flex-row justify-between items-center mb-8 md:mb-12 z-20 gap-4">
        <div className="flex flex-col items-center md:items-start">
          <h1 className="text-2xl md:text-4xl font-black uppercase tracking-widest text-slate-800" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Mood Mirror</h1>
          <div className="h-1 w-16 md:w-24 bg-slate-800 rounded-full mt-1 opacity-20 hidden md:block" />
        </div>
        <nav className="flex gap-2 backdrop-blur-xl bg-white/20 p-1.5 rounded-full border border-white/30 shadow-sm">
          <button onClick={() => setView('checkin')} className={`px-5 md:px-7 py-2.5 rounded-full transition-all text-[10px] font-black uppercase tracking-widest ${view === 'checkin' ? 'bg-white shadow-md text-slate-900' : 'text-slate-500 hover:bg-white/30'}`}>Reflect</button>
          <button onClick={() => setView('dashboard')} className={`px-5 md:px-7 py-2.5 rounded-full transition-all text-[10px] font-black uppercase tracking-widest ${view === 'dashboard' ? 'bg-white shadow-md text-slate-900' : 'text-slate-500 hover:bg-white/30'}`}>Insights</button>
        </nav>
      </header>

      <main className="w-full max-w-5xl z-10">
        <AnimatePresence mode="wait">
          {view === 'checkin' ? (
            <motion.div key="checkin" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col gap-6 md:gap-8 pb-12 text-slate-800">
              <div ref={constraintsRef} className="z-10 relative backdrop-blur-3xl bg-white/30 p-6 md:p-10 rounded-[2.5rem] md:rounded-[4rem] border border-white/40 shadow-xl flex flex-col items-center gap-8 md:gap-12 min-h-[400px] md:min-h-[500px] overflow-hidden text-slate-800">
                <div className="text-center z-20">
                  <h2 className="text-lg md:text-2xl font-bold uppercase tracking-widest opacity-80" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Fluid Release</h2>
                  <p className="text-xs md:text-sm italic opacity-60">Physically release tension. Tap palette to log vibe.</p>
                </div>
                <div className="relative flex-1 flex items-center justify-center w-full min-h-[200px] pointer-events-none">
                  <motion.div drag dragConstraints={constraintsRef} dragElastic={0.6} style={{ x, y, rotateX, rotateY }} onDragEnd={() => { x.set(0); y.set(0); }} className={`pointer-events-auto z-30 w-36 h-36 md:w-56 md:h-56 shadow-2xl backdrop-blur-3xl transition-colors duration-1000 ${activeTheme.glass} ${activeTheme.glow} border border-white/60 flex items-center justify-center cursor-grab active:cursor-grabbing rounded-full p-8`}>
                    <div className={`${activeTheme.accent} w-full h-full`}>{React.cloneElement(activeTheme.icon, { size: '100%' })}</div>
                  </motion.div>
                </div>
                <div className="grid grid-cols-5 gap-3 md:gap-6 w-full max-w-lg z-20">
                  {Object.entries(MOOD_THEMES).map(([key, theme]) => (
                    <button key={key} onClick={() => setCurrentMood(key)} className={`group flex flex-col items-center gap-3 transition-all ${currentMood === key ? 'scale-110' : 'opacity-40 hover:opacity-100'}`}>
                      <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full border-2 border-white flex items-center justify-center p-2.5 shadow-lg`} style={{ backgroundColor: theme.solid }}>
                        <div className="text-white w-full h-full">{React.cloneElement(theme.icon, { size: 18 })}</div>
                      </div>
                      <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest" style={{ fontFamily: "'Cinzel Decorative', serif" }}>{key}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative z-[60] backdrop-blur-xl bg-white/40 p-6 md:p-8 rounded-[2.5rem] md:rounded-[3rem] border border-white/60 shadow-lg flex flex-col gap-6 text-slate-800">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                  <h3 className="text-md md:text-lg font-bold uppercase tracking-widest" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Temporal Pulse</h3>
                  <div className="flex items-center gap-4 bg-white/60 px-4 py-2 rounded-full border border-white/80 text-[9px] md:text-[10px] font-black shadow-sm">
                    <button onClick={() => changeDate(-1)} className="hover:text-slate-500 transition-colors"><ChevronLeft size={14} /></button>
                    <span className="w-24 md:w-28 text-center">{selectedDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }).toUpperCase()}</span>
                    <button onClick={() => changeDate(1)} className="hover:text-slate-500 transition-colors"><ChevronRight size={14} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {TIME_SLOTS.map((slot) => {
                    const moodId = calendarData[getDateKey(selectedDate)]?.[slot.id];
                    const moodTheme = moodId ? MOOD_THEMES[moodId] : null;
                    return (
                      <button key={slot.id} onClick={() => handleSlotClick(slot.id)} className={`relative p-4 rounded-[1.8rem] md:rounded-[2.2rem] border transition-all flex flex-col items-center gap-2 min-h-[90px] md:min-h-[110px] ${moodId ? `${moodTheme.glass} border-white/80 ${moodTheme.glow}` : 'bg-white/20 border-white/30 hover:bg-white/60'}`}>
                        <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-slate-500">{slot.period}</span>
                        <div className="h-8 flex items-center justify-center pointer-events-none">
                          {moodId ? <div className={`${moodTheme.accent} w-6 h-6 md:w-8 md:h-8`}>{moodTheme.icon}</div> : <div className="w-6 h-6 border-2 border-dashed border-slate-300 rounded-full opacity-30" />}
                        </div>
                        <span className="text-[8px] md:text-[9px] text-slate-400 font-bold tracking-tighter uppercase pointer-events-none">{slot.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          ) : (
            /* --- RESTORED POETIC INSIGHTS DASHBOARD --- */
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-8 pb-12">
              <div className="backdrop-blur-3xl bg-slate-800/95 text-white p-8 md:p-16 rounded-[2.5rem] md:rounded-[4rem] border border-white/10 shadow-2xl text-center flex flex-col items-center">
                {!currentSummary ? (
                  <div className="flex flex-col items-center gap-8">
                    <Star className="text-amber-400 fill-amber-400" size={40} />
                    <p className="text-lg md:text-2xl italic opacity-60 font-light leading-relaxed max-w-md">Log your temporal pulse to generate a poetic synthesis of your day.</p>
                    <button 
                      onClick={generateSummary} 
                      disabled={isGenerating} 
                      className="px-10 py-5 bg-white text-slate-900 rounded-full font-black text-[11px] tracking-[0.3em] uppercase shadow-2xl disabled:opacity-50 hover:scale-105 transition-transform"
                      style={{ fontFamily: "'Cinzel Decorative', serif" }}
                    >
                      {isGenerating ? <Loader2 className="animate-spin" size={20} /> : 'Generate Synthesis'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-10">
                    <Star className="text-amber-400 fill-amber-400" size={24} />
                    <p className="text-xl md:text-4xl italic leading-tight max-w-3xl font-medium text-slate-100">
                      "{currentSummary.message}"
                    </p>
                    <button 
                      onClick={() => generateSummary()}
                      className="text-[10px] font-black tracking-widest uppercase text-white/30 hover:text-white transition-colors"
                      style={{ fontFamily: "'Cinzel Decorative', serif" }}
                    >
                      Regenerate Reflection
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ZEN ZONE TRIGGER */}
      <div className="fixed bottom-6 right-6 z-[100]">
        <button onClick={() => setIsGamesOpen(true)} className="p-5 rounded-full bg-slate-800 text-white shadow-2xl hover:scale-110 active:scale-95 transition-all group">
          <Gamepad2 size={28} className="group-hover:rotate-12 transition-transform" />
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full border-2 border-white animate-pulse" />
        </button>
      </div>

      {/* CALENDAR OVERLAY */}
      <AnimatePresence>
        {isCalendarOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-white/95 backdrop-blur-3xl flex items-center justify-center p-4 md:p-12 overflow-y-auto">
            <div className="w-full max-w-4xl flex flex-col gap-8 text-slate-800">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl md:text-4xl font-black uppercase tracking-[0.3em]" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Mirror Horizon</h2>
                <button onClick={() => setIsCalendarOpen(false)} className="p-3 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"><X size={28} /></button>
              </div>
              <div className={`p-8 rounded-[3rem] border transition-all duration-1000 ${weeklyAlert?.alert ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white border-slate-200 shadow-xl'}`}>
                <div className="flex flex-col md:flex-row gap-6 items-center text-center md:text-left">
                   <div className={`p-5 rounded-[1.5rem] ${weeklyAlert?.alert ? 'bg-rose-500 shadow-lg' : 'bg-emerald-500 shadow-lg'} text-white`}>
                     {isGenerating ? <Loader2 className="animate-spin" size={32} /> : (weeklyAlert?.alert ? <Bell size={32} /> : <Sparkles size={32} />)}
                   </div>
                   <div className="flex-1">
                     <h3 className="text-xl font-black uppercase mb-1 tracking-widest" style={{ fontFamily: "'Cinzel Decorative', serif" }}>{isGenerating ? 'Consulting Rhythms...' : (weeklyAlert?.status || 'Analyzing Trend')}</h3>
                     <p className="text-slate-600 italic text-sm md:text-base leading-relaxed">{weeklyAlert?.message || "Reading your emotional frequencies across time..."}</p>
                   </div>
                </div>
              </div>
              <div className="bg-white p-6 md:p-10 rounded-[3rem] border border-slate-200 shadow-2xl">
                <div className="grid grid-cols-7 gap-2 md:gap-4 mb-8">
                  {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} className="text-center text-[11px] font-black text-slate-400 uppercase" style={{ fontFamily: "'Cinzel Decorative', serif" }}>{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-2 md:gap-4">
                  {calendarDays.map((item, idx) => (
                    <div key={idx} className="flex flex-col items-center">
                      {!item.empty ? (
                        <div className={`w-full aspect-square rounded-[1rem] md:rounded-[1.5rem] border flex flex-col items-center justify-center relative transition-all duration-1000
                          ${item.mood ? `${MOOD_THEMES[item.mood].glass} border-white shadow-inner` : 'bg-slate-50 border-slate-100'}
                          ${item.isToday ? 'ring-2 ring-indigo-500 shadow-lg' : ''}`}
                        >
                          {item.mood && <div className={`${MOOD_THEMES[item.mood].accent} w-5 h-5 md:w-7 md:h-7 mb-1`}>{MOOD_THEMES[item.mood].icon}</div>}
                          <span className={`text-[9px] md:text-[11px] font-black ${item.mood ? 'text-slate-800' : 'text-slate-300'}`}>{item.day}</span>
                        </div>
                      ) : <div className="w-full aspect-square" />}
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Calculated daily at 01:00 AM • Neural Sync Active</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ZEN ZONE GAMES OVERLAY */}
      <AnimatePresence>
        {isGamesOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] bg-slate-900/98 backdrop-blur-3xl flex items-center justify-center p-4">
            <div className="w-full max-w-4xl flex flex-col gap-8 text-white max-h-full overflow-y-auto">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <h2 className="text-3xl md:text-4xl font-black uppercase tracking-widest" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Zen Zone</h2>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400">Sensory Release & Physics-Based Play</p>
                </div>
                <button onClick={() => { setIsGamesOpen(false); setActiveGame(null); }} className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"><X size={28} /></button>
              </div>

              {!activeGame ? (
                <div className="grid grid-cols-1 gap-6 max-w-lg mx-auto w-full pb-20">
                  <div className="p-8 rounded-[3rem] bg-rose-500/10 border border-white/10 flex flex-col gap-6 items-center text-center">
                    <div className="p-5 rounded-full bg-rose-500/20 text-rose-400 shadow-xl"><Wand2 size={50} /></div>
                    <h3 className="text-2xl font-black uppercase tracking-widest" style={{ fontFamily: "'Cinzel Decorative', serif" }}>Stress Burst 2.0</h3>
                    <p className="text-xs opacity-60 leading-relaxed">Pure tactile relief. Vaporize rising stressors as they emerge. Each burst releases a therapeutic aura cloud.</p>
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-400">High Score: {gameStats.dissolveScore || 0}</div>
                    <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-2xl border border-white/10 text-[9px] uppercase">
                      <HelpCircle size={12} className="text-slate-400" />
                      <span>HOW TO PLAY: Tap bubbles to trigger an aura burst. Survive for 60 seconds.</span>
                    </div>
                    <button onClick={() => setActiveGame('dissolve')} className="w-full py-5 bg-white text-slate-900 rounded-full font-black uppercase tracking-widest text-xs hover:scale-105 active:scale-95 transition-all">Begin Release</button>
                  </div>
                </div>
              ) : (
                <StressBurstGame onFinish={(score) => { saveGameScore('dissolveScore', score); setActiveGame(null); }} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes blob-slow {
          0% { transform: rotate(0deg) scale(1); border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%; }
          33% { transform: rotate(120deg) scale(1.05); border-radius: 50% 50% 33% 67% / 55% 27% 73% 45%; }
          66% { transform: rotate(240deg) scale(0.95); border-radius: 33% 67% 58% 42% / 63% 30% 70% 37%; }
          100% { transform: rotate(360deg) scale(1); border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%; }
        }
        .animate-blob-slow { animation: blob-slow 20s infinite linear; }
      `}} />
      <SpeedInsights />
    </div>
  );
}

// --- OPTIMIZED STRESS BURST GAME (Lag-Free & Random Emerge) ---
function StressBurstGame({ onFinish }) {
  const [bubbles, setBubbles] = useState([]);
  const [particles, setParticles] = useState([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const COLORS = ['#34d399', '#fbbf24', '#fb7185', '#38bdf8', '#818cf8'];

  useEffect(() => {
    const spawner = setInterval(() => {
      if (bubbles.length < 5) {
        setBubbles(b => [...b, {
          id: Math.random(),
          x: 10 + Math.random() * 80,
          y: 15 + Math.random() * 65,
          color: COLORS[Math.floor(Math.random() * 5)],
          size: 70 + Math.random() * 40
        }]);
      }
    }, 850);
    return () => clearInterval(spawner);
  }, [bubbles.length]);

  useEffect(() => {
    const timerInterval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerInterval);
  }, []);

  useEffect(() => {
    if (timeLeft === 0) {
      onFinish(score);
    }
  }, [timeLeft, score, onFinish]);

  const triggerBurst = (bubble) => {
    setScore(s => s + 1);
    setBubbles(b => b.filter(item => item.id !== bubble.id));
    const newGas = Array(6).fill(null).map(() => ({
      id: Math.random(), x: bubble.x, y: bubble.y, color: bubble.color,
      angle: Math.random() * Math.PI * 2
    }));
    setParticles(prev => [...prev, ...newGas]);
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newGas.includes(p)));
    }, 750);
  };

  return (
    <div className="relative w-full h-[550px] bg-slate-950 rounded-[4rem] border border-white/5 overflow-hidden flex items-center justify-center shadow-2xl text-white">
      <div className="absolute top-8 left-10 flex flex-col items-center">
        <span className="text-4xl font-black">{score}</span>
        <p className="text-[10px] uppercase font-bold opacity-30 tracking-widest">Dissolved</p>
      </div>
      <div className="absolute top-8 right-10 text-3xl font-black text-rose-400 tabular-nums">
        {timeLeft}s
      </div>
      <AnimatePresence>
        {bubbles.map(b => (
          <motion.button
            key={b.id} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ scale: 1.5, opacity: 0 }}
            onClick={() => triggerBurst(b)}
            className="absolute rounded-full backdrop-blur-xl border border-white/20 shadow-inner"
            style={{ 
              left: `${b.x}%`, top: `${b.y}%`, width: b.size, height: b.size,
              background: `radial-gradient(circle at 30% 30%, white 0%, transparent 80%), ${b.color}44` 
            }}
          >
            <div className="absolute inset-0 bg-white/10 opacity-20 animate-pulse rounded-full" />
          </motion.button>
        ))}
      </AnimatePresence>
      {particles.map(p => (
        <motion.div
          key={p.id} initial={{ x: 0, y: 0, scale: 1, opacity: 0.8 }}
          animate={{ x: Math.cos(p.angle) * 80, y: Math.sin(p.angle) * 80, scale: 4, opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute w-5 h-5 rounded-full blur-xl pointer-events-none"
          style={{ backgroundColor: p.color, left: `${p.x}%`, top: `${p.y}%` }}
        />
      ))}
      <div className="text-[10px] uppercase tracking-[0.5em] opacity-20 absolute bottom-10 font-black pointer-events-none text-center px-6">
        Touch Bubbles to Vaporize Stress
      </div>
    </div>
  );
}

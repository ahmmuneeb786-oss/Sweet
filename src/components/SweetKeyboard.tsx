import { useState, useRef, useEffect } from 'react';
import { Paperclip, Delete, Heart, ImageIcon, MapPin, FileText, ArrowUpCircle, Clipboard, Video } from 'lucide-react';
import { COMMON_TYPOS, fetchOriginalData } from '../lib/trainingData';

interface SweetKeyboardProps {
  onInput: (char: string | File | Blob) => void;
  onDelete: () => void;
  onSend: () => void;
  newMessage: string;
  onDocsClick: () => void;
  romanticFeatures: PredictionMap;
  onLearn: (newFeatures: PredictionMap) => void;
}

interface PredictionMap {
  [key: string]: { [nextWord: string]: number };
}

export const SweetKeyboard = ({ onInput, onDelete, onSend, newMessage, onDocsClick, romanticFeatures, onLearn }: SweetKeyboardProps) => {
  const [isCaps, setIsCaps] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showMediaBar, setShowMediaBar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [predictions, setPredictions] = useState<string[]>([]);

  const handleKey = (key: string) => {
    onInput(isCaps ? key.toUpperCase() : key.toLowerCase());
    if (isCaps) setIsCaps(false);
    if (typeof window !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onInput(file); 
      setShowMediaBar(false);
      e.target.value = ''; 
    }
  };

  const rows = showSymbols 
    ? [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'], ['.', ',', '?', '!', "'"]]
    : [['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], ['Z', 'X', 'C', 'V', 'B', 'N', 'M']];

    const cleanWord = (word: string): string => {
  return word
    .toLowerCase()               // Standardize to lowercase
    .trim()                      // Remove surrounding spaces
    .replace(/[^\w\s]|_/g, "")   // Remove punctuation (keep only letters/numbers)
    .replace(/\s+/g, " ");       // Collapse multiple spaces into one
};

useEffect(() => {
  const initProfessionalBrain = async () => {
    // Only fetch if the brain is practically empty
    if (Object.keys(romanticFeatures).length < 5) {
      const webWords = await fetchOriginalData();
      
      if (webWords.length > 0) {
        const newFeatures = { ...romanticFeatures };

        for (let i = 0; i < webWords.length - 1; i++) {
  const current = webWords[i];
  const next = webWords[i + 1];
  
  if (!newFeatures[current]) newFeatures[current] = {};
  
  // Give online data a baseline weight (e.g., 2) 
  // so it's stronger than a single accidental typo
  newFeatures[current][next] = (newFeatures[current][next] || 0) + 2; 
}
        
        // IMPORTANT: Tell the parent (ChatWindow) to save the new brain
        if (onLearn) onLearn(newFeatures);
      }
    }
  };
  initProfessionalBrain();
}, []);

  // Add this effect to handle the "Learning/Matching" logic
useEffect(() => {
  const words = newMessage.trim().split(/\s+/);
  if (words.length < 1 || newMessage === "") {
    setPredictions([]);
    return;
  }

  const lastWord = cleanWord(words[words.length - 1]);
  const secondToLastWord = words.length > 1 ? cleanWord(words[words.length - 2]) : null;

  // If we have a previous word, look up smart predictions from our Feature Map
  if (secondToLastWord && romanticFeatures[secondToLastWord]) {
    const suggestions = Object.keys(romanticFeatures[secondToLastWord])
      .sort((a, b) => romanticFeatures[secondToLastWord][b] - romanticFeatures[secondToLastWord][a])
      .slice(0, 3);
    
    setPredictions(suggestions.map(s => s.toUpperCase()));
  } else {
    // Fallback to our Step 1/2 typo and default logic
    if (COMMON_TYPOS[lastWord]) {
      setPredictions([COMMON_TYPOS[lastWord].toUpperCase(), "❤️", "✨"]);
    } else {
      setPredictions(["LOVE", "YOU", "SWEET"]);
    }
  }
}, [newMessage, romanticFeatures]);

const handlePredictionClick = (word: string) => {
  // This sends the selected word back to the main chat input
  onInput('SELECT_PREDICTION:' + word);
};

  return (
    <div className="w-full bg-[#FFE4E1]/90 backdrop-blur-2xl border-t border-[#FFB6C1] p-2 pb-6 select-none">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

      {/* MEDIA BAR */}
      <div className="h-14 flex items-center justify-center mb-2 px-4 bg-white/20 rounded-xl overflow-hidden relative">
        {showMediaBar ? (
          <div className="flex gap-7 items-center justify-center w-full animate-in slide-in-from-bottom-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-1 active:scale-90 transition-all group">
              <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><ImageIcon className="w-4 h-4" /></div>
              <span className="text-[9px] font-black text-pink-600">GALLERY</span>
            </button>

            {/* THIS IS THE FIX: It now sends a 'VIDEO_START' string to the parent */}
            <button type="button" onClick={() => onInput('VIDEO_START')} className="flex flex-col items-center gap-1 active:scale-90 transition-all group">
              <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><Video className="w-4 h-4" /></div>
              <span className="text-[9px] font-black text-pink-600">VIDEO</span>
            </button>

            <button className="flex flex-col items-center gap-1 opacity-50"><div className="p-2 bg-white/80 rounded-full text-pink-500"><Clipboard className="w-4 h-4" /></div><span className="text-[9px]">COPY</span></button>
            <button 
  type="button"
  onClick={() => onInput('LOCATION_START')} // Signal to open the map
  className="flex flex-col items-center gap-1 active:scale-90 transition-all group"
>
  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white">
    <MapPin className="w-4 h-4" />
  </div>
  <span className="text-[9px] font-black text-pink-600 uppercase">Place</span>
</button>

            <button 
  type="button" 
  onClick={onDocsClick} 
  className="flex flex-col items-center gap-1 active:scale-90 transition-all group"
>
  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white">
    <FileText className="w-4 h-4" />
  </div>
  <span className="text-[9px] font-black text-pink-600 uppercase">Docs</span>
</button>

          </div>
        ) : (
          <div className="flex items-center justify-center w-full h-full">
      {/* CONDITION: 
          If newMessage has text AND we have predictions, show buttons.
          Otherwise, show the default SWEET MESSAGES text.
      */}
      {newMessage.length > 0 && predictions.length > 0 ? (
        <div className="flex gap-2 w-full justify-around items-center animate-in fade-in zoom-in-95 duration-300">
          {predictions.map((word, i) => (
            <button
              key={i}
              onClick={() => handlePredictionClick(word)}
              className="px-4 py-1.5 bg-white/60 rounded-lg text-[#8B004B] text-[11px] font-bold shadow-sm active:scale-95 transition-all border border-pink-200/50"
            >
              {word.toUpperCase()}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-4 text-[#8B004B]/40 text-[10px] font-bold tracking-[0.2em] animate-in fade-in duration-500">
          <span>SWEET</span>
          <Heart className="w-3 h-3 fill-current opacity-30" />
          <span>MESSAGES</span>
        </div>
      )}
    </div>
  )}
</div>

      {/* KEYBOARD ROWS */}
      <div className="flex justify-center gap-1 mb-2">
        {rows[0].map(k => <button key={k} onClick={() => handleKey(k)} className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 transition-all">{k}</button>)}
      </div>
      <div className="flex justify-center gap-1 mb-2 px-[4%]">
        {rows[1].map(k => <button key={k} onClick={() => handleKey(k)} className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 transition-all">{k}</button>)}
      </div>
      <div className="flex justify-center gap-1 mb-2">
        <button onClick={() => setIsCaps(!isCaps)} className={`w-[14%] h-11 rounded-xl flex items-center justify-center transition-all ${isCaps ? 'bg-pink-500 text-white' : 'bg-white/40 text-[#4B004B]'}`}><ArrowUpCircle className="w-5 h-5" /></button>
        {rows[2].map(k => <button key={k} onClick={() => handleKey(k)} className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 transition-all">{k}</button>)}
        <button onClick={onDelete} className="w-[14%] h-11 bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-pink-200"><Delete className="w-5 h-5" /></button>
      </div>

      <div className="flex justify-center gap-2 mt-1 px-1">
        <button onClick={() => setShowMediaBar(!showMediaBar)} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showMediaBar ? 'bg-pink-500 text-white rotate-[135deg]' : 'bg-white/40 text-[#4B004B]'}`}><Paperclip className="w-5 h-5" /></button>
        <button onClick={() => setShowSymbols(!showSymbols)} className="w-12 h-12 bg-white/40 rounded-xl text-[#4B004B] font-black text-[10px]">{showSymbols ? 'ABC' : '123'}</button>
        <button onClick={() => onInput(' ')} className="flex-1 h-12 bg-white/80 rounded-2xl text-[#4B004B]/40 font-bold text-xs uppercase tracking-widest">Sweet Chat</button>
        <button onClick={onSend} className="w-14 h-12 bg-gradient-to-tr from-pink-400 to-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg active:scale-95"><Heart className="w-6 h-6 fill-current" /></button>
      </div>
    </div>
  );
};
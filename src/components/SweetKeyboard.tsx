import { useState } from 'react';
import { Paperclip, Delete, Heart, ImageIcon, Camera, MapPin, FileText, ArrowUpCircle  } from 'lucide-react';

interface SweetKeyboardProps {
  onInput: (char: string) => void;
  onDelete: () => void;
  onSend: () => void;
  newMessage: string;
}

export const SweetKeyboard = ({ onInput, onDelete, onSend, newMessage }: SweetKeyboardProps) => {
  const [isCaps, setIsCaps] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showMediaBar, setShowMediaBar] = useState(false);

  const rows = showSymbols 
    ? [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
        ['.', ',', '?', '!', "'"]
      ]
    : [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
      ];

  const handleKey = (key: string) => {
    onInput(isCaps ? key.toUpperCase() : key.toLowerCase());
    if (isCaps) setIsCaps(false);
    if (typeof window !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  return (
    <div className="w-full bg-[#FFE4E1]/90 backdrop-blur-2xl border-t border-[#FFB6C1] p-2 pb-6 animate-in slide-in-from-bottom duration-300 select-none">
      
      {/* Prediction/Media Bar Area */}
      <div className="h-12 flex items-center justify-center mb-2 px-4 bg-white/20 rounded-xl">
        {showMediaBar ? (
          <div className="flex gap-7 animate-in fade-in zoom-in duration-300">
            <button className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
              <div className="p-2 bg-white/80 rounded-full shadow-sm text-pink-500"><ImageIcon className="w-4 h-4" /></div>
              <span className="text-[9px] font-black text-pink-600 tracking-tighter">GALLERY</span>
            </button>
            <button className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
              <div className="p-2 bg-white/80 rounded-full shadow-sm text-pink-500"><Camera className="w-4 h-4" /></div>
              <span className="text-[9px] font-black text-pink-600 tracking-tighter">CAMERA</span>
            </button>
            <button className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
              <div className="p-2 bg-white/80 rounded-full shadow-sm text-pink-500"><MapPin className="w-4 h-4" /></div>
              <span className="text-[9px] font-black text-pink-600 tracking-tighter">PLACE</span>
            </button>
            <button className="flex flex-col items-center gap-1 active:scale-90 transition-transform">
              <div className="p-2 bg-white/80 rounded-full shadow-sm text-pink-500"><FileText className="w-4 h-4" /></div>
              <span className="text-[9px] font-black text-pink-600 tracking-tighter">DOCS</span>
            </button>
          </div>
        ) : (
          <div className="flex gap-4 text-[#8B004B]/40 text-[10px] font-bold tracking-[0.2em] animate-in fade-in duration-500">
            <span>SWEET</span>
            <Heart className="w-3 h-3 fill-current opacity-30" />
            <span>MESSAGES</span>
          </div>
        )}
      </div>

      {/* Row 1 */}
      <div className="flex justify-center gap-1 mb-2">
        {rows[0].map(k => (
          <button key={k} onClick={() => handleKey(k)} className="flex-1 h-12 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-white transition-colors">{k}</button>
        ))}
      </div>

      {/* Row 2 */}
      <div className="flex justify-center gap-1 mb-2 px-[4%]"> 
        {rows[1].map(k => (
          <button key={k} onClick={() => handleKey(k)} className="flex-1 h-12 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-white transition-colors">{k}</button>
        ))}
      </div>

      {/* Row 3 */}
      <div className="flex justify-center gap-1 mb-2">
        <button 
          onClick={() => setIsCaps(!isCaps)} 
          className={`w-[14%] h-12 rounded-xl flex items-center justify-center transition-all ${isCaps ? 'bg-pink-500 text-white shadow-inner' : 'bg-white/40 text-[#4B004B]'}`}
        >
          <ArrowUpCircle className={`w-5 h-5 ${isCaps ? 'fill-current' : ''}`} />
        </button>
        
        {rows[2].map(k => (
          <button key={k} onClick={() => handleKey(k)} className="flex-1 h-12 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-white transition-colors">{k}</button>
        ))}

        <button 
          onClick={onDelete} 
          className="w-[14%] h-12 bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-red-50"
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>

      {/* Row 4 */}
      <div className="flex justify-center gap-2 mt-1 px-1">
        <button 
          onClick={() => setShowMediaBar(!showMediaBar)} 
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showMediaBar ? 'bg-pink-500 text-white rotate-45' : 'bg-white/40 text-[#4B004B]'}`}
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <button 
          onClick={() => setShowSymbols(!showSymbols)} 
          className="w-12 h-12 bg-white/40 rounded-xl text-[#4B004B] font-black text-[10px]"
        >
          {showSymbols ? 'ABC' : '123'}
        </button>

        <button 
          onClick={() => onInput(' ')} 
          className="flex-1 h-12 bg-white/80 border-b-4 border-black/5 rounded-2xl text-[#4B004B]/40 font-bold text-xs uppercase tracking-widest active:translate-y-0.5 active:border-b-0 transition-all"
        >
          Sweet Chat
        </button>

        <button 
          onClick={onSend} 
          className="w-14 h-12 bg-gradient-to-tr from-pink-400 to-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform"
        >
          <Heart className="w-6 h-6 fill-current" />
        </button>
      </div>
    </div>
  );
};
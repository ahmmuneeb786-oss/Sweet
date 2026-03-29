interface SweetKeyboardProps {
  onInput: (char: string) => void;
  onDelete: () => void;
  onSend: () => void;
}

export const SweetKeyboard = ({ onInput, onDelete, onSend }: SweetKeyboardProps) => {
  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Back'],
    ['Space', 'Enter']
  ];

  return (
    // 3. Updated styles to match that "Frosted Pink Glass" look
    <div className="fixed bottom-0 left-0 w-full bg-[#FFE4E1]/40 backdrop-blur-xl border-t border-[#FFB6C1]/50 p-2 pb-8 animate-in slide-in-from-bottom duration-300 z-[999]">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex justify-center mb-2 gap-1.5">
          {row.map((key) => (
            <button
              key={key}
              type="button" // Prevents form submission bugs
              onClick={() => {
                if (key === 'Back') onDelete();
                else if (key === 'Enter') onSend();
                else if (key === 'Space') onInput(' ');
                else onInput(key.toLowerCase());
                
                if (navigator.vibrate) navigator.vibrate(10);
              }}
              className={`h-12 rounded-xl flex items-center justify-center text-[#4B004B] font-semibold active:scale-110 active:bg-white/60 transition-all shadow-sm
                ${key === 'Space' ? 'w-44 bg-white/40 italic' : 
                  key === 'Enter' ? 'w-20 bg-pink-500 text-white shadow-pink-200' : 
                  'w-[9%] bg-white/30 border border-white/20'}`}
            >
              {key === 'Back' ? '⌫' : key === 'Enter' ? '♥' : key === 'Space' ? 'Sweet Chat' : key}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default SweetKeyboard;
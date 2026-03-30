import { useState, useRef, useEffect } from 'react';
import { Paperclip, Delete, Heart, ImageIcon, MapPin, FileText, ArrowUpCircle, Clipboard, Video, Check, X, RotateCcw } from 'lucide-react';

interface SweetKeyboardProps {
  onInput: (char: string | File | Blob) => void; // Updated to accept File
  onDelete: () => void;
  onSend: () => void;
  newMessage: string;
}

export const SweetKeyboard = ({ onInput, onDelete, onSend }: SweetKeyboardProps) => {
  const [isCaps, setIsCaps] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showMediaBar, setShowMediaBar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showVideoOverlay, setShowVideoOverlay] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (showVideoOverlay) {
      startCamera();
    } else {
      stopCamera();
    }
  }, [showVideoOverlay, facingMode]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: true
      });
      setVideoStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Please allow camera access, love!");
      setShowVideoOverlay(false);
    }
  };

  const stopCamera = () => {
    videoStream?.getTracks().forEach(track => track.stop());
    setVideoStream(null);
  };

  const handleRecordAction = () => {
    if (!isRecording) {
      // START RECORDING
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(videoStream!);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/mp4' });
        onInput(blob); // Send the video blob to ChatWindow
        setShowVideoOverlay(false);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } else {
      // STOP/DONE
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
  };

  const handleKey = (key: string) => {
    onInput(isCaps ? key.toUpperCase() : key.toLowerCase());
    if (isCaps) setIsCaps(false);
    if (typeof window !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  const handleGalleryClick = () => {
    fileInputRef.current?.click();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // This sends the REAL file to ChatWindow, just like your old button did
      onInput(file); 
      setShowMediaBar(false);
      e.target.value = ''; 
    }
  };

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

  return (
    <div className="w-full bg-[#FFE4E1]/90 backdrop-blur-2xl border-t border-[#FFB6C1] p-2 pb-6 select-none">
      
      {/* HEART VIDEO OVERLAY */}
      {showVideoOverlay && (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="relative w-80 h-80 md:w-96 md:h-96">
            {/* Pulsing Heart Glow */}
            <div 
              className="absolute inset-0 bg-pink-500 animate-pulse opacity-20 scale-110"
              style={{ clipPath: 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")' }}
            />
            {/* The Actual Video Heart */}
            <div 
              className="absolute inset-0 overflow-hidden bg-gray-900 border-4 border-pink-400/30" 
              style={{ clipPath: 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")' }}
            >
              <video 
                ref={videoRef} 
                autoPlay 
                muted 
                playsInline 
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`} 
              />
            </div>
          </div>

          <div className="mt-12 flex items-center gap-8">
            <button 
              onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
              className="p-4 bg-white/10 hover:bg-white/20 rounded-full text-white active:scale-90 transition-all"
            >
              <RotateCcw className="w-6 h-6" />
            </button>

            <button 
              onClick={handleRecordAction}
              className={`p-6 rounded-full shadow-[0_0_30px_rgba(236,72,153,0.5)] transition-all active:scale-95 ${isRecording ? 'bg-green-500 scale-110' : 'bg-pink-500 hover:bg-pink-400'}`}
            >
              {isRecording ? <Check className="w-8 h-8 text-white" /> : <div className="w-8 h-8 rounded-full bg-white animate-ping" />}
            </button>

            <button 
              onClick={() => setShowVideoOverlay(false)}
              className="p-4 bg-white/10 hover:bg-white/20 rounded-full text-white active:scale-90 transition-all"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <p className="text-white/80 font-bold mt-8 tracking-[0.2em] text-xs uppercase">
            {isRecording ? "Recording your moment..." : "Tap the heart to start"}
          </p>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={handleImageUpload}
      />

      <div className="h-14 flex items-center justify-center mb-2 px-4 bg-white/20 rounded-xl overflow-hidden relative">
        {showMediaBar ? (
          <div className="flex gap-7 items-center justify-center w-full animate-in slide-in-from-bottom-2">
            <button 
              type="button"
              onClick={handleGalleryClick}
              className="flex flex-col items-center gap-1 active:scale-90 transition-all group"
            >
              <div className="p-2 bg-white/80 rounded-full shadow-sm text-pink-500 group-active:bg-pink-500 group-active:text-white transition-colors">
                <ImageIcon className="w-4 h-4" />
              </div>
              <span className="text-[9px] font-black text-pink-600 tracking-tighter">GALLERY</span>
            </button>

            <button 
              type="button"
              onClick={() => setShowVideoOverlay(true)}
              className="flex flex-col items-center gap-1 active:scale-90 transition-all group"
            >
              <div className="p-2 bg-white/80 rounded-full shadow-sm text-pink-500 group-active:bg-pink-500 group-active:text-white transition-colors">
                <Video className="w-4 h-4" />
              </div>
              <span className="text-[9px] font-black text-pink-600 tracking-tighter">VIDEO</span>
            </button>

            <button className="flex flex-col items-center gap-1 opacity-50"><div className="p-2 bg-white/80 rounded-full text-pink-500"><Clipboard className="w-4 h-4" /></div><span className="text-[9px]">COPY</span></button>
            <button className="flex flex-col items-center gap-1 opacity-50"><div className="p-2 bg-white/80 rounded-full text-pink-500"><MapPin className="w-4 h-4" /></div><span className="text-[9px]">PLACE</span></button>
            <button className="flex flex-col items-center gap-1 opacity-50"><div className="p-2 bg-white/80 rounded-full text-pink-500"><FileText className="w-4 h-4" /></div><span className="text-[9px]">DOCS</span></button>
          </div>
        ) : (
          <div className="flex gap-4 text-[#8B004B]/40 text-[10px] font-bold tracking-[0.2em]">
            <span>SWEET</span>
            <Heart className="w-3 h-3 fill-current opacity-30" />
            <span>MESSAGES</span>
          </div>
        )}
      </div>

      {/* Keyboard Rows with Click Feedback */}
      <div className="flex justify-center gap-1 mb-2">
        {rows[0].map(k => (
          <button key={k} onClick={() => handleKey(k)} className="flex-1 h-12 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 active:scale-95 transition-all">{k}</button>
        ))}
      </div>
      <div className="flex justify-center gap-1 mb-2 px-[4%]"> 
        {rows[1].map(k => (
          <button key={k} onClick={() => handleKey(k)} className="flex-1 h-12 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 active:scale-95 transition-all">{k}</button>
        ))}
      </div>
      <div className="flex justify-center gap-1 mb-2">
        <button onClick={() => setIsCaps(!isCaps)} className={`w-[14%] h-12 rounded-xl flex items-center justify-center transition-all active:scale-90 ${isCaps ? 'bg-pink-500 text-white' : 'bg-white/40 text-[#4B004B] active:bg-pink-200'}`}><ArrowUpCircle className="w-5 h-5" /></button>
        {rows[2].map(k => (
          <button key={k} onClick={() => handleKey(k)} className="flex-1 h-12 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 active:scale-95 transition-all">{k}</button>
        ))}
        <button onClick={onDelete} className="w-[14%] h-12 bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-pink-200 active:scale-90 transition-all"><Delete className="w-5 h-5" /></button>
      </div>

      <div className="flex justify-center gap-2 mt-1 px-1">
        <button onClick={() => setShowMediaBar(!showMediaBar)} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 ${showMediaBar ? 'bg-pink-500 text-white rotate-[135deg]' : 'bg-white/40 text-[#4B004B]'}`}><Paperclip className="w-5 h-5" /></button>
        <button onClick={() => setShowSymbols(!showSymbols)} className="w-12 h-12 bg-white/40 rounded-xl text-[#4B004B] font-black text-[10px] active:bg-pink-200 active:scale-90 transition-all">{showSymbols ? 'ABC' : '123'}</button>
        <button onClick={() => onInput(' ')} className="flex-1 h-12 bg-white/80 rounded-2xl text-[#4B004B]/40 font-bold text-xs uppercase tracking-widest active:bg-pink-100 transition-all">Sweet Chat</button>
        <button onClick={onSend} className="w-14 h-12 bg-gradient-to-tr from-pink-400 to-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg active:scale-95 transition-all"><Heart className="w-6 h-6 fill-current" /></button>
      </div>
    </div>
  );
}
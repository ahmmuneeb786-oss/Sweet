import { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { Lock, Smile, AlertCircle, ShieldCheck, UserPlus } from 'lucide-react';

interface StrictLockProps {
  onUnlock: () => void;
  mode?: 'verify' | 'register';
  onRegisterSuccess?: () => void;
  savedDescriptor?: number[] | null;
  userId: string;
  onSaveDescriptor: (userId: string, descriptor: number[]) => Promise<void>;
  // Escape hatch for verify mode — without this, a user with no working
  // verification path (camera denied, models failed, no saved descriptor)
  // has literally no way back into their own app.
  onSignOut?: () => void;
  // A lighter, non-destructive escape — e.g. LockedChatsPanel uses this to
  // just back out to the chat list, rather than signing out of the app.
  onCancel?: () => void;
}

export const StrictLock = ({ 
  onUnlock, 
  mode = 'verify', 
  onRegisterSuccess,
  savedDescriptor,
  userId,
  onSaveDescriptor,
  onSignOut,
  onCancel
}: StrictLockProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [feedback, setFeedback] = useState('Initializing FaceID...');
  const [isPulsing, setIsPulsing] = useState(false);
  const [errorState, setErrorState] = useState(false);

  useEffect(() => {
    const loadModels = async () => {
      const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        setIsModelLoaded(true);
        startCamera();
      } catch (err) {
        setFeedback('Security models failed to load');
        setErrorState(true);
      }
    };
    loadModels();

    // Cleanup camera AND the detection interval on unmount
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
     if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Add this line to force the video to play
        await videoRef.current.play(); 
      }
    } catch (err) {
      console.error("Camera Error:", err);
      setFeedback('Camera access denied');
      setErrorState(true);
    }
  };

const handleDetection = async () => {
  if (!videoRef.current || !isModelLoaded) return;

  // onPlay can fire more than once in some browsers (e.g. after any
  // pause/replay cycle). Without this guard, each firing stacked another
  // concurrent setInterval scanning the same feed — the previous version's
  // returned cleanup function was silently discarded, since onPlay is a DOM
  // event handler, not a useEffect.
  if (detectionIntervalRef.current) return;

  const interval = setInterval(async () => {
    if (!videoRef.current) {
      clearInterval(interval);
      detectionIntervalRef.current = null;
      return;
    }

    const detections = await faceapi.detectAllFaces(
      videoRef.current!,
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks().withFaceExpressions().withFaceDescriptors();

    if (detections.length > 1) {
      setFeedback('Privacy Alert: Multiple people detected! 🔒');
      setErrorState(true);
      setIsPulsing(false);
      return; 
    }

    if (detections.length === 0) {
      setFeedback('No face detected');
      setIsPulsing(false);
      setErrorState(false);
      return;
    }

    const person = detections[0];
    const smileValue = person.expressions.happy;
    const currentDescriptor = person.descriptor;

    if (mode === 'register') {
      if (smileValue > 0.85) {
        if (!userId || userId === 'undefined') {
         console.error("Critical: Cannot register face because userId is missing!");
         setFeedback('Error: User session lost. Please log in again.');
         setErrorState(true);
         clearInterval(interval);
      detectionIntervalRef.current = null;
         return;
       }
        setFeedback('Smile Captured! Syncing to Cloud...');
        
        try {
          const descriptorArray = Array.from(currentDescriptor);

          // Clear interval immediately so it stops scanning during network latency
          clearInterval(interval);
      detectionIntervalRef.current = null;

          // Delegate saving entirely to the app's centralized prop function
          await onSaveDescriptor(userId, descriptorArray);
          
          stopCamera(); 
          
          if (onRegisterSuccess) onRegisterSuccess();
        } catch (err) {
          console.error(err);
          setFeedback('Cloud sync failed. Try again.');
          setErrorState(true);
        }
      } else {
        setFeedback('Smile to set your secure key');
        setIsPulsing(smileValue > 0.3);
      }

    } else {
      if (!savedDescriptor) {
        setFeedback('No Face ID found. Please register first.');
        setErrorState(true);
        return;
      }

      const targetDescriptor = new Float32Array(savedDescriptor);
      const distance = faceapi.euclideanDistance(currentDescriptor, targetDescriptor);

      if (distance < 0.5) {
        setErrorState(false);
        if (smileValue > 0.85) {
          setFeedback('Identity Verified! Opening...');
          setIsPulsing(true);
          
          clearInterval(interval);
      detectionIntervalRef.current = null;
          stopCamera(); 
          setTimeout(() => onUnlock(), 1000);
        } else {
          setFeedback('Hi! Just smile to enter 😊');
          setIsPulsing(true);
        }
      } else {
        setFeedback('Identity not recognized 🔒');
        setErrorState(true);
        setIsPulsing(false);
      }
    } 
  }, 700);

  detectionIntervalRef.current = interval;
};

// HELPER FUNCTION: kills the camera AND the detection loop together
const stopCamera = () => {
  if (detectionIntervalRef.current) {
    clearInterval(detectionIntervalRef.current);
    detectionIntervalRef.current = null;
  }
  if (videoRef.current && videoRef.current.srcObject) {
    const stream = videoRef.current.srcObject as MediaStream;
    const tracks = stream.getTracks();
    tracks.forEach(track => track.stop());
    videoRef.current.srcObject = null;
  }
};

  return (
    <div className="fixed inset-0 z-[9999] bg-[#FFF0F3] flex flex-col items-center justify-center p-8">
      {/* Visual Header for Mode */}
      <div className="absolute top-10 flex items-center gap-2 bg-white/50 px-4 py-2 rounded-full backdrop-blur-md border border-white">
        {mode === 'register' ? (
          <><UserPlus className="w-4 h-4 text-pink-500" /> <span className="text-pink-600 text-xs font-bold uppercase tracking-widest">Face Registration</span></>
        ) : (
          <><Lock className="w-4 h-4 text-pink-500" /> <span className="text-pink-600 text-xs font-bold uppercase tracking-widest">Secure Entry</span></>
        )}
      </div>

      <div className={`relative w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-[10px] border-white shadow-[0_20px_50px_rgba(255,105,180,0.3)] transition-all duration-500 ${isPulsing ? 'scale-105 shadow-pink-400' : ''}`}>
        <video
          ref={videoRef}
          autoPlay
          muted
          onPlay={handleDetection}
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-pink-400/20 to-transparent h-20 w-full animate-[scan_2s_linear_infinite]" />
      </div>

      <div className="mt-12 text-center max-w-xs w-full">
        <div className="bg-white/80 backdrop-blur-sm p-6 rounded-[32px] shadow-xl border border-white">
          <div className="flex justify-center mb-4 gap-3">
            {errorState ? (
              <AlertCircle className="w-10 h-10 text-red-500 animate-pulse" />
            ) : isPulsing ? (
              <ShieldCheck className="w-10 h-10 text-green-500 animate-bounce" />
            ) : (
              <>
                <Smile className="w-8 h-8 text-pink-400 animate-pulse" />
              </>
            )}
          </div>
          <h2 className="text-pink-600 font-black text-xl mb-2 min-h-[1.5em]">{feedback}</h2>
          <p className="text-pink-400/60 text-[10px] uppercase font-bold tracking-[0.2em]">
            {mode === 'register' ? 'Setting up biometric key' : 'Biometric Expression Lock'}
          </p>
        </div>
        
        {/* Cancel Button (register mode) so the user isn't trapped in settings */}
        {mode === 'register' && (
          <button 
            onClick={() => {
              stopCamera();
              onUnlock();
            }}
            className="mt-6 text-pink-400 text-sm font-medium hover:text-pink-600 transition-colors"
          >
            Cancel Registration
          </button>
        )}

        {/* Escape hatch for verify mode — without this, a user with no
            working verification path (camera denied, models failed to
            load, or no saved descriptor at all) has no way back into
            their own app. Always present, deliberately low-emphasis so it
            doesn't read as an easy security bypass. */}
        {mode === 'verify' && onSignOut && (
          <button
            onClick={() => {
              stopCamera();
              onSignOut();
            }}
            className="mt-6 text-pink-300 text-xs font-medium hover:text-pink-500 transition-colors"
          >
            Not you? Sign out instead
          </button>
        )}

        {mode === 'verify' && onCancel && (
          <button
            onClick={() => {
              stopCamera();
              onCancel();
            }}
            className="mt-6 text-pink-300 text-xs font-medium hover:text-pink-500 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      <style>{`
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(300%); }
        }
      `}</style>
    </div>
  );
};
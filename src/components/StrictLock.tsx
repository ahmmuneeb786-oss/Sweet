import { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';
import { Lock, Smile, AlertCircle, ShieldCheck, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface StrictLockProps {
  onUnlock: () => void;
  mode?: 'verify' | 'register';
  onRegisterSuccess?: () => void;
  savedDescriptor?: number[] | null;
  userId: string;
  onSaveDescriptor: (userId: string, descriptor: number[]) => Promise<void>;
}

export const StrictLock = ({ 
  onUnlock, 
  mode = 'verify', 
  onRegisterSuccess,
  savedDescriptor,
  userId,
  onSaveDescriptor
}: StrictLockProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
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

    // Cleanup camera on unmount
    return () => {
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

  const interval = setInterval(async () => {
    // 1. Detect ALL faces with landmarks, expressions, and descriptors
    const detections = await faceapi.detectAllFaces(
      videoRef.current!,
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks().withFaceExpressions().withFaceDescriptors();

    // 2. PRIVACY RULE: Block if more than 1 person is seen
    if (detections.length > 1) {
      setFeedback('Privacy Alert: Multiple people detected! 🔒');
      setErrorState(true);
      setIsPulsing(false);
      return; 
    }

    // 3. NO FACE RULE
    if (detections.length === 0) {
      setFeedback('No face detected');
      setIsPulsing(false);
      setErrorState(false);
      return;
    }

    // 4. PREPARE DATA (Exactly 1 person is in frame)
    const person = detections[0];
    const smileValue = person.expressions.happy;
    const currentDescriptor = person.descriptor;

    if (mode === 'register') {
      /** --- REGISTRATION MODE --- **/
      if (smileValue > 0.85) {
        setFeedback('Smile Captured! Syncing to Cloud...');
        
        try {
          const descriptorArray = Array.from(currentDescriptor);

          await onSaveDescriptor(userId, descriptorArray);
          
          // SAVE TO SUPABASE (Replace 'user.id' with your actual user state)
          const { error } = await supabase
            .from('profiles')
            .update({ face_descriptor: descriptorArray })
            .eq('id', userId);

          if (error) throw error;

          // Locally mark as registered so the UI updates
          localStorage.setItem('face_lock_registered', 'true');
          
          clearInterval(interval);
          stopCamera(); // Kill camera immediately
          
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
      /** --- VERIFY MODE --- **/
      // Fetch the descriptor we got from Supabase when the app loaded
      // (This should be passed into StrictLock as a prop: 'savedDescriptor')
      if (!savedDescriptor) {
        setFeedback('No Face ID found. Please register first.');
        setErrorState(true);
        return;
      }

      const targetDescriptor = new Float32Array(savedDescriptor);
      const distance = faceapi.euclideanDistance(currentDescriptor, targetDescriptor);

      // Distance check: < 0.5 is a strong match for the same person
      if (distance < 0.5) {
        setErrorState(false);
        if (smileValue > 0.85) {
          setFeedback('Identity Verified! Opening...');
          setIsPulsing(true);
          
          clearInterval(interval);
          stopCamera(); // Kill camera immediately
          setTimeout(() => onUnlock(), 1000);
        } else {
          setFeedback('Hi! Just smile to enter 😊');
          setIsPulsing(true);
        }
      } else {
        // It's a face, but not YOUR face
        setFeedback('Identity not recognized 🔒');
        setErrorState(true);
        setIsPulsing(false);
      }
    } 
  }, 700);

  return () => clearInterval(interval);
};

// HELPER FUNCTION: Add this inside your component to kill the camera
const stopCamera = () => {
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
        
        {/* Cancel Button (Only in Register mode so user isn't trapped in settings) */}
        {mode === 'register' && (
          <button 
            onClick={onUnlock}
            className="mt-6 text-pink-400 text-sm font-medium hover:text-pink-600 transition-colors"
          >
            Cancel Registration
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
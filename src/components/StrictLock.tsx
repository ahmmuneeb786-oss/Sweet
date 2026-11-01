import { useEffect, useRef, useState } from 'react';
import { Lock, Smile, AlertCircle, ShieldCheck, UserPlus } from 'lucide-react';
import { PermissionManager } from '../services/PermissionManager';
import { useNotify } from '../contexts/NotificationContext';
import { preloadFaceModels, type FaceApi } from '../lib/faceModels';

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
  // Verify mode: called once per sustained wrong-face streak, so the vault
  // can count it against its failed-attempt limit (see lib/vaultAttempts).
  onMismatch?: () => void;
}

// Frames are checked every 700ms; this many non-matching frames in a row
// (~3.5s of a wrong face) count as one failed attempt — a single bad frame
// (blink, turned head) doesn't.
const MISMATCH_FRAMES_PER_ATTEMPT = 5;

// A new scan starts 700ms after the previous one STARTED — or right after it
// finished, if it took longer than that. Scans never overlap: a fixed
// setInterval used to start a new one every 700ms regardless, which on slow
// phones piled scans up (frozen screen) and could let two in-flight scans
// both unlock, or both save a registration.
const SCAN_INTERVAL_MS = 700;

export const StrictLock = ({ 
  onUnlock, 
  mode = 'verify', 
  onRegisterSuccess,
  savedDescriptor,
  userId,
  onSaveDescriptor,
  onSignOut,
  onCancel,
  onMismatch
}: StrictLockProps) => {
  const { showError } = useNotify();
  // The detection loop is created once, so it would see a
  // stale onMismatch — read the latest through a ref instead.
  const onMismatchRef = useRef(onMismatch);
  onMismatchRef.current = onMismatch;
  const mismatchStreakRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the scan loop is running; set false to stop it. A scan that's
  // mid-flight when this flips ignores its own result.
  const scanLoopActiveRef = useRef(false);
  // face-api.js is loaded on demand (see lib/faceModels), so the module
  // arrives with the models instead of through a static import.
  const faceapiRef = useRef<FaceApi | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [feedback, setFeedback] = useState('Initializing FaceID...');
  const [isPulsing, setIsPulsing] = useState(false);
  const [errorState, setErrorState] = useState(false);

  useEffect(() => {
    const loadModels = async () => {
      try {
        // Shared with the rest of the app — if App.tsx already started this
        // in the background when the app opened, this just picks up that
        // same in-flight (or already-finished) load instead of starting a
        // second one from a third-party URL.
        faceapiRef.current = await preloadFaceModels();
        setIsModelLoaded(true);
        startCamera();
      } catch (err) {
        setFeedback('Security models failed to load');
        setErrorState(true);
      }
    };
    loadModels();

    // Cleanup camera AND the detection loop on unmount
    return () => {
      stopScanning();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    // Route through PermissionManager instead of calling getUserMedia
    // directly — this checks the CURRENT status first, so an already-denied
    // permission gets a clear, actionable message instead of just failing.
    // If status is genuinely undecided ('prompt'), this is what actually
    // triggers the browser's native permission dialog — that's simply how
    // getUserMedia works, PermissionManager can't force a prompt any other way.
    const granted = await PermissionManager.requestPermission('camera');

    if (!granted) {
      const status = await PermissionManager.checkPermission('camera');
      if (status === 'denied') {
        setFeedback('Camera access is blocked');
        showError('Camera access is blocked for this site. Enable it in your browser\'s site settings, then reload.');
      } else {
        setFeedback('Camera access denied');
        showError('Camera access is needed for face verification.');
      }
      setErrorState(true);
      return;
    }

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
      showError('Could not start the camera. Please try again.');
      setErrorState(true);
    }
  };

const handleDetection = async () => {
  const faceapi = faceapiRef.current;
  if (!videoRef.current || !isModelLoaded || !faceapi) return;

  // onPlay can fire more than once in some browsers (e.g. after any
  // pause/replay cycle). Without this guard, each firing would start another
  // loop scanning the same feed.
  if (scanLoopActiveRef.current) return;
  scanLoopActiveRef.current = true;

  const runScan = async () => {
    scanTimerRef.current = null;
    if (!scanLoopActiveRef.current) return;
    if (!videoRef.current) {
      stopScanning();
      return;
    }

    const startedAt = performance.now();
    try {
      await scanOnce(faceapi);
    } catch (err) {
      console.warn('Face scan failed, trying again:', err);
    }

    // Unlocked, registered, cancelled or unmounted during this scan — done.
    if (!scanLoopActiveRef.current) return;
    const wait = Math.max(0, SCAN_INTERVAL_MS - (performance.now() - startedAt));
    scanTimerRef.current = setTimeout(runScan, wait);
  };

  runScan();
};

// One scan of the current camera frame. Returning early just means "keep
// scanning"; stopScanning() is what ends the loop.
const scanOnce = async (faceapi: FaceApi) => {
    if (!videoRef.current) return;
    const detections = await faceapi.detectAllFaces(
      videoRef.current,
      new faceapi.TinyFaceDetectorOptions()
    ).withFaceLandmarks().withFaceExpressions().withFaceDescriptors();

    // Stopped while this scan was running — its result no longer applies
    // (this is what prevents a second unlock or a second save).
    if (!scanLoopActiveRef.current) return;

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
         stopScanning();
         return;
       }
        setFeedback('Smile Captured! Syncing to Cloud...');
        
        try {
          const descriptorArray = Array.from(currentDescriptor);

          // Stop scanning immediately so it doesn't scan during network latency
          stopScanning();

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
        mismatchStreakRef.current = 0;
        setErrorState(false);
        if (smileValue > 0.85) {
          setFeedback('Identity Verified! Opening...');
          setIsPulsing(true);

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

        mismatchStreakRef.current += 1;
        if (mismatchStreakRef.current >= MISMATCH_FRAMES_PER_ATTEMPT) {
          mismatchStreakRef.current = 0;
          onMismatchRef.current?.();
        }
      }
    }
};

// Ends the scan loop; a scan already in progress ignores its result.
const stopScanning = () => {
  scanLoopActiveRef.current = false;
  if (scanTimerRef.current) {
    clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
  }
};

// HELPER FUNCTION: kills the camera AND the detection loop together
const stopCamera = () => {
  stopScanning();
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
        
        {/* Cancel Button (register mode) so the user isn't trapped in settings.
            Prefers onCancel: onUnlock means "verified", and callers that act
            on it (e.g. switching the vault to biometric) must not fire on a
            cancel. Falls back for callers that only pass onUnlock. */}
        {mode === 'register' && (
          <button
            onClick={() => {
              stopCamera();
              (onCancel ?? onUnlock)();
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
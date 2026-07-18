import { useEffect, useRef, useState } from 'react';
import { Phone, Video, PhoneOff, Mic, MicOff, VideoOff, Volume2 } from 'lucide-react';

interface CallOverlayProps {
  type: 'audio' | 'video';
  direction: 'incoming' | 'outgoing' | 'connected';
  userName: string;
  userAvatar: string | null;
  theme: 'light' | 'dark' | 'sweet';
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onReject: () => void;
  onAccept?: () => void;
  onHangUp: () => void;
}

export function CallOverlay({
  type,
  direction,
  userName,
  userAvatar,
  theme,
  localStream,
  remoteStream,
  onReject,
  onAccept,
  onHangUp,
}: CallOverlayProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Bind the live MediaStreams to their elements — this is the actual
  // audio/video transfer; everything else here is just call-state UI.
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // Simple call duration timer once connected
  useEffect(() => {
    if (direction !== 'connected') return;
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [direction]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    localStream?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setIsMuted(next);
  };

  const handleToggleCam = () => {
    const next = !isCamOff;
    localStream?.getVideoTracks().forEach((track) => { track.enabled = !next; });
    setIsCamOff(next);
  };

  // Dynamic backgrounds based on app theme
  const bgStyles = {
    dark: 'bg-slate-950 text-slate-100',
    light: 'bg-zinc-100 text-zinc-900',
    sweet: 'bg-pink-950 text-rose-100',
  };

  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-between p-8 backdrop-blur-xl bg-opacity-95 ${bgStyles[theme] || bgStyles.dark}`}>

      {/* Remote audio always plays, even for audio-only calls where no
          <video> element exists to carry it. For video calls the remote
          <video> below already plays the audio track, so this stays silent
          to avoid doubling it up. */}
      {type === 'audio' && <audio ref={remoteAudioRef} autoPlay className="hidden" />}

      {/* Top Section: Status Label */}
      <div className="text-center mt-12 animate-fade-in">
        <span className="text-xs uppercase tracking-widest font-bold opacity-60">
          {type === 'video' ? '📹 Video Call' : '📞 Audio Call'}
        </span>
        <h2 className="text-3xl font-extrabold mt-2">{userName}</h2>
        <p className="text-sm mt-2 opacity-80 font-medium">
          {direction === 'outgoing' && 'Ringing...'}
          {direction === 'incoming' && 'Incoming Call'}
          {direction === 'connected' && !remoteStream && type === 'video' && 'Connecting...'}
          {direction === 'connected' && (remoteStream || type === 'audio') && `Connected • ${formatTime(callDuration)}`}
        </p>
      </div>

      {/* Middle Section: Big Pulsing Avatar / Video Feeds */}
      <div className="flex flex-col items-center justify-center my-auto relative">
        {type === 'video' && direction === 'connected' ? (
          <div className="w-64 h-96 rounded-2xl bg-black border border-white/10 flex items-center justify-center shadow-2xl overflow-hidden relative">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <Video className="w-12 h-12 opacity-20 animate-pulse" />
            )}

            <div className="absolute text-xs bottom-4 left-4 bg-black/60 px-2 py-1 rounded text-white">
              {userName}
            </div>

            {/* Self-view PIP — muted so we never hear our own mic back */}
            {!isCamOff && localStream && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute top-3 right-3 w-20 h-28 object-cover rounded-lg border border-white/30 shadow-lg bg-black"
              />
            )}
          </div>
        ) : (
          <div className="relative">
            {/* Pulsing visual circles matching Telegram call styles */}
            <div className="absolute inset-0 rounded-full bg-current opacity-10 animate-ping" style={{ animationDuration: '2s' }} />
            {userAvatar ? (
              <img
                src={userAvatar}
                alt={userName}
                className="w-32 h-32 rounded-full object-cover shadow-2xl border-4 border-current/20 relative z-10"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-current/10 flex items-center justify-center text-4xl font-black shadow-2xl border-4 border-current/20 relative z-10">
                {userName[0]}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Section: Action Control Panel */}
      <div className="mb-12 w-full max-w-sm flex flex-col gap-6 items-center">

        {/* Toggle tools inside connected calls */}
        {direction === 'connected' && (
          <div className="flex items-center gap-6 mb-2">
            <button
              onClick={handleToggleMute}
              className={`p-3 rounded-full border transition ${isMuted ? 'bg-red-500 border-red-500 text-white' : 'bg-transparent border-current/20 hover:bg-current/10'}`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {type === 'video' && (
              <button
                onClick={handleToggleCam}
                className={`p-3 rounded-full border transition ${isCamOff ? 'bg-red-500 border-red-500 text-white' : 'bg-transparent border-current/20 hover:bg-current/10'}`}
              >
                {isCamOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
            )}

            <button className="p-3 rounded-full border border-current/20 hover:bg-current/10 transition">
              <Volume2 className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Core Accept / Deny / Hangup Layout Rows */}
        <div className="flex items-center justify-center gap-12 w-full">
          {direction === 'incoming' ? (
            <>
              {/* Decline Button */}
              <button
                onClick={onReject}
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <PhoneOff className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold opacity-70">Decline</span>
              </button>

              {/* Accept Button */}
              <button
                onClick={onAccept}
                className="flex flex-col items-center gap-2 group"
              >
                <div className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform animate-bounce">
                  <Phone className="w-6 h-6" />
                </div>
                <span className="text-xs font-bold opacity-70">Accept</span>
              </button>
            </>
          ) : (
            /* Outgoing or Active Connected -> Only Hang Up action needed */
            <button
              onClick={onHangUp}
              className="flex flex-col items-center gap-2 group"
            >
              <div className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <PhoneOff className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold opacity-70">Hang Up</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

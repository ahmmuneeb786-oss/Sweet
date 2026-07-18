import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export type CallType = 'audio' | 'video';
export type CallDirection = 'incoming' | 'outgoing' | 'connected';

export interface ActiveCall {
  type: CallType;
  direction: CallDirection;
}

// Public STUN only — enough to punch through most home/office NATs so both
// sides discover a usable route, but carrier-grade NAT (common on mobile
// data) can still block the direct path with no TURN relay as a fallback.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useCall(chatId: string | undefined, userId: string | undefined) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callTypeRef = useRef<CallType | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSet = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload: { ...payload, from: userId } });
  }, [userId]);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    callTypeRef.current = null;
    pendingCandidates.current = [];
    remoteDescSet.current = false;
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (e) => {
      if (e.candidate) send('ice-candidate', { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
    };
    pcRef.current = pc;
    return pc;
  }, [send]);

  const getMedia = async (type: CallType) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video' ? { facingMode: 'user' } : false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  };

  const startCall = useCallback(async (type: CallType) => {
    if (!chatId || !userId) return;
    callTypeRef.current = type;
    setActiveCall({ type, direction: 'outgoing' });
    try {
      await getMedia(type);
      send('call-init', { type });
    } catch (err) {
      cleanup();
      setActiveCall(null);
      throw err;
    }
  }, [chatId, userId, send, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!activeCall) return;
    try {
      const stream = await getMedia(activeCall.type);
      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      setActiveCall({ ...activeCall, direction: 'connected' });
      send('call-accept', {});
    } catch (err) {
      cleanup();
      setActiveCall(null);
      throw err;
    }
  }, [activeCall, createPeerConnection, send, cleanup]);

  const rejectCall = useCallback(() => {
    send('call-end', {});
    cleanup();
    setActiveCall(null);
  }, [send, cleanup]);

  const hangUp = useCallback(() => {
    send('call-end', {});
    cleanup();
    setActiveCall(null);
  }, [send, cleanup]);

  useEffect(() => {
    if (!chatId || !userId) return;

    const channel = supabase.channel(`call:${chatId}`);

    channel.on('broadcast', { event: 'call-init' }, ({ payload }) => {
      if (payload.from === userId) return;
      callTypeRef.current = payload.type;
      setActiveCall({ type: payload.type, direction: 'incoming' });
    });

    // We're the caller: the other side just accepted, and already has a
    // peer connection with their local tracks attached — now we build ours
    // and kick off the actual offer/answer exchange.
    channel.on('broadcast', { event: 'call-accept' }, async ({ payload }) => {
      if (payload.from === userId) return;
      const stream = localStreamRef.current;
      if (!stream || !callTypeRef.current) return;
      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      setActiveCall((prev) => (prev ? { ...prev, direction: 'connected' } : prev));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send('offer', { sdp: offer });
    });

    channel.on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (payload.from === userId) return;
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      remoteDescSet.current = true;
      for (const candidate of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidates.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send('answer', { sdp: answer });
    });

    channel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
      if (payload.from === userId) return;
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      remoteDescSet.current = true;
      for (const candidate of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidates.current = [];
    });

    channel.on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
      if (payload.from === userId) return;
      const pc = pcRef.current;
      if (!pc) return;
      if (remoteDescSet.current) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (err) {
          console.error('Failed to add ICE candidate:', err);
        }
      } else {
        pendingCandidates.current.push(payload.candidate);
      }
    });

    channel.on('broadcast', { event: 'call-end' }, ({ payload }) => {
      if (payload.from === userId) return;
      cleanup();
      setActiveCall(null);
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [chatId, userId, createPeerConnection, send, cleanup]);

  // Belt-and-braces: release camera/mic if the component unmounts mid-call.
  useEffect(() => () => cleanup(), [cleanup]);

  return { activeCall, localStream, remoteStream, startCall, acceptCall, rejectCall, hangUp };
}

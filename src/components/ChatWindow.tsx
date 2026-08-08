import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Send, Phone, Video, FileText, X, Mic, AlertCircle, Check, ArrowLeft, Pencil, Reply } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import LocationPicker from './LocationPicker';
import { supabase } from '../lib/supabase';
import { Message, type Reaction, type MessageReactionState } from './Message';
import { ChatMenu } from './ChatMenu';
import { UserProfileView } from './UserProfileView';
import { SweetKeyboard } from './SweetKeyboard';
import { learnFromMessage } from '../predictionService';
import { GifItem } from '../App';
import { localDB } from '../db';
import { CallOverlay } from './CallOverlay';
import { ImageViewerModal } from './ImageViewerModal';
import { usePresence } from '../hooks/usePresence';
import { useBackableState } from '../hooks/useBackableState';
import { queuePendingMessage, retryPendingMessage, subscribeToSyncEvents } from '../hooks/useOfflineSync';
import { useNotify } from '../contexts/NotificationContext';
import { useCall } from '../hooks/useCall';
import { loadHiddenMessageIds, hideMessageLocally } from '../lib/hiddenMessages';
import { requestChatListRefresh } from '../hooks/chatListRefresh';
import { onMessageStored } from '../hooks/messageBus';
import { formatMessagePreview } from '../lib/messagePreview';

interface ChatWindowProps {
  onOpenGifPanel: () => void;
  myGifs: GifItem[];
  setMyGifs: React.Dispatch<React.SetStateAction<GifItem[]>>;
  chatId: string;
  theme: 'light' | 'dark' | 'sweet';
  onBack?: () => void;
}

interface MessageType {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'read' | 'pending' | 'failed';
  profiles: {
    display_name: string;
    avatar_url: string | null;
    username: string;
  };
}

interface ChatInfo {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  theme: string;
  last_message_content?: string | null;
  last_message_time?: string | null;
  otherUser?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
    last_seen: string;
  };
}

// Stable empty sentinels — referentially stable across renders
const REACTIONS_EMOJIS = ['💖', '🥰', '😍', '💋', '😂'] as const;
const EMPTY_REACTIONS: Reaction[] = [];
const EMPTY_USER_MAP: Record<string, string> = {};

const TEXTAREA_MAX_HEIGHT = 150;

function formatLastSeen(lastSeenTimestamp: string | null | undefined): string {
  if (!lastSeenTimestamp) return 'last seen long time ago';
  const date = new Date(lastSeenTimestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const diffInSeconds = Math.abs(now.getTime() - date.getTime()) / 1000;
  if (diffInSeconds <= 300) return 'last seen just now';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (hours < 1) return `last seen ${Math.floor(diff / (1000 * 60))}m ago`;
  if (hours < 24) return `last seen ${hours}h ago`;
  if (days <= 7) return `last seen ${days}d ago`;
  if (days > 7 && days <= 30) return 'last seen within a week';
  return 'last seen long time ago';
}

export function ChatWindow({ chatId, theme, onBack, onOpenGifPanel, myGifs, setMyGifs }: ChatWindowProps) {
  const { user } = useAuth();
  const { isOnline: isUserOnline } = usePresence(user?.id);
  const { showError } = useNotify();
  const [messages, setMessages] = useState<MessageType[]>([]);
  // Mirror of `messages` for async loops (jump-to-message) that can't rely on
  // the render-time closure's value.
  const messagesRef = useRef<MessageType[]>([]);
  messagesRef.current = messages;
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);

  // ── Older-message pagination (scroll up to load the previous page) ──────────
  const MESSAGE_PAGE_SIZE = 60;
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasMoreOlderRef = useRef(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  // Set right before a prepend so the scroll effect anchors the viewport
  // instead of jumping to the bottom.
  const justPrependedRef = useRef(false);
  const prevScrollHeightRef = useRef(0);

  // Parent messages referenced by a reply whose parent is OUTSIDE the loaded
  // window (older than the current page) — fetched on demand so the quote
  // still renders.
  const [replyParents, setReplyParents] = useState<Record<string, MessageType>>({});
  // Briefly highlighted after a jump-to-message so the user sees where they landed.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // The first unread (received, not-yet-read) message when the chat was opened —
  // an "Unread messages" divider is drawn just above it, and the chat opens
  // scrolled there. Snapshotted on open so it stays put even after we mark
  // everything read. null = no unread, open at the bottom.
  const [unreadDividerId, setUnreadDividerId] = useState<string | null>(null);
  // Whether we've done the one-time instant positioning for this chat (so the
  // scroll effect doesn't fight it), and the last message id we've seen at the
  // bottom (to detect genuinely-new appended messages).
  const didInitialScrollRef = useRef(false);
  const prevLastIdRef = useRef<string | null>(null);
  // Set once the authoritative load has committed, so the initial-position
  // layout effect doesn't fire off the (possibly-stale) cache render.
  const initialReadyRef = useRef(false);
  // Whether the view should keep pinning to the bottom. True on open and while
  // the user is at/near the bottom; turned off once they scroll up. This is
  // what keeps us at the newest message even as avatars/images load in and
  // grow the content after the first paint.
  const stickToBottomRef = useRef(true);
  // When a chat opens WITH unread messages, we anchor the "Unread messages"
  // divider near the middle of the screen (instead of the bottom) during the
  // brief settle window while content/images load. Holds that message id; null
  // otherwise.
  const openUnreadAnchorRef = useRef<string | null>(null);
  // True while WE are programmatically scrolling, so the scroll handler ignores
  // those events (doesn't mistake them for the user scrolling and cancel the
  // anchor / trigger load-older).
  const isAutoScrollingRef = useRef(false);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newMessage, setNewMessage] = useState('');
  // When set, the composer is editing an existing message instead of sending
  // a new one. Holds the message id being edited.
  const [editingMessage, setEditingMessage] = useState<{ id: string } | null>(null);
  // When set, the next sent message is a reply to this one (its reply_to_id).
  const [replyingTo, setReplyingTo] = useState<MessageType | null>(null);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showProfileView, setShowProfileView] = useState(false);
  useBackableState(showProfileView, () => setShowProfileView(false));
  const [mediaViewer, setMediaViewer] = useState<{ urls: string[]; index: number } | null>(null);
  useBackableState(mediaViewer !== null, () => setMediaViewer(null));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Throttle typing broadcasts — fire at most once per 2500ms
  const lastTypingBroadcast = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isTextareaOverflowing, setIsTextareaOverflowing] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedGif, setSelectedGif] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [showSweetKeyboard, setShowSweetKeyboard] = useState(false);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Blob | null>(null);
  const [isRecordingVideoNote, setIsRecordingVideoNote] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDoc, setSelectedDoc] = useState<File | null>(null);
  const { activeCall, localStream, remoteStream, startCall, acceptCall, rejectCall, hangUp } = useCall(chatId, user?.id);

  // ─── Centralized reaction state for all messages in this room ───────────────
  // Shape: { [messageId]: { reactions: Reaction[], userMap: Record<string,string> } }
  const [messageReactions, setMessageReactions] = useState<Record<string, MessageReactionState>>({});

  const latestChatIdRef = useRef<string | undefined>(chatId);
  latestChatIdRef.current = chatId;

  useEffect(() => {
    if (chatId && user) {
      // ChatWindow is reused across chats (not remounted), so reset the
      // pagination + reply-parent state that would otherwise leak from the
      // previous chat.
      hasMoreOlderRef.current = true;
      loadingOlderRef.current = false;
      didInitialScrollRef.current = false;
      initialReadyRef.current = false;
      stickToBottomRef.current = true;
      openUnreadAnchorRef.current = null;
      isAutoScrollingRef.current = false;
      prevLastIdRef.current = null;
      setReplyParents({});
      setHighlightedMessageId(null);
      setUnreadDividerId(null);
      hydrateThenLoad(chatId);
    }
  }, [chatId, user]);

  async function hydrateThenLoad(requestedChatId: string) {
    // Cache-first: if we've opened this chat before (including "switching
    // back" to one already visited this session), paint the header instantly
    // from localDB instead of blanking the screen for another 1-2s round trip
    // to Supabase. loadChat() still runs right after to quietly reconcile
    // with the network — this is the exact same pattern ChatList uses.
    const cached = await localDB.chats.get(requestedChatId);

    // If the user has already switched to a different chat while this await
    // was in flight, this response is stale — applying it would show the
    // wrong chat's info for a moment, which is the bug being fixed here.
    if (latestChatIdRef.current !== requestedChatId) return;

    if (cached) {
      setChatInfo({
        id: cached.id,
        type: cached.type,
        name: cached.name,
        theme: cached.theme,
        otherUser: cached.other_user_id ? {
          id: cached.other_user_id,
          display_name: cached.other_user_name || '',
          avatar_url: cached.other_user_avatar || null,
          is_online: false, // unused for display now — usePresence drives the dot
          last_seen: cached.other_user_last_seen || '',
        } : undefined,
      });
      setLoading(false);
    } else {
      // Genuinely never seen this chat before (brand new chat, or first
      // device/browser) — nothing to show yet, so a real loading state here
      // is correct rather than a bug.
      setLoading(true);
      setChatInfo(null);
    }

    loadChat(requestedChatId);
  }

  useEffect(() => {
    const tickerInterval = setInterval(() => {
      setChatInfo((prev) => (prev ? { ...prev } : null));
    }, 10000);
    return () => clearInterval(tickerInterval);
  }, []);

  // Scroll management on every messages change:
  //  - after prepending an older page, keep the viewport anchored,
  //  - before the one-time initial positioning happens, do nothing (that's
  //    handled imperatively in loadMessages so opening is instant, not a
  //    top-to-bottom animation),
  //  - after that, smooth-scroll to the bottom only for genuinely NEW messages
  //    appended at the end (not edits, reconciles, or reaction updates).
  // Flag our own scrolls so the scroll handler doesn't treat them as the user
  // scrolling. Held for a short window so the resulting scroll event is caught.
  const markAutoScroll = useCallback(() => {
    isAutoScrollingRef.current = true;
    if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
    autoScrollTimerRef.current = setTimeout(() => { isAutoScrollingRef.current = false; }, 120);
  }, []);

  // Jump the scroll to the very bottom instantly.
  const pinToBottom = useCallback(() => {
    const c = messagesContainerRef.current;
    if (c) { markAutoScroll(); c.scrollTop = c.scrollHeight; }
  }, [markAutoScroll]);

  // Center the currently-anchored unread divider in the viewport.
  const centerOnUnread = useCallback(() => {
    const c = messagesContainerRef.current;
    const id = openUnreadAnchorRef.current;
    if (!c || !id) return;
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    markAutoScroll();
    c.scrollTop = Math.max(0, el.offsetTop - c.clientHeight / 2);
  }, [markAutoScroll]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (justPrependedRef.current && container) {
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      justPrependedRef.current = false;
      return;
    }

    // One-time positioning when a chat opens (after the authoritative load), no
    // animation. We (re)apply it now AND across the next few frames/timeouts
    // because avatars and image/gif bubbles finish loading a moment later and
    // grow the content — without the repeats, that late growth would strand the
    // view. onLoadCapture on the container keeps re-applying too.
    if (!didInitialScrollRef.current) {
      if (!initialReadyRef.current || messages.length === 0 || !container) return;
      didInitialScrollRef.current = true;

      const hasUnread = !!(unreadDividerId && document.getElementById(`msg-${unreadDividerId}`));
      if (hasUnread) {
        // Land the "Unread messages" divider around the middle of the screen —
        // some read context above, the new messages below — instead of at the
        // very bottom.
        stickToBottomRef.current = false;
        openUnreadAnchorRef.current = unreadDividerId!;
        centerOnUnread();
        requestAnimationFrame(centerOnUnread);
        setTimeout(centerOnUnread, 100);
        setTimeout(centerOnUnread, 300);
        setTimeout(centerOnUnread, 600);
        // Stop holding the anchor once content has settled (or the user scrolls,
        // handled in the scroll listener).
        setTimeout(() => { openUnreadAnchorRef.current = null; }, 1200);
      } else {
        // No unread → land at the very bottom (newest messages).
        stickToBottomRef.current = true;
        const pinIfSticking = () => { if (stickToBottomRef.current) pinToBottom(); };
        pinToBottom();
        requestAnimationFrame(pinIfSticking);
        setTimeout(pinIfSticking, 100);
        setTimeout(pinIfSticking, 300);
        setTimeout(pinIfSticking, 600);
      }
      prevLastIdRef.current = messages[messages.length - 1]?.id ?? null;
      return;
    }

    // After the initial open, scroll to the bottom for a genuinely NEW message
    // at the end — but only if the user is currently at the bottom (don't yank
    // them down while they're reading history higher up).
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    if (lastId && lastId !== prevLastIdRef.current && stickToBottomRef.current) {
      scrollToBottom();
    }
    prevLastIdRef.current = lastId;
  }, [messages, unreadDividerId, pinToBottom, centerOnUnread]);

  useEffect(() => {
    if (!chatInfo?.otherUser?.id) return;

    const profileSubscription = supabase
      .channel(`header-status-${chatInfo.otherUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${chatInfo.otherUser.id}`,
        },
        (payload) => {
          setChatInfo((prev) => {
            if (!prev || !prev.otherUser) return prev;
            return {
              ...prev,
              otherUser: {
                ...prev.otherUser,
                is_online: payload.new.is_online,
                last_seen: payload.new.last_seen,
              },
            };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileSubscription);
    };
  }, [chatInfo?.otherUser?.id]);

  useEffect(() => {
    let stream: MediaStream | null = null;

    if (isRecordingVideoNote) {
      const startCamera = async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: true
          });

          const videoElement = document.getElementById('full-screen-video') as HTMLVideoElement;
          if (videoElement) {
            videoElement.srcObject = stream;
            await videoElement.play();
          }

          videoChunksRef.current = [];
          const recorder = new MediaRecorder(stream);

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) videoChunksRef.current.push(e.data);
          };

          recorder.onstop = () => {
            const videoBlob = new Blob(videoChunksRef.current, { type: 'video/mp4' });
            setSelectedVideo(videoBlob);
            setVideoPreview(URL.createObjectURL(videoBlob));
          };

          recorder.start();
          mediaRecorderRef.current = recorder;
        } catch (err) {
          showError("Please allow camera and microphone access!");
          setIsRecordingVideoNote(false);
        }
      };
      startCamera();
    }

    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [isRecordingVideoNote]);

  async function loadChat(requestedChatId: string) {
    if (!user || !requestedChatId) return;

    const cachedForThisChat = await localDB.chats.get(requestedChatId);
    const isStale = () => latestChatIdRef.current !== requestedChatId;

    try {
      if (requestedChatId === user.id) {
        await supabase.from('chats').upsert({ id: user.id, type: 'direct', name: 'Saved Messages', theme: 'love' });
        if (isStale()) return;
        setChatInfo({
          id: user.id,
          type: 'direct',
          name: 'Saved Messages',
          theme: 'love',
          otherUser: { id: user.id, display_name: 'Saved Messages', avatar_url: user.user_metadata?.avatar_url || null, is_online: true, last_seen: new Date().toISOString() }
        });
        setLoading(false);
        return;
      }

      let { data: chat } = await supabase.from('chats').select('*').eq('id', requestedChatId).maybeSingle();

      if (!chat) {
        const sortedIds = [user.id, requestedChatId].sort();
        const consistentRoomId = `${sortedIds[0]}_${sortedIds[1]}`;

        let { data: existingChat } = await supabase
          .from('chats')
          .select('*')
          .eq('id', consistentRoomId)
          .maybeSingle();

        if (!existingChat) {
          const { data: newChat, error } = await supabase
            .from('chats')
            .insert({ id: consistentRoomId, type: 'direct', updated_at: new Date().toISOString() })
            .select()
            .single();

          if (error) return;

          await supabase.from('chat_participants').insert([
            { chat_id: consistentRoomId, user_id: sortedIds[0] },
            { chat_id: consistentRoomId, user_id: sortedIds[1] }
          ]);

          existingChat = newChat;
        }
        chat = existingChat;
      }

      let chatData: ChatInfo = { id: chat.id, type: chat.type, name: chat.name || 'Chat', theme: chat.theme };

      const { data: participantData, error: partError } = await supabase
        .from('chat_participants')
        .select('user_id')
        .eq('chat_id', chat.id)
        .neq('user_id', user.id)
        .maybeSingle();

      if (partError) console.error("Participant fetch error:", partError);

      if (participantData?.user_id) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url, is_online, last_seen')
          .eq('id', participantData.user_id)
          .single();

        if (profile && !profileError) {
          chatData.otherUser = {
            id: profile.id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
            is_online: false,
            last_seen: profile.last_seen
          };
        }
      }

      if (isStale()) return; // a newer chat switch happened while these queries were in flight

      setChatInfo(chatData);

      // Seed/refresh the cache so this chat opens instantly next time too —
      // not just chats ChatList happened to fetch first. Flattened shape to
      // match LocalChat (see the earlier bug where a nested `otherUser`
      // object silently corrupted this same cache).
      await localDB.chats.put({
        id: chatData.id,
        type: chatData.type,
        name: chatData.name,
        avatar_url: (chat as any)?.avatar_url ?? null,
        theme: chatData.theme,
        last_message_content: cachedForThisChat?.last_message_content,
        last_message_time: cachedForThisChat?.last_message_time,
        other_user_id: chatData.otherUser?.id,
        other_user_name: chatData.otherUser?.display_name,
        other_user_avatar: chatData.otherUser?.avatar_url,
        other_user_last_seen: chatData.otherUser?.last_seen,
      });
    } catch (error) {
      console.error('Error in loadChat:', error);
      // Only surface this if the user is left with nothing to look at —
      // if a cached version already painted, a quiet background
      // reconciliation failure isn't worth interrupting them for.
      if (!cachedForThisChat && !isStale()) {
        showError("Couldn't load this chat. Check your connection.");
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  }

  // ─── Load reactions for a single message and update centralized state ────────
  const loadMessageReactions = useCallback(async (messageId: string) => {
    try {
      const { data } = await supabase
        .from('message_reactions')
        .select('*')
        .eq('message_id', messageId);

      if (!data) return;

      const reactionMap = new Map<string, Reaction>();
      const userMap: Record<string, string> = {};

      data.forEach((r) => {
        if (r.user_id === user?.id) {
          userMap[r.reaction] = r.user_id;
        }
        const existing = reactionMap.get(r.reaction);
        if (existing) {
          existing.count++;
        } else {
          reactionMap.set(r.reaction, { reaction: r.reaction, user_id: r.user_id, count: 1 });
        }
      });

      const reactions = Array.from(reactionMap.values());

      setMessageReactions(prev => ({
        ...prev,
        [messageId]: { reactions, userMap },
      }));
    } catch (err) {
      console.error('Error loading reactions for message:', messageId, err);
    }
  }, [user?.id]);

  // ─── Load initial reactions for all visible messages after they arrive ───────
  const loadAllReactions = useCallback(async (msgs: MessageType[]) => {
    const ids = msgs.map(m => m.id);
    if (ids.length === 0) return;

    try {
      const { data } = await supabase
        .from('message_reactions')
        .select('*')
        .in('message_id', ids);

      if (!data) return;

      const nextReactions: Record<string, MessageReactionState> = {};

      data.forEach((r) => {
        if (!nextReactions[r.message_id]) {
          nextReactions[r.message_id] = { reactions: [], userMap: {} };
        }
        const state = nextReactions[r.message_id];
        if (r.user_id === user?.id) {
          state.userMap[r.reaction] = r.user_id;
        }
        const existing = state.reactions.find(x => x.reaction === r.reaction);
        if (existing) {
          existing.count++;
        } else {
          state.reactions.push({ reaction: r.reaction, user_id: r.user_id, count: 1 });
        }
      });

      setMessageReactions(nextReactions);
    } catch (err) {
      console.error('Error bulk-loading reactions:', err);
    }
  }, [user?.id]);

  const handleInitiateCall = async (type: 'audio' | 'video') => {
    if (!chatInfo?.otherUser || !user) return;
    try {
      await startCall(type);
    } catch (err) {
      console.error('Failed to start call:', err);
      showError("Couldn't start the call. Check camera/microphone permissions.");
    }
  };

  async function loadMessages() {
    if (!chatInfo?.id) return;

    // Stage 4 — opening a chat is a LOCAL read. localDB is kept continuously
    // current by the app-wide message sync (useMessageSync), the launch/
    // reconnect catch-up (awaited behind the splash on launch, silent on
    // reconnect), and this chat's own realtime subscription. So tapping a chat
    // you already have opens instantly with NO network fetch. We only hit the
    // network the FIRST time a chat is opened on this device (nothing cached
    // yet) to download its recent history once — after that it stays local.
    // Older pages still load on scroll-up (loadOlderMessages); reconnect
    // reconciles the recent window.
    const hidden = loadHiddenMessageIds();
    // First received message not yet marked read = where the "Unread messages"
    // divider goes. Computed BEFORE markMessagesAsRead flips them all to read.
    const firstUnreadId = (list: MessageType[]) =>
      list.find((m) => m.sender_id !== user?.id && m.delivery_status !== 'read')?.id ?? null;

    try {
      const localMessages = await localDB.messages
        .where('chat_id')
        .equals(chatInfo.id)
        .sortBy('created_at');

      const recentLocal = localMessages.slice(-MESSAGE_PAGE_SIZE).filter((m) => !hidden.has(m.id));

      if (recentLocal.length > 0) {
        // Have it locally → render instantly from cache (no history refetch).
        setMessages(recentLocal);
        loadAllReactions(recentLocal);
        // If the cache holds a full page or more, there may be older pages;
        // loadOlderMessages self-corrects (and can still reach the network) if
        // it turns out there aren't.
        hasMoreOlderRef.current = localMessages.length >= MESSAGE_PAGE_SIZE;
        setUnreadDividerId(firstUnreadId(recentLocal));
        initialReadyRef.current = true;
        // Guaranteed top-up: the local cache is shown immediately, but a
        // message that arrived moments before opening (while on the chat list)
        // may not have been written to localDB yet by the background sync — and
        // this chat's realtime subscription can't replay it. So fetch ONLY
        // messages newer than our newest cached one and append them. This is
        // not a history refetch (it returns nothing in the common case); it's
        // the deterministic guarantee that opening a chat is never stale.
        topUpNewerMessages(recentLocal[recentLocal.length - 1]?.created_at ?? null);
        return;
      }

      // Nothing cached for this chat yet — first-ever open on this device.
      // Download the recent window once; from here on it's served from cache.
      if (!navigator.onLine) {
        initialReadyRef.current = true; // nothing to show offline; don't block positioning
        return;
      }

      const { data, error } = await supabase
        .from('messages')
        .select('*, profiles(display_name, avatar_url, username)')
        .eq('chat_id', chatInfo.id)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (!error && data) {
        const recent = [...data].reverse().filter((m) => !hidden.has(m.id)); // ascending for display, minus locally-hidden
        setMessages(recent);
        await localDB.messages.bulkPut(recent);
        loadAllReactions(recent);
        hasMoreOlderRef.current = data.length === MESSAGE_PAGE_SIZE;
        setUnreadDividerId(firstUnreadId(recent));
      }
      initialReadyRef.current = true;
    } catch (error) {
      console.error('Error loading messages:', error);
      initialReadyRef.current = true;
    }
  }

  // Fetch only messages NEWER than `since` for the open chat and append them.
  // Deterministically catches a message that arrived just before opening (which
  // the local cache and the chat's own realtime subscription can both miss).
  // Tiny query — returns nothing in the normal case — not a history refetch.
  async function topUpNewerMessages(since: string | null) {
    if (!since || !chatInfo?.id || !navigator.onLine) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*, profiles(display_name, avatar_url, username)')
        .eq('chat_id', chatInfo.id)
        .gt('created_at', since)
        .order('created_at', { ascending: true });
      if (error || !data || data.length === 0) return;

      const hidden = loadHiddenMessageIds();
      const fresh = (data as unknown as MessageType[]).filter((m) => !hidden.has(m.id));
      if (fresh.length === 0) return;

      await localDB.messages.bulkPut(fresh);
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const toAdd = fresh.filter((m) => !ids.has(m.id));
        return toAdd.length ? [...prev, ...toAdd] : prev;
      });
      loadAllReactions(fresh);
      markMessagesAsRead();
    } catch (err) {
      console.warn('Message top-up failed:', err);
    }
  }

  async function markMessagesAsRead() {
    if (!chatInfo?.id || !user) return;
    const { error } = await supabase
      .from('messages')
      .update({ delivery_status: 'read' })
      .eq('chat_id', chatInfo.id)
      .neq('sender_id', user.id)
      .neq('delivery_status', 'read');
    if (error) console.error('Error marking as read:', error);
  }

  function subscribeToMessages() {
    if (!chatInfo?.id) return;

    const channel = supabase
      .channel(`chat_messages:${chatInfo.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatInfo.id}`,
        },
        async (payload) => {
          const rawNewRecord = payload.new as any;

          const { data, error } = await supabase
            .from('messages')
            .select('*, profiles(display_name, avatar_url, username)')
            .eq('id', rawNewRecord.id)
            .single();

          if (data && !error) {
            const incomingMsg = data as unknown as MessageType;
            setMessages((prev) => {
              const exists = prev.find((m) => m.id === incomingMsg.id);
              if (exists) return prev.map((m) => (m.id === incomingMsg.id ? incomingMsg : m));
              return [...prev, incomingMsg];
            });
            if (incomingMsg.sender_id !== user?.id) markMessagesAsRead();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatInfo.id}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.new.id ? { ...m, ...payload.new, profiles: m.profiles } : m
            )
          );
        }
      )
      .subscribe((status) => {
        console.log("REALTIME_STATUS:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // ─── ONE room-level subscription replaces N per-message subscriptions ────────
  function subscribeToReactions() {
    if (!chatInfo?.id) return;

    const channel = supabase
      .channel(`room-reactions:${chatInfo.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          const messageId = (payload.new as any)?.message_id || (payload.old as any)?.message_id;
          if (messageId) loadMessageReactions(messageId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  function subscribeToTyping() {
    if (!chatInfo?.id) return;

    const channel = supabase
      .channel(`typing:${chatInfo.id}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId !== user?.id) {
          setIsOtherTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  async function uploadImage(file: File): Promise<string | null> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `uploads/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('chat-media').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('chat-media').getPublicUrl(filePath);
      return data.publicUrl;
    } catch (error) {
      console.error('Upload failed:', error);
      return null;
    }
  }

  const handleSendMessage = useCallback(async (e: React.FormEvent | React.KeyboardEvent, doc?: File) => {
    e.preventDefault();

    const messageContent = newMessage.trim();

    // Edit branch: the composer is editing an existing text message rather
    // than sending a new one. Update in place (content + is_edited) instead
    // of inserting — the other person gets it live via the UPDATE realtime
    // listener, and the "• Edited" footer lights up from is_edited.
    if (editingMessage && user && chatInfo) {
      if (!messageContent) return; // don't allow saving an empty edit
      const messageId = editingMessage.id;
      learnFromMessage(messageContent);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: messageContent, is_edited: true } : m))
      );
      setNewMessage('');
      setEditingMessage(null);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      try {
        await localDB.messages.update(messageId, { content: messageContent, is_edited: true });
        const { error } = await supabase
          .from('messages')
          .update({ content: messageContent, is_edited: true })
          .eq('id', messageId)
          .eq('sender_id', user.id);
        if (error) throw error;
      } catch (err) {
        console.error('Failed to edit message:', err);
        showError("Couldn't edit the message.");
      }
      return;
    }

    if (messageContent) learnFromMessage(messageContent);
    if ((!messageContent && !selectedFile && !audioBlob && !selectedVideo && !selectedDoc && !selectedGif) || !user || !chatInfo) return;

    const videoToUpload = selectedVideo;
    const videoUrlPreview = videoPreview;
    const tempId = crypto.randomUUID();
    const fileToUpload = selectedFile;
    const voiceToUpload = audioBlob;
    const voicePreview = recordedAudioUrl;
    const docToUpload = doc || selectedDoc;
    const gifToSend = selectedGif;
    const replyToId = replyingTo?.id ?? null;

    const tempMessage: MessageType = {
      id: tempId,
      chat_id: chatInfo.id,
      sender_id: user.id,
      content: docToUpload ? docToUpload.name : (voiceToUpload ? "Voice Note" : (messageContent || null)),
      type: gifToSend ? "gif" : videoToUpload ? "video" : voiceToUpload ? "voice" : docToUpload ? "file" : (fileToUpload ? "image" : "text"),
      media_url: gifToSend ? gifToSend : videoToUpload ? videoUrlPreview : voiceToUpload ? voicePreview : imagePreview,
      reply_to_id: replyToId,
      is_edited: false,
      is_deleted: false,
      created_at: new Date().toISOString(),
      delivery_status: "sending",
      profiles: {
        display_name: user.user_metadata?.display_name || "You",
        avatar_url: user.user_metadata?.avatar_url || null,
        username: user.user_metadata?.username || "you"
      }
    };

    setMessages(prev => [...prev, tempMessage]);
    setNewMessage("");
    setImagePreview(null);
    setAudioBlob(null);
    setSelectedFile(null);
    setVideoPreview(null);
    setSelectedVideo(null);
    setSelectedDoc(null);
    setSelectedGif(null);
    setReplyingTo(null);

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Save the optimistic message right away so it survives a reload even if
    // the app closes mid-send, before we know whether it'll succeed.
    await localDB.messages.put(tempMessage);

    const messageType = gifToSend ? "gif" : videoToUpload ? "video" : voiceToUpload ? "voice" : docToUpload ? "file" : (fileToUpload ? "image" : "text");
    const mediaBlob: Blob | undefined = docToUpload || fileToUpload || voiceToUpload || videoToUpload || undefined;
    const mediaFileName =
      docToUpload?.name ||
      fileToUpload?.name ||
      (videoToUpload as any)?.name ||
      (voiceToUpload ? `${tempId}.wav` : undefined);

    async function queueForLater(reason: unknown) {
      console.error("Send failed, queueing for retry:", reason);
      await queuePendingMessage({
        id: tempId,
        chat_id: chatInfo!.id,
        sender_id: user!.id,
        content: messageContent || (docToUpload ? docToUpload.name : (voiceToUpload ? "Voice Note" : null)),
        message_type: messageType,
        media_blob: mediaBlob,
        media_file_name: mediaFileName,
        media_url: gifToSend || undefined,
        reply_to_id: replyToId,
        created_at: tempMessage.created_at,
        attempts: 0,
        last_error: null,
      });
      setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, delivery_status: 'pending' } : m)));
    }

    if (!navigator.onLine) {
      // Don't even attempt the network — go straight to the outbox.
      await queueForLater(new Error('Offline'));
      setAudioBlob(null);
      setRecordedAudioUrl(null);
      setRecordingDuration(0);
      return;
    }

    try {
      // Already-hosted media — no upload step needed, just send the URL.
      let finalMediaUrl: string | null = gifToSend;

      if (gifToSend) {
        // nothing to upload
      } else if (docToUpload) {
        const fileName = `${user.id}/docs/${Date.now()}_${docToUpload.name}`;
        const { error: uploadError } = await supabase.storage.from('chat-docs').upload(fileName, docToUpload);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('chat-docs').getPublicUrl(fileName);
        finalMediaUrl = urlData.publicUrl;
      } else if (fileToUpload) {
        finalMediaUrl = await uploadImage(fileToUpload);
        if (!finalMediaUrl) throw new Error("Image upload failed");
      } else if (voiceToUpload) {
        const fileName = `${user.id}/${Date.now()}.wav`;
        const { error: uploadError } = await supabase.storage.from('voice-notes').upload(fileName, voiceToUpload);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('voice-notes').getPublicUrl(fileName);
        finalMediaUrl = urlData.publicUrl;
      } else if (videoToUpload) {
        const fileName = `${user.id}/videos/${Date.now()}_${(videoToUpload as any).name || 'video.mp4'}`;
        const { error: uploadError } = await supabase.storage.from('chat-media').upload(fileName, videoToUpload);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(fileName);
        finalMediaUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from("messages").insert({
        id: tempId,
        chat_id: chatInfo.id,
        sender_id: user.id,
        content: messageContent || (docToUpload ? docToUpload.name : (voiceToUpload ? "Voice Note" : null)),
        type: messageType,
        media_url: finalMediaUrl,
        reply_to_id: replyToId,
        delivery_status: 'sent'
      });

      if (error) throw error;

      await localDB.messages.update(tempId, { delivery_status: 'sent', media_url: finalMediaUrl });
      // Flattened to match what LocalChat / ChatList actually reads — the previous
      // version wrote a nested `otherUser` object here instead, which silently
      // wiped out avatar_url/other_user_* on this chat's cached list entry
      // every time a message was sent.
      // Store the raw content + type/id; the chat-list preview turns the type
      // into a label (📷 Photo / GIF / 🎤 Voice message / …) via
      // formatMessagePreview, so no need to bake a "Media" string here.
      await localDB.chats.update(chatInfo.id, {
        last_message_content: docToUpload ? docToUpload.name : (messageContent || null),
        last_message_time: new Date().toISOString(),
        last_message_type: messageType,
        last_message_is_deleted: false,
        last_message_id: tempId,
      });

      setAudioBlob(null);
      setRecordedAudioUrl(null);
      setRecordingDuration(0);
    } catch (error) {
      // Whether this failed because the connection just dropped mid-send, or
      // for a real reason, queue it — the outbox will keep retrying
      // automatically, and the user can also tap it to retry manually.
      await queueForLater(error);
    }
  }, [newMessage, selectedFile, audioBlob, selectedVideo, selectedDoc, selectedGif, user, chatInfo, videoPreview, recordedAudioUrl, imagePreview, editingMessage, replyingTo, showError]);

   useEffect(() => {
  // Ensure subscription definitions stay completely unconditional
    if (!chatInfo?.id) return;

    loadMessages();
    markMessagesAsRead();
    const messageUnsubscribe = subscribeToMessages();
    const typingUnsubscribe = subscribeToTyping();
    const reactionsUnsubscribe = subscribeToReactions();

    // Merge messages the app-wide sync writes to localDB into this open chat —
    // covers messages that arrived just BEFORE the chat was opened (which the
    // chat's own realtime subscription can't replay), with no network refetch.
    const storeUnsubscribe = onMessageStored(chatInfo.id, (msg: any) => {
      if (loadHiddenMessageIds().has(msg.id)) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        if (idx !== -1) {
          // Existing message → merge changed fields (keep the cached profiles
          // join if the incoming update payload doesn't carry it).
          const next = [...prev];
          next[idx] = { ...next[idx], ...msg, profiles: msg.profiles ?? next[idx].profiles };
          return next;
        }
        // New message → append (it's the newest).
        return [...prev, msg as MessageType];
      });
    });

    return () => {
      if (messageUnsubscribe) messageUnsubscribe();
      if (typingUnsubscribe) typingUnsubscribe();
      if (reactionsUnsubscribe) reactionsUnsubscribe();
      storeUnsubscribe();
    };
  }, [chatInfo?.id, chatInfo?.otherUser?.id]);

  // Reconnect catch-up for the OPEN chat. Supabase realtime does NOT replay
  // messages missed during a disconnect, so when the connection returns we
  // reconcile the recent window — picking up messages sent, edited, or deleted
  // while we were offline — merged into the current list (older paginated
  // messages and unsent optimistic ones preserved) without disturbing scroll.
  useEffect(() => {
    if (!chatInfo?.id) return;
    const chatId = chatInfo.id;

    const reconcile = async () => {
      if (!navigator.onLine) return;
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*, profiles(display_name, avatar_url, username)')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_PAGE_SIZE);
        if (error || !data) return;

        const hidden = loadHiddenMessageIds();
        const recent = ([...data].reverse() as unknown as MessageType[]).filter((m) => !hidden.has(m.id));
        if (recent.length === 0) return;

        await localDB.messages.bulkPut(recent);
        setMessages((prev) => {
          const map = new Map(prev.map((m) => [m.id, m]));
          for (const m of recent) map.set(m.id, { ...map.get(m.id), ...m });
          return Array.from(map.values()).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
        loadAllReactions(recent);
        markMessagesAsRead();
      } catch (err) {
        console.error('Reconnect reconcile failed:', err);
      }
    };

    window.addEventListener('online', reconcile);
    return () => window.removeEventListener('online', reconcile);
  }, [chatInfo?.id, loadAllReactions]);

  // Live-update message bubbles when the offline outbox resolves one of
  // this chat's queued sends (e.g. connection comes back while this
  // ChatWindow happens to be open).
  useEffect(() => {
    if (!chatInfo?.id) return;

    const unsubscribe = subscribeToSyncEvents(chatInfo.id, (result) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== result.id) return m;
        if (result.status === 'sent') {
          return { ...m, delivery_status: 'sent', media_url: result.media_url };
        }
        if (result.status === 'failed' && result.permanent) {
          return { ...m, delivery_status: 'failed' };
        }
        return m; // transient failure — outbox will keep retrying automatically
      }));
    });

    return unsubscribe;
  }, [chatInfo?.id]);

  const handleRetryMessage = useCallback(async (messageId: string) => {
    // Optimistically show it as sending again while we retry.
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, delivery_status: 'sending' } : m)));

    const result = await retryPendingMessage(messageId);

    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      if (result.status === 'sent') return { ...m, delivery_status: 'sent', media_url: result.media_url };
      // Not permanent yet (e.g. still offline) — fall back to 'pending' rather
      // than 'failed', so it's clear this will keep auto-retrying.
      return { ...m, delivery_status: result.permanent ? 'failed' : 'pending' };
    }));
  }, []);

  // Stable delete handler — child passes its own id instead of inline arrow
  // Soft delete: Message.handleDelete already writes is_deleted=true to both
  // Supabase and the local cache. This handler's only job is to reflect that
  // in THIS window's in-memory state immediately, so the deleting user sees
  // the "This message was deleted" tombstone without waiting on the realtime
  // round trip. The other person gets it via the UPDATE subscription above
  // (UPDATE events carry the full new row, is_deleted included) — which is
  // exactly what the old hard DELETE couldn't do, since there's no DELETE
  // listener and delete events don't propagate here.
  const handleDeleteMessage = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, is_deleted: true } : m))
    );
  }, []);

  // "Delete for me" — remove the bubble on this device only. Nothing is
  // written to Supabase, so the other person keeps seeing the message
  // untouched. Persisted to the local hidden list so it doesn't come back on
  // the next load, and dropped from the local cache too.
  const handleHideMessage = useCallback(async (messageId: string) => {
    hideMessageLocally(messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      await localDB.messages.delete(messageId);
    } catch (err) {
      console.warn('Failed to drop hidden message from local cache:', err);
    }

    // If the hidden message was this chat's last one, the chat-list preview
    // would otherwise keep showing it. Recompute the cached preview from the
    // remaining visible messages (falling back to the previous one) and poke
    // the list to refresh.
    if (chatInfo?.id) {
      try {
        const hidden = loadHiddenMessageIds();
        const local = await localDB.messages.where('chat_id').equals(chatInfo.id).sortBy('created_at');
        const visible = local.filter((m) => !hidden.has(m.id));
        const newLast = visible[visible.length - 1];
        await localDB.chats.update(chatInfo.id, {
          last_message_content: newLast?.content ?? null,
          last_message_time: newLast?.created_at,
          last_message_type: newLast?.type ?? null,
          last_message_is_deleted: newLast?.is_deleted ?? false,
          last_message_id: newLast?.id,
        });
      } catch (err) {
        console.warn('Failed to recompute chat preview after hide:', err);
      }
    }
    requestChatListRefresh();
  }, [chatInfo?.id]);

  // Enter edit mode: load the message's text into the composer and open the
  // keyboard. The actual save happens in handleSendMessage (the edit branch),
  // so editing reuses the exact same composer + SweetKeyboard as sending.
  const handleEditMessage = useCallback((messageId: string, content: string) => {
    setEditingMessage({ id: messageId });
    setNewMessage(content);
    setShowSweetKeyboard(true);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingMessage(null);
    setNewMessage('');
  }, []);

  // Reply: remember which message we're replying to and open the composer.
  // Editing and replying are mutually exclusive, so starting a reply cancels
  // any in-progress edit.
  const handleReply = useCallback((message: MessageType) => {
    setEditingMessage(null);
    setReplyingTo(message);
    setShowSweetKeyboard(true);
  }, []);

  // Opens the shared gallery viewer scoped to every image/gif in this chat
  // (in message order), starting at whichever one was tapped — same
  // prev/next browsing as the profile photo viewer.
  const handleViewMedia = useCallback((messageId: string) => {
    const mediaMessages = messages.filter((m) => (m.type === 'image' || m.type === 'gif') && m.media_url);
    const index = mediaMessages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    setMediaViewer({ urls: mediaMessages.map((m) => m.media_url as string), index });
  }, [messages]);

  // Throttled typing broadcast — fires at most once per 2500ms
  const handleTyping = useCallback(async () => {
    if (!user || !chatInfo?.id) return;
    const now = Date.now();
    if (now - lastTypingBroadcast.current < 2500) return;
    lastTypingBroadcast.current = now;
    await supabase.channel(`typing:${chatInfo.id}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: user.id },
    });
  }, [user, chatInfo?.id]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Fetch the page of 60 messages immediately older than the ones currently
  // loaded, and prepend them. Local cache first (instant/offline), then the
  // server fills any gap. Returns whether anything new was added.
  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    if (!chatInfo?.id || loadingOlderRef.current || !hasMoreOlderRef.current) return false;
    const current = messagesRef.current;
    const oldest = current[0];
    if (!oldest) return false;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const hidden = loadHiddenMessageIds();
    const existingIds = new Set(current.map((m) => m.id));

    try {
      // Local cache: the 60 messages just before the current oldest.
      const local = await localDB.messages.where('chat_id').equals(chatInfo.id).sortBy('created_at');
      const olderLocal = local.filter((m) => new Date(m.created_at) < new Date(oldest.created_at));
      let olderPage = olderLocal.slice(-MESSAGE_PAGE_SIZE);

      // Server is authoritative — fetch the same window and prefer it when online.
      let reachedStart = false;
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('messages')
          .select('*, profiles(display_name, avatar_url, username)')
          .eq('chat_id', chatInfo.id)
          .lt('created_at', oldest.created_at)
          .order('created_at', { ascending: false })
          .limit(MESSAGE_PAGE_SIZE);
        if (!error && data) {
          olderPage = [...data].reverse() as unknown as MessageType[];
          await localDB.messages.bulkPut(olderPage);
          reachedStart = data.length < MESSAGE_PAGE_SIZE;
        }
      } else {
        reachedStart = olderLocal.length <= MESSAGE_PAGE_SIZE;
      }

      const fresh = olderPage.filter((m) => !existingIds.has(m.id) && !hidden.has(m.id));
      if (fresh.length === 0) {
        hasMoreOlderRef.current = false;
        return false;
      }

      // Anchor the viewport so prepending doesn't jump the scroll position.
      const container = messagesContainerRef.current;
      prevScrollHeightRef.current = container ? container.scrollHeight : 0;
      justPrependedRef.current = true;

      setMessages((prev) => [...fresh, ...prev]);
      loadAllReactions(fresh);

      if (reachedStart) {
        hasMoreOlderRef.current = false;
      }
      return true;
    } catch (err) {
      console.error('Failed to load older messages:', err);
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatInfo?.id, loadAllReactions]);

  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    // Ignore our own programmatic scrolls (pin/center) — only react to the user.
    if (isAutoScrollingRef.current) return;
    const el = e.currentTarget;
    // A real user scroll releases the unread anchor (they've taken over).
    openUnreadAnchorRef.current = null;
    // Track "am I at the bottom?" so late content-growth (image loads) and new
    // messages only auto-scroll when the user actually wants to follow along.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 100;

    if (el.scrollTop < 120 && hasMoreOlderRef.current && !loadingOlderRef.current) {
      loadOlderMessages();
    }
  }, [loadOlderMessages]);

  // Scroll to a specific message, briefly highlighting it. If it isn't loaded
  // yet (older than the current window), keep pulling older pages until it
  // shows up, then scroll.
  const jumpToMessage = useCallback(async (messageId: string) => {
    const scrollTo = () => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedMessageId(messageId);
        setTimeout(() => setHighlightedMessageId((cur) => (cur === messageId ? null : cur)), 2000);
      }
    };

    if (messagesRef.current.some((m) => m.id === messageId)) {
      scrollTo();
      return;
    }

    // Not loaded — page backwards until we find it (or run out).
    let guard = 0;
    while (guard++ < 30 && hasMoreOlderRef.current && !messagesRef.current.some((m) => m.id === messageId)) {
      const added = await loadOlderMessages();
      if (!added) break;
    }
    // Let the prepended rows paint before scrolling to one of them.
    setTimeout(scrollTo, 50);
  }, [loadOlderMessages]);

  // Resolve the parent of any reply whose parent isn't in the loaded window,
  // so the quote still renders. Local cache first, then the server.
  useEffect(() => {
    const loadedIds = new Set(messages.map((m) => m.id));
    const missing = Array.from(
      new Set(
        messages
          .map((m) => m.reply_to_id)
          .filter((rid): rid is string => !!rid && !loadedIds.has(rid) && !replyParents[rid])
      )
    );
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const resolved: Record<string, MessageType> = {};

      const cached = await localDB.messages.bulkGet(missing);
      cached.forEach((m) => { if (m) resolved[m.id] = m as MessageType; });

      const stillMissing = missing.filter((id) => !resolved[id]);
      if (stillMissing.length > 0 && navigator.onLine) {
        const { data } = await supabase
          .from('messages')
          .select('*, profiles(display_name, avatar_url, username)')
          .in('id', stillMissing);
        (data as unknown as MessageType[] | null)?.forEach((m) => { resolved[m.id] = m; });
      }

      if (!cancelled && Object.keys(resolved).length > 0) {
        setReplyParents((prev) => ({ ...prev, ...resolved }));
      }
    })();

    return () => { cancelled = true; };
  }, [messages, replyParents]);

  function getThemeGradient() {
    if (!chatInfo) return 'from-[#FF69B4] to-[#FFC0CB]';
    switch (chatInfo.theme) {
      case 'love': return 'from-[#FF69B4] to-[#FFC0CB]';
      case 'best_friend': return 'from-[#FF1493] to-[#FF69B4]';
      case 'friend': return 'from-[#FF8FAB] to-[#FFC0CB]';
      default: return 'from-[#FF69B4] to-[#FFC0CB]';
    }
  }

  const handleMicClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isRecording) stopRecording(); else startRecording();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      setRecordingDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);

      mediaRecorder.current.ondataavailable = (e) => audioChunks.current.push(e.data);
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: 'audio/wav' });
        setAudioBlob(blob);
        setRecordedAudioUrl(URL.createObjectURL(blob));
      };

      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic Error:", err);
      showError("Microphone access denied. Please allow microphone access from settings!");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      const stream = mediaRecorder.current.stream;
      mediaRecorder.current.stop();
      stream.getTracks().forEach(track => { track.stop(); track.enabled = false; });
    }
    setIsRecording(false);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleConfirmLocation = (lat: number, lng: number) => {
    const mapUrl = `https://maps.google.com/?q=${lat},${lng}`;
    const messageText = `📍 My Location: ${mapUrl}`;
    setNewMessage(messageText);
    setShowLocationPicker(false);
    setTimeout(() => handleSendMessage(new Event('submit') as any), 100);
  };

  const shareLocation = () => setShowLocationPicker(true);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedDoc(file);
    event.target.value = '';
  };

  // Stable keyboard input handler
  const handleKeyboardInput = useCallback((input: any) => {
    if (typeof input === 'string' && input.startsWith('REPLACE_WORD:')) {
      const suggestedWord = input.split(':')[1];
      setNewMessage((prev) => {
        const words = prev.endsWith(' ') ? prev.split(' ') : prev.trim().split(' ');
        words.pop();
        return [...words, suggestedWord].join(' ') + ' ';
      });
      return;
    }
    if (input === 'LOCATION_START') { shareLocation(); return; }
    if (input === 'VIDEO_START') { setIsRecordingVideoNote(true); return; }
    if (typeof input === 'string' && input.startsWith('GIF_SELECT:')) {
      setSelectedGif(input.slice('GIF_SELECT:'.length));
      return;
    }
    if (input instanceof Blob || input instanceof File) {
      if (input.type.includes('video')) {
        setSelectedVideo(input);
        setVideoPreview(URL.createObjectURL(input));
      } else {
        setSelectedFile(input as File);
        const reader = new FileReader();
        reader.onloadend = () => setImagePreview(reader.result as string);
        reader.readAsDataURL(input);
      }
      return;
    }
    setNewMessage(prev => prev + input);
    handleTyping();
  }, [handleTyping]);

  const handleKeyboardDelete = useCallback(() => {
    setNewMessage(prev => prev.slice(0, -1));
  }, []);

  const handleKeyboardSend = useCallback(() => {
    handleSendMessage(new Event('submit') as any);
  }, [handleSendMessage]);

  // The virtual keyboard writes into newMessage via pure state updates, never
  // real keystroke events — so the textarea's native caret has nothing to
  // track from and stops rendering/blinking. Re-focusing and explicitly
  // placing the selection at the end after every change keeps it genuinely
  // synced and visible, the same way it would after a real keypress.
  useEffect(() => {
    if (showSweetKeyboard && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(newMessage.length, newMessage.length);
    }
  }, [newMessage, showSweetKeyboard]);

  // Single source of truth for the textarea's height, driven off the actual
  // message content rather than duplicated in every place that can change it
  // (typing, virtual keyboard input/delete, clearing). Runs after React has
  // committed the new value to the DOM, so scrollHeight is always accurate —
  // unlike measuring it synchronously right after a setState call, which
  // would still see the pre-update value.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const fullHeight = el.scrollHeight;
    el.style.height = `${Math.min(fullHeight, TEXTAREA_MAX_HEIGHT)}px`;
    setIsTextareaOverflowing(fullHeight > TEXTAREA_MAX_HEIGHT);
  }, [newMessage]);

  if (loading || !chatInfo) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${
      theme === 'dark'
        ? 'bg-gray-900 text-white'
        : theme === 'sweet'
          ? 'bg-[#FFE4E1] text-[#4B004B]'
          : 'bg-white text-gray-900'
    }`}>

      {showLocationPicker && (
        <LocationPicker
          onCancel={() => setShowLocationPicker(false)}
          onSelect={handleConfirmLocation}
        />
      )}

      {isRecordingVideoNote && (
        <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="relative flex flex-col items-center justify-center w-full max-w-lg">
            <div className="relative w-80 h-80 md:w-[500px] md:h-[500px] flex items-center justify-center overflow-hidden">
              <video
                id="full-screen-video"
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
                style={{
                  clipPath: 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")',
                  transform: 'scale(20)',
                }}
              />
              <div
                className="absolute inset-0 pointer-events-none bg-gradient-to-t from-pink-500/20 to-transparent"
                style={{
                  clipPath: 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")',
                  transform: 'scale(20.2)',
                }}
              />
            </div>
            <div className="mt-12 flex items-center gap-10">
              <button
                type="button"
                onClick={() => setIsRecordingVideoNote(false)}
                className="p-4 bg-white/10 hover:bg-white/20 rounded-full text-white border border-white/20"
              >
                <X className="w-8 h-8" />
              </button>
              <button
                type="button"
                className="p-8 bg-pink-500 hover:bg-pink-600 rounded-full text-white shadow-[0_0_30px_rgba(236,72,153,0.5)] animate-pulse"
                onClick={() => {
                  if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    mediaRecorderRef.current.stop();
                  }
                  setIsRecordingVideoNote(false);
                }}
              >
                <Check className="w-10 h-10" />
              </button>
            </div>
            <p className="text-pink-400 font-bold mt-8 tracking-widest text-xs uppercase">
              Recording your heart...
            </p>
          </div>
        </div>
      )}

      <div className={`px-4 md:px-6 py-3 md:py-4 border-b ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200'} bg-gradient-to-r ${getThemeGradient()} shadow-sm z-10`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={onBack}
              className="md:hidden p-2 -ml-2 hover:bg-white/20 rounded-full text-white transition-colors active:scale-90"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            {chatInfo.type === 'direct' && chatInfo.otherUser ? (
              <button
                onClick={() => setShowProfileView(true)}
                className="flex items-center gap-2 md:gap-3 min-w-0 text-left rounded-xl hover:bg-white/10 transition-colors px-1 -mx-1 py-1"
              >
                <div className="relative">
                  {chatInfo.otherUser.avatar_url ? (
                    <img
                      src={chatInfo.otherUser.avatar_url}
                      alt={chatInfo.otherUser.display_name}
                      className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover border-2 border-white/50"
                    />
                  ) : (
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-medium border-2 border-white/50">
                      {chatInfo.otherUser.display_name[0]}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base md:text-lg font-bold text-white truncate max-w-[150px] md:max-w-none">
                    {chatInfo.otherUser.display_name}
                  </h2>
                  <p className="text-[10px] text-white/80 font-bold uppercase tracking-widest mt-0.5">
                    {isUserOnline(chatInfo.otherUser.id) ? (
                      <span className="flex items-center gap-1 normal-case font-bold text-green-300">
                        <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" />
                        online
                      </span>
                    ) : (
                      formatLastSeen(chatInfo.otherUser.last_seen)
                    )}
                  </p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white border-2 border-white">
                  👥
                </div>
                <div>
                  <h2 className="text-base md:text-lg font-bold text-white">{chatInfo.name}</h2>
                  <p className="text-[10px] text-white/80 uppercase tracking-widest font-bold">Group chat</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={() => handleInitiateCall('audio')}
              className="flex p-2 hover:bg-white/20 backdrop-blur-sm rounded-full transition-colors">
              <Phone className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={() => handleInitiateCall('video')}
              className="flex p-2 hover:bg-white/20 backdrop-blur-sm rounded-full transition-colors">
              <Video className="w-5 h-5 text-white" />
            </button>
            <ChatMenu chatId={chatInfo.id} onClose={() => { }} theme={theme} onViewProfile={() => setShowProfileView(true)} />
          </div>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        // Every avatar/image/gif that finishes loading grows the content; while
        // we're meant to be pinned to the bottom, re-pin so that growth doesn't
        // strand the view up top. (load doesn't bubble, so we capture it.)
        onLoadCapture={() => {
          if (justPrependedRef.current) return;
          // While anchoring an unread divider on open, keep it centered as
          // images load; otherwise keep pinned to the bottom if sticking.
          if (openUnreadAnchorRef.current) centerOnUnread();
          else if (stickToBottomRef.current) pinToBottom();
        }}
        onClick={() => setShowSweetKeyboard(false)}
        className={`relative flex-1 overflow-y-auto p-4 md:p-6 space-y-4 transition-colors duration-300 overscroll-behavior-y-contain ${
          theme === 'dark' ? 'bg-gray-900' : theme === 'sweet' ? 'bg-[#FFE4E1]/30' : 'bg-gray-50'
        }`}
      >
        {/* Absolute so it never changes scrollHeight — otherwise showing/hiding
            it would shift the anchored scroll position when a page loads. */}
        {loadingOlder && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-white/80 dark:bg-gray-800/80 rounded-full p-1.5 shadow-sm">
            <div className="w-5 h-5 border-2 border-pink-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {messages.map((message, index) => {
          const showAvatar = index === 0 || messages[index - 1].sender_id !== message.sender_id;
          const msgDate = new Date(message.created_at).toDateString();
          const prevMsgDate = index > 0 ? new Date(messages[index - 1].created_at).toDateString() : null;
          const showDateSeparator = msgDate !== prevMsgDate;
          const isOwn = message.sender_id === user?.id;
          const isSending = message.delivery_status === 'sending';
          const isPending = message.delivery_status === 'pending';
          const isFailed = message.delivery_status === 'failed';
          const reactionState = messageReactions[message.id];
          // The message this one replies to — from the loaded window, or the
          // on-demand-fetched parents map when it's older than the window.
          const repliedTo = message.reply_to_id
            ? (messages.find((m) => m.id === message.reply_to_id) || replyParents[message.reply_to_id])
            : undefined;

          return (
            <div
              key={message.id}
              id={`msg-${message.id}`}
              className={`group rounded-2xl transition-colors duration-500 ${
                highlightedMessageId === message.id ? 'bg-pink-300/30' : ''
              }`}
            >
              <Message
                message={message}
                isOwn={isOwn}
                showAvatar={showAvatar}
                showDateSeparator={showDateSeparator}
                reactions={REACTIONS_EMOJIS as unknown as string[]}
                theme={theme}
                onDelete={handleDeleteMessage}
                onHide={handleHideMessage}
                onEdit={handleEditMessage}
                onReply={(m) => handleReply(m as MessageType)}
                repliedTo={repliedTo}
                onJumpToReplied={jumpToMessage}
                showUnreadDivider={message.id === unreadDividerId}
                currentUserId={user?.id}
                onViewMedia={handleViewMedia}
                initialDbReactions={reactionState?.reactions ?? EMPTY_REACTIONS}
                initialUserMap={reactionState?.userMap ?? EMPTY_USER_MAP}
              />

              {isOwn && (
                <div className="flex flex-col items-end gap-1 mt-1 px-4">
                  {isSending && (
                    <div className={`flex items-center gap-1 text-[10px] ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-500'}`}>
                      <div className={`w-2.5 h-2.5 border-2 border-t-transparent rounded-full animate-spin ${theme === 'sweet' ? 'border-[#FF69B4]' : 'border-gray-400'}`} />
                      <span>Sending...</span>
                    </div>
                  )}
                  {isPending && (
                    <div className={`flex items-center gap-1 text-[10px] ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${theme === 'sweet' ? 'bg-[#FF69B4]' : 'bg-gray-400'}`} />
                      <span>Waiting to reconnect...</span>
                    </div>
                  )}
                  {isFailed && (
                    <button
                      onClick={() => handleRetryMessage(message.id)}
                      className="flex items-center gap-1 text-[10px] text-red-600 font-bold"
                    >
                      <AlertCircle className="w-3 h-3" />
                      <span>Failed - Tap to retry</span>
                    </button>
                  )}
                  {!isSending && !isPending && !isFailed && (
                    <div className={`flex items-center gap-1 text-xs transition-colors ${
                      theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {message.delivery_status === 'read' ? (
                        <div className="flex items-center">
                          <Check className={`w-3 h-3 ${theme === 'sweet' ? 'text-[#FF1493]' : 'text-blue-500'}`} />
                          <Check className={`w-3 h-3 -ml-1.5 ${theme === 'sweet' ? 'text-[#FF1493]' : 'text-blue-500'}`} />
                        </div>
                      ) : (
                        message.delivery_status === 'sent' && <Check className="w-3 h-3 opacity-60" />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {isOtherTyping && (
          <div className={`flex items-center gap-2 p-2 ml-4 mb-2 animate-in fade-in slide-in-from-left-2 duration-300 ${
            theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-500 dark:text-gray-400'
          }`}>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-current opacity-60 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 bg-current opacity-100 rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
            <span className="text-xs italic font-semibold">{chatInfo.otherUser?.display_name} is typing...</span>
          </div>
        )}
        <div ref={messagesEndRef} className="h-2" />
      </div>

      <div className={`p-3 md:p-4 border-t transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-800 border-gray-700' : theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white border-gray-200'
      }`}>
        {selectedDoc && (
          <div className="p-2 mb-2 bg-white/40 backdrop-blur-md rounded-2xl flex items-center gap-3 border border-pink-200 animate-in fade-in slide-in-from-bottom-2">
            <div className="p-3 bg-pink-500 rounded-xl text-white">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-[11px] font-bold text-pink-700 truncate">{selectedDoc.name}</p>
              <p className="text-[9px] text-pink-400">{(selectedDoc.size / 1024).toFixed(1)} KB • Ready to send</p>
            </div>
            <button onClick={() => setSelectedDoc(null)} className="p-1 hover:bg-pink-100 rounded-full text-pink-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {selectedGif && (
          <div className="relative inline-block mb-3 animate-in zoom-in-95 duration-200">
            <div className="relative rounded-2xl overflow-hidden border-2 border-pink-400 shadow-lg bg-black/5">
              <img src={selectedGif} alt="GIF preview" className="max-h-32 w-auto object-cover" />
              <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 rounded-md text-white text-[9px] font-black uppercase tracking-widest">
                Gif
              </span>
              <button
                type="button"
                onClick={() => setSelectedGif(null)}
                className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {imagePreview && (
          <div className="relative inline-block mb-3 animate-in zoom-in-95 duration-200">
            <div className="relative rounded-2xl overflow-hidden border-2 border-pink-400 shadow-lg">
              <img src={imagePreview} alt="Preview" className="max-h-32 w-auto object-cover" />
              <button
                onClick={() => { setImagePreview(null); setSelectedFile(null); }}
                className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {videoPreview && (
          <div className="relative inline-block mb-3 animate-in zoom-in-95 group">
            <div className="relative rounded-2xl overflow-hidden border-2 border-pink-400 shadow-lg w-32 h-32 bg-black">
              <video src={videoPreview} className="w-full h-full object-cover" autoPlay loop muted />
              <button
                type="button"
                onClick={() => { setVideoPreview(null); setSelectedVideo(null); }}
                className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {editingMessage && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-2xl bg-pink-50 border border-pink-200 animate-in fade-in slide-in-from-bottom-2">
            <Pencil className="w-4 h-4 text-pink-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-pink-600 uppercase tracking-widest">Editing message</p>
              <p className="text-[11px] text-pink-400 truncate">Make your changes and send</p>
            </div>
            <button
              type="button"
              onClick={cancelEditing}
              className="p-1.5 rounded-full text-pink-400 hover:bg-pink-100 hover:text-pink-600 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {replyingTo && !editingMessage && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-2xl bg-pink-50 border-l-4 border border-pink-200 border-l-pink-400 animate-in fade-in slide-in-from-bottom-2">
            <Reply className="w-4 h-4 text-pink-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-pink-600 uppercase tracking-widest truncate">
                Replying to {replyingTo.sender_id === user?.id ? 'yourself' : (replyingTo.profiles?.display_name || 'them')}
              </p>
              <p className="text-[11px] text-pink-400 truncate">
                {formatMessagePreview({ content: replyingTo.content, type: replyingTo.type, is_deleted: replyingTo.is_deleted })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="p-1.5 rounded-full text-pink-400 hover:bg-pink-100 hover:text-pink-600 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSendMessage} className="flex items-end gap-2 max-w-6xl mx-auto relative">
          <input
            type="file"
            id="imageInput"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setSelectedFile(file);
                const reader = new FileReader();
                reader.onloadend = () => setImagePreview(reader.result as string);
                reader.readAsDataURL(file);
              }
            }}
          />

          <div className="flex items-center mb-1">
            <div className="relative" />
          </div>

          <div className="flex-1 min-w-0 relative flex items-end">
            {isRecording ? (
              <div className="flex-1 flex items-center justify-between px-4 h-12 rounded-2xl relative bg-gradient-to-r from-[#FFE4E1] to-[#FFC0CB] border border-[#FFB6C1] shadow-inner overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                <div className="flex items-center gap-3 z-10">
                  <div className="relative flex items-center justify-center">
                    <span className="text-2xl animate-heartbeat inline-block drop-shadow-sm">❤️</span>
                    <span className="absolute -top-1 -right-2 animate-sparkle text-[12px] text-yellow-400">✨</span>
                    <span className="absolute -bottom-1 -right-4 animate-sparkle text-[10px] text-yellow-200" style={{ animationDelay: '0.7s' }}>✨</span>
                    <span className="absolute top-2 -right-6 animate-sparkle text-[8px] text-pink-400" style={{ animationDelay: '1.2s' }}>✨</span>
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-bold text-[#4B004B] animate-pulse">Listening to your heart...</span>
                    <span className="text-[10px] text-[#8B004B] italic opacity-80">recording a sweet note</span>
                  </div>
                </div>
                <div className="font-mono text-sm font-bold text-[#8B004B] z-10 bg-white/70 px-3 py-1 rounded-full shadow-sm border border-white/50">
                  {formatDuration(recordingDuration)}
                </div>
              </div>
            ) : recordedAudioUrl ? (
              <div className="flex-1 flex items-center gap-2 px-2 h-12 rounded-2xl border-2 overflow-hidden animate-in slide-in-from-left-2 duration-300"
                style={{ backgroundColor: '#FFE4E1', borderColor: '#FFB6C1' }}>
                <button
                  type="button"
                  onClick={() => { setRecordedAudioUrl(null); setAudioBlob(null); }}
                  className="p-1.5 hover:bg-white/50 rounded-full transition-all hover:rotate-90 text-[#FF4500]"
                >
                  <X className="w-5 h-5" />
                </button>
                <audio src={recordedAudioUrl} controls className="flex-1 h-8 scale-95" />
              </div>
            ) : (
              <>
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  inputMode="none"
                  onFocus={() => setShowSweetKeyboard(true)}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    handleTyping();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                  placeholder="Spread love..."
                  rows={1}
                  className={`w-full pl-4 py-2.5 border rounded-2xl focus:outline-none focus:ring-2 resize-none transition-all
                    ${isTextareaOverflowing ? 'pr-5 overflow-y-auto' : 'pr-4 overflow-y-hidden scrollbar-hide'}
                    ${theme === 'sweet' ? 'bg-white border-[#FFB6C1] text-[#4B004B] caret-[#FF69B4] focus:ring-[#FF69B4]' : 'bg-gray-50 border-gray-300 caret-current focus:ring-pink-400'}`}
                  style={{ maxHeight: `${TEXTAREA_MAX_HEIGHT}px`, minHeight: '44px', lineHeight: '1.5', fontSize: '16px' }}
                />
                {newMessage.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setNewMessage('')}
                    className={`absolute -top-2 -right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-white shadow-sm transition-colors ${
                      theme === 'sweet'
                        ? 'border-2 border-[#FF69B4] text-[#FF69B4] hover:bg-pink-50'
                        : 'border-2 border-pink-400 text-pink-400 hover:bg-pink-50'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 mb-0.5">
            {/* Hide the voice button once the user starts typing — the textarea
                (flex-1) then expands into the freed space. Kept while recording
                so it doubles as the stop button. */}
            {(isRecording || !newMessage.trim()) && (
              <button
                type="button"
                onClick={handleMicClick}
                className={`p-3 rounded-full transition-all flex-shrink-0 relative ${
                  isRecording
                    ? 'bg-red-500 text-white scale-110 shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                    : theme === 'sweet'
                      ? 'text-[#FF69B4] hover:text-[#FF1493] bg-[#FFE4E1]'
                      : 'text-gray-400 hover:text-pink-500 bg-gray-100'
                }`}
              >
                {isRecording ? (
                  <div className="w-5 h-5 bg-white rounded-sm animate-pulse" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
                {isRecording && (
                  <span className="absolute inset-0 rounded-full border-4 border-red-500 animate-ping opacity-25"></span>
                )}
              </button>
            )}

            <button
              type="submit"
              disabled={(!newMessage.trim() && !selectedFile && !audioBlob && !selectedDoc && !selectedVideo && !selectedGif) || isRecording}
              className={`p-3 rounded-full transition-all active:scale-95 flex-shrink-0 ${
                (newMessage.trim() || selectedFile || audioBlob || selectedDoc || selectedVideo || selectedGif)
                  ? `bg-gradient-to-r from-[#FF69B4] to-[#FF1493] text-white shadow-md`
                  : theme === 'sweet' ? 'bg-[#FFE4E1] text-[#FF69B4]/60' : 'bg-gray-200 text-gray-400'
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>

      {showSweetKeyboard && (
        <SweetKeyboard
          newMessage={newMessage}
          myGifs={myGifs}
          setMyGifs={setMyGifs}
          onOpenGifPanel={onOpenGifPanel}
          onDocsClick={() => fileInputRef.current?.click()}
          onInput={handleKeyboardInput}
          onDelete={handleKeyboardDelete}
          onSend={handleKeyboardSend}
        />
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.zip,.rar,audio/*"
      />

      {activeCall && chatInfo?.otherUser && (
        <CallOverlay
          type={activeCall.type}
          direction={activeCall.direction}
          userName={chatInfo.otherUser.display_name}
          userAvatar={chatInfo.otherUser.avatar_url}
          theme={theme}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={async () => {
            try {
              await acceptCall();
            } catch (err) {
              console.error('Failed to accept call:', err);
              showError("Couldn't join the call. Check camera/microphone permissions.");
            }
          }}
          onReject={rejectCall}
          onHangUp={hangUp}
        />
      )}

      {showProfileView && chatInfo?.otherUser && (
        <UserProfileView
          userId={chatInfo.otherUser.id}
          theme={theme}
          onClose={() => setShowProfileView(false)}
        />
      )}

      {mediaViewer && (
        <ImageViewerModal
          images={mediaViewer.urls}
          initialIndex={mediaViewer.index}
          onClose={() => setMediaViewer(null)}
        />
      )}
    </div>
  );
}
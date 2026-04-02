import { useState, useEffect, useRef } from 'react';
import { Send, Smile, Paperclip, Phone, Video, Image as ImageIcon, X, Mic, AlertCircle, Check, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Message } from './Message';
import { ChatMenu } from './ChatMenu';
import { SweetKeyboard } from './SweetKeyboard';

interface ChatWindowProps {
  chatId: string;
  theme: 'light' | 'dark' | 'romantic';
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
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'read';
  profiles: {  // Make sure this is an object, not a string
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
  otherUser?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
    last_seen: string;
  };
}

const reactions = ['💖', '🥰', '😍', '💋', '😂'];

export function ChatWindow({ chatId, theme, onBack }: ChatWindowProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [failedMessages, setFailedMessages] = useState<Set<string>>(new Set());
  const [sendingMessages, setSendingMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isOtherUserOnline, setIsOtherUserOnline] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  useEffect(() => {
  if (chatId && user) {
    setLoading(true);
    setChatInfo(null);
    loadChat(); // This runs first to find the real room ID
  }
}, [chatId, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

// Inside ChatWindow.tsx
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
          // Play is vital to see the live feed
          await videoElement.play();
        }
      } catch (err) {
        console.error("Camera access denied:", err);
        alert("Please allow camera and microphone access to record your sweet note! ❤️");
        setIsRecordingVideoNote(false);
      }
    };

    startCamera();
  }

  // CLEANUP: Turns off the camera lens when the heart closes
  return () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };
}, [isRecordingVideoNote]);

  async function loadChat() {
  if (!user || !chatId) return;

  try {
    // 1. Instant check for Saved Messages
    if (chatId === user.id) {
      await supabase.from('chats').upsert({ id: user.id, type: 'direct', name: 'Saved Messages', theme: 'love' });
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

    // 2. Try to find the chat by ID directly
    let { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();

    if (!chat) {
      // Create a UNIQUE room ID by sorting both User IDs alphabetically
      // This ensures that (Ahmad + Hamza) always produces the same string
      const sortedIds = [user.id, chatId].sort(); 
      const consistentRoomId = `${sortedIds[0]}_${sortedIds[1]}`;

      // Now check if THIS consistent ID exists
      let { data: existingChat } = await supabase
        .from('chats')
        .select('*')
        .eq('id', consistentRoomId)
        .maybeSingle();

      if (!existingChat) {
        // Only if it doesn't exist, create it once
        const { data: newChat, error } = await supabase
          .from('chats')
          .insert({ id: consistentRoomId, type: 'direct', updated_at: new Date().toISOString() })
          .select()
          .single();
        
        if (error) return;

        // Add both as participants using the sorted IDs
        await supabase.from('chat_participants').insert([
          { chat_id: consistentRoomId, user_id: sortedIds[0] },
          { chat_id: consistentRoomId, user_id: sortedIds[1] }
        ]);
        
        existingChat = newChat;
      }
      chat = existingChat;
    }

    let chatData: ChatInfo = { id: chat.id, type: chat.type, name: chat.name || 'Chat', theme: chat.theme };

    // Inside loadChat function
// Inside loadChat function
    // Look for this section in loadChat
// 1. Get the other participant's ID first
const { data: participantData, error: partError } = await supabase
  .from('chat_participants')
  .select('user_id') 
  .eq('chat_id', chat.id)
  .neq('user_id', user.id)
  .maybeSingle();

if (partError) console.error("Participant fetch error:", partError);

// 2. If we found a user ID, go grab their profile details
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
      // Keep your logic: Start as false, let Presence Sync take over
      is_online: false, 
      last_seen: profile.last_seen
    };
  }
}

    setChatInfo(chatData);
  } catch (error) {
    console.error('Error in loadChat:', error);
  } finally {
    setLoading(false);
  }
}

  async function loadMessages() {
  if (!chatInfo?.id) return; // Always use the resolved chatInfo ID

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*, profiles(display_name, avatar_url, username)')
      .eq('chat_id', chatInfo.id) // Query using the permanent UUID
      .order('created_at', { ascending: true });

    if (error) throw error;
    setMessages(data || []);
  } catch (error) {
    console.error('Error loading messages:', error);
  }
}

async function markMessagesAsRead() {
  if (!chatInfo?.id || !user) return;

  const { error } = await supabase
    .from('messages')
    .update({ delivery_status: 'read' })
    .eq('chat_id', chatInfo.id)
    .neq('sender_id', user.id) // Only mark messages sent by the OTHER person
    .neq('delivery_status', 'read'); // Only update if not already read

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
          // 1. Fetch the full message WITH profiles to prevent the white screen crash
          const { data, error } = await supabase
            .from('messages')
            .select('*, profiles(display_name, avatar_url, username)')
            .eq('id', payload.new.id)
            .single();

          if (data && !error) {
            const incomingMsg = data as unknown as MessageType;
            
            setMessages((prev) => {
              // 2. Match ID to avoid double-messages (Optimistic UI sync)
              const exists = prev.find(m => m.id === incomingMsg.id);
              if (exists) {
                // Replace temp message with real DB message (adds the blue ticks)
                return prev.map(m => m.id === incomingMsg.id ? incomingMsg : m);
              }
              // Add new message from others
              return [...prev, incomingMsg];
            });

            if (incomingMsg.sender_id !== user?.id) {
              markMessagesAsRead();
            }
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

  function subscribeToTyping() {
  if (!chatInfo?.id) return;

  const channel = supabase
    .channel(`typing:${chatInfo.id}`)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      // Don't show if the typing event is from me
      if (payload.userId !== user?.id) {
        setIsOtherTyping(true);
        
        // Hide after 3 seconds of no activity
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setIsOtherTyping(false);
        }, 3000);
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
    // We'll keep it simple: just an uploads folder
    const filePath = `uploads/${fileName}`; 

    const { error: uploadError } = await supabase.storage
      .from('chat-media') 
      .upload(filePath, file);

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('chat-media')
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (error) {
    console.error('Upload failed:', error);
    return null;
  }
}

  async function handleSendMessage(e: React.FormEvent | React.KeyboardEvent) {
  e.preventDefault();
  
  // 1. New Validation: Allow if there is text OR a selected file
  const messageContent = newMessage.trim();
  if ((!messageContent && !selectedFile && !audioBlob && !selectedVideo) || !user || !chatInfo) return;
  const videoToUpload = selectedVideo; // Grab the video
  const videoUrlPreview = videoPreview;

  const tempId = crypto.randomUUID();

  const fileToUpload = selectedFile;

  const voiceToUpload = audioBlob;

  const voicePreview = recordedAudioUrl;

  // 2. Create the "Optimistic" message object
  const tempMessage: MessageType = {
    id: tempId,
    chat_id: chatInfo.id,
    sender_id: user.id,
    content: voiceToUpload ? "Voice Note" : (messageContent || null),
    // If we have a file, set type to "image", otherwise "text"
    type: videoToUpload ? "video" : voiceToUpload ? "voice" : (fileToUpload ? "image" : "text"),
    // Use the imagePreview (local blob) so it shows up instantly
    media_url: videoToUpload ? videoUrlPreview : voiceToUpload ? voicePreview : imagePreview, 
    reply_to_id: null,
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

  // 3. Update the UI state
  setMessages(prev => [...prev, tempMessage]);

  // 4. Reset the inputs immediately for a clean feel
  setNewMessage("");
  setImagePreview(null);
  setAudioBlob(null);
  setSelectedFile(null);
  setVideoPreview(null);
  setSelectedVideo(null);
  
  if (textareaRef.current) {
    textareaRef.current.style.height = 'auto';
  }
// --- START OF REMAINING PART ---
  try {
    let finalMediaUrl = null;

    // 1. If there was a file, upload it now
    if (fileToUpload) {
      finalMediaUrl = await uploadImage(fileToUpload);
      if (!finalMediaUrl) throw new Error("Image upload failed");
    }

    else if (voiceToUpload) {
      const fileName = `${user.id}/${Date.now()}.wav`;
      const { error: uploadError } = await supabase.storage
        .from('voice-notes')
        .upload(fileName, voiceToUpload);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('voice-notes')
        .getPublicUrl(fileName);
      
      finalMediaUrl = urlData.publicUrl;
    }

    // 2. Insert the message
    const { error } = await supabase.from("messages").insert({
      id: tempId, 
      chat_id: chatInfo.id,
      sender_id: user.id,
      content: voiceToUpload ? "Voice Note" : (messageContent || null),
      type: voiceToUpload ? "voice" : (fileToUpload ? "image" : "text"), 
      media_url: finalMediaUrl,
      delivery_status: 'sent'
    });

    if (error) {
      console.error("Supabase Insert Error:", error.message);
      throw error;
    }

    setAudioBlob(null);
    setRecordedAudioUrl(null);
    setRecordingDuration(0);

  } catch (error) {
    console.error("Send failed:", error);
    setMessages(prev => prev.filter(m => m.id !== tempId));
    alert("Message failed to send. Try again, love!");
  }
}

function subscribeToOnlineStatus() {
  if (!chatInfo?.otherUser?.id || !user) return;

  const otherUserId = chatInfo.otherUser.id;
  
  // We use a specific channel name for this chat room
  const channel = supabase.channel(`presence:${chatInfo.id}`, {
    config: {
      presence: {
        key: user.id,
      },
    },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      
      // Check if the other user's ID exists anywhere in the presence state
      const userIsPresent = Object.values(state)
        .flat()
        .some((presence: any) => presence.user_id === otherUserId);
      
      console.log("Is other user here?", userIsPresent);
      setIsOtherUserOnline(userIsPresent);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // You MUST track yourself for the channel to stay active/synced
        await channel.track({
          user_id: user.id,
          online_at: new Date().toISOString(),
        });
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

useEffect(() => {
  let messageUnsubscribe: (() => void) | undefined;
  let typingUnsubscribe: (() => void) | undefined;
  let onlineStatusUnsubscribe: (() => void) | undefined;

  if (chatInfo?.id) {
    loadMessages();
    markMessagesAsRead();
    
    messageUnsubscribe = subscribeToMessages();
    typingUnsubscribe = subscribeToTyping();
    onlineStatusUnsubscribe = subscribeToOnlineStatus();
  }

  return () => {
    if (messageUnsubscribe) messageUnsubscribe();
    if (typingUnsubscribe) typingUnsubscribe();
    if (onlineStatusUnsubscribe) onlineStatusUnsubscribe();
  };
}, [chatInfo?.id, chatInfo?.otherUser?.id]);

  async function handleRetryMessage(messageId: string) {
    try {
      setSendingMessages(prev => new Set(prev).add(messageId));
      setFailedMessages(prev => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });

      const msg = messages.find(m => m.id === messageId);
      if (!msg) return;

      const { error } = await supabase.from('messages').update({ delivery_status: 'sent' }).eq('id', messageId);
      if (error) throw error;

      setSendingMessages(prev => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
    } catch (error) {
      setFailedMessages(prev => new Set(prev).add(messageId));
      setSendingMessages(prev => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
    }
  }

  async function handleDeleteMessage(messageId: string) {
  try {
    // Option A: Hard Delete (removes from DB)
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('sender_id', user?.id); // Safety: only delete if it's yours

    if (error) throw error;

    // Update local state immediately so it vanishes from screen
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    
  } catch (error) {
    console.error("Error deleting message:", error);
    alert("Could not delete message.");
  }
}

  async function handleTyping() {
  if (!user || !chatInfo?.id) return;

  // This sends a "whisper" through Supabase that doesn't touch the DB
  await supabase.channel(`typing:${chatInfo.id}`).send({
    type: 'broadcast',
    event: 'typing',
    payload: { userId: user.id },
  });
}

useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // When user comes back to the tab, we re-sync presence
      // This forces the "Last seen" to update immediately
      supabase.getChannels().forEach(ch => ch.track({ updated_at: Date.now() }));
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, []);

  function scrollToBottom() { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }

  function getThemeGradient() {
    if (!chatInfo) return 'from-[#FF69B4] to-[#FFC0CB]';
    switch (chatInfo.theme) {
      case 'love': return 'from-[#FF69B4] to-[#FFC0CB]';
      case 'best_friend': return 'from-purple-500 to-pink-500';
      case 'friend': return 'from-blue-500 to-cyan-500';
      default: return 'from-[#FF69B4] to-[#FFC0CB]';
    }
  }

  function formatLastSeen(lastSeen: string) {
    const date = new Date(lastSeen);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  if (loading || !chatInfo) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

const handleMicClick = (e: React.MouseEvent) => {
  e.preventDefault();
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
};

const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder.current = new MediaRecorder(stream);
    audioChunks.current = [];
    
    // Timer Reset
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
    alert("Microphone access denied.");
  }
};

const stopRecording = () => {
  // 1. Kill the timer immediately
  if (timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }

  // 2. STOP HARDWARE (The most important part)
  if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
    // Get the stream from the recorder
    const stream = mediaRecorder.current.stream;
    
    // Stop the recorder itself
    mediaRecorder.current.stop();
    
    // LOOP through all tracks (Mic, etc.) and FORCE them to stop
    stream.getTracks().forEach(track => {
      track.stop();      // Kills the hardware process
      track.enabled = false; // Disables the data flow
    });
  }

  setIsRecording(false);
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${
      theme === 'dark'
        ? 'bg-gray-900 text-white'
        : theme === 'romantic'
        ? 'bg-[#FFE4E1] text-[#4B004B]'
        : 'bg-white text-gray-900'
    }`}>

      {isRecordingVideoNote && (
  <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
    <div className="relative flex flex-col items-center justify-center w-full max-w-lg">
      
      {/* The Heart "Cutout" */}
      <div className="relative w-80 h-80 md:w-[500px] md:h-[500px] flex items-center justify-center overflow-hidden">
        <video 
          id="full-screen-video"
          autoPlay 
          muted 
          playsInline 
          className="w-full h-full object-cover"
          style={{ 
            // This creates the heart shape window
            clipPath: 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")',
            transform: 'scale(20)', // Blows up the tiny 24px path to fill the 500px div
          }}
        />
        
        {/* Decorative Glow Border */}
        <div 
          className="absolute inset-0 pointer-events-none bg-gradient-to-t from-pink-500/20 to-transparent"
          style={{ 
            clipPath: 'path("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z")',
            transform: 'scale(20.2)',
          }}
        />
      </div>

      {/* Control Buttons */}
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
            // Your recording stop logic will go here
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

      {/* HEADER SECTION */}
      <div className={`px-4 md:px-6 py-3 md:py-4 border-b ${theme === 'romantic' ? 'border-[#FFB6C1]' : 'border-gray-200'} bg-gradient-to-r ${getThemeGradient()} shadow-sm z-10`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <button 
              onClick={onBack} 
              className="md:hidden p-2 -ml-2 hover:bg-white/20 rounded-full text-white transition-colors active:scale-90"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            {chatInfo.type === 'direct' && chatInfo.otherUser ? (
              <>
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
                  {isOtherUserOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base md:text-lg font-bold text-white truncate max-w-[150px] md:max-w-none">
                    {chatInfo.otherUser.display_name}
                  </h2>
                  <p className="text-[10px] md:text-xs text-white/80 font-medium">
                    {isOtherUserOnline
                      ? 'Online'
                      : `Last seen ${formatLastSeen(chatInfo.otherUser?.last_seen || new Date().toISOString())}`}
                  </p>
                </div>
              </>
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
            <button className="hidden sm:flex p-2 hover:bg-white/20 backdrop-blur-sm rounded-full transition-colors">
              <Phone className="w-5 h-5 text-white" />
            </button>
            <button className="hidden sm:flex p-2 hover:bg-white/20 backdrop-blur-sm rounded-full transition-colors">
              <Video className="w-5 h-5 text-white" />
            </button>
            <ChatMenu chatId={chatInfo.id} onClose={() => {}} theme={theme}/>
          </div>
        </div>
      </div>

      {/* MESSAGES AREA - WITH FULL LOGIC RESTORED */}
      <div 
      onClick={() => setShowSweetKeyboard(false)}
        className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-4 transition-colors duration-300 scroll-smooth overscroll-behavior-y-contain ${
          theme === 'dark' ? 'bg-gray-900' : theme === 'romantic' ? 'bg-[#FFE4E1]/30' : 'bg-gray-50'
        }`}
      >
        {messages.map((message, index) => {
          const showAvatar = index === 0 || messages[index - 1].sender_id !== message.sender_id;
          const isOwn = message.sender_id === user?.id;
          const isFailed = failedMessages.has(message.id);
          const isSending = sendingMessages.has(message.id);

          return (
            <div key={message.id} className="group">
              <Message
                message={message}
                isOwn={isOwn}
                showAvatar={showAvatar}
                reactions={reactions}
                theme={theme}
                onDelete={() => handleDeleteMessage(message.id)}
              />
              
              {/* RESTORED STATUS INDICATORS (Sending/Failed/Ticks) */}
              {isOwn && (
                <div className="flex flex-col items-end gap-1 mt-1 px-4">
                  {isSending && (
                    <div className="flex items-center gap-1 text-[10px] text-gray-500">
                      <div className="w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      <span>Sending...</span>
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

                  {!isSending && !isFailed && (
                    <div className={`flex items-center gap-1 text-xs transition-colors ${
                      theme === 'romantic' ? 'text-[#8B004B]' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {message.delivery_status === 'read' ? (
                        <div className="flex items-center">
                          <Check className={`w-3 h-3 ${theme === 'romantic' ? 'text-[#FF1493]' : 'text-blue-500'}`} />
                          <Check className={`w-3 h-3 -ml-1.5 ${theme === 'romantic' ? 'text-[#FF1493]' : 'text-blue-500'}`} />
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

        {/* TYPING INDICATOR */}
        {isOtherTyping && (
          <div className={`flex items-center gap-2 p-2 ml-4 mb-2 animate-in fade-in slide-in-from-left-2 duration-300 ${
            theme === 'romantic' ? 'text-[#8B004B]' : 'text-gray-500 dark:text-gray-400'
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

      {/* INPUT AREA */}
      <div className={`p-3 md:p-4 border-t transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-800 border-gray-700' : theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white border-gray-200'
      }`}>

       {imagePreview && (
          <div className="relative inline-block mb-3 animate-in zoom-in-95 duration-200">
            <div className="relative rounded-2xl overflow-hidden border-2 border-pink-400 shadow-lg">
              <img 
                src={imagePreview} 
                alt="Preview" 
                className="max-h-32 w-auto object-cover"
              />
              <button
                onClick={() => {
                  setImagePreview(null);
                  setSelectedFile(null);
                }}
                className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* VIDEO NOTE PREVIEW (The "Typing Box" version) */}
        {videoPreview && (
          <div className="relative inline-block mb-3 animate-in zoom-in-95 group">
            <div className="relative rounded-2xl overflow-hidden border-2 border-pink-400 shadow-lg w-32 h-32 bg-black">
              <video 
                src={videoPreview} 
                className="w-full h-full object-cover" 
                autoPlay 
                loop 
                muted 
              />
              <button
                type="button"
                onClick={() => {
                  setVideoPreview(null);
                  setSelectedVideo(null);
                }}
                className="absolute top-1 right-1 p-1 bg-black/60 rounded-full text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        <form 
          onSubmit={handleSendMessage} 
          className="flex items-end gap-2 max-w-6xl mx-auto relative"
        >
  
  {/* Hidden Image Input */}
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
                reader.onloadend = () => {
                  setImagePreview(reader.result as string);
                };
                reader.readAsDataURL(file);
              }
            }}
          />

          <div className="flex items-center mb-1">
            <button
              type="button"
              onClick={() => document.getElementById('imageInput')?.click()}
              className="p-2 hover:bg-black/5 rounded-full transition-all active:scale-90"
            >
              <ImageIcon className="w-5 h-5 text-gray-500" />
            </button>
            
            <button type="button" className="p-2 hover:bg-black/5 rounded-full hidden sm:block">
              <Paperclip className="w-5 h-5 text-gray-500" />
            </button>
            
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmojiPanel(!showEmojiPanel)}
                className="p-2 hover:bg-black/5 rounded-full"
              >
                <Smile className="w-5 h-5 text-gray-500" />
              </button>
              {showEmojiPanel && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
                  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEmojiPanel(false)} />
                  <div className={`relative w-full max-w-[320px] rounded-2xl shadow-2xl border flex flex-col z-[60] animate-in slide-in-from-bottom-4 duration-200 ${
                    theme === 'romantic' ? 'bg-[#FFE4E1] border-[#FFB6C1]' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                  }`}>
      
      <div className="flex items-center justify-between p-3 border-b border-black/5">
                      <span className="text-xs font-bold uppercase tracking-wider opacity-60">Select Emoji</span>
                      <button 
                        onClick={() => setShowEmojiPanel(false)}
                        className="p-1.5 hover:bg-black/5 rounded-full transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="p-4 grid grid-cols-6 gap-2">
                      {['💖','🥰','😍','💋','❤️','😘','💘','🌹','💞','😂','😭','😢','🔥','👍','🎉','✨','🦋','🧸'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => { 
                            setNewMessage(prev => prev + emoji); 
                          }}
                          className="text-2xl hover:scale-125 transition-transform active:scale-90 p-1"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 relative flex items-center h-12 overflow-hidden">
            {isRecording ? (
              <div className="flex-1 flex items-center justify-between px-4 h-full rounded-2xl relative bg-gradient-to-r from-[#FFE4E1] to-[#FFC0CB] border border-[#FFB6C1] shadow-inner animate-in fade-in zoom-in-95 duration-300">
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
              <div className="flex-1 flex items-center gap-2 px-2 h-full rounded-2xl border-2 animate-in slide-in-from-left-2 duration-300"
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
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                  placeholder="Spread love..."
                  rows={1}
                  className={`w-full pl-4 pr-10 py-2.5 border rounded-2xl focus:outline-none focus:ring-2 resize-none transition-all text-sm md:text-base scrollbar-none md:scrollbar-hidden
                    ${theme === 'romantic' ? 'bg-white border-[#FFB6C1] text-[#4B004B] focus:ring-[#FF69B4]' : 'bg-gray-50 border-gray-300 focus:ring-pink-400'}`}
                  style={{ maxHeight: '150px', minHeight: '44px', lineHeight: '1.5' }}
                />
                {newMessage.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setNewMessage('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 mb-0.5">
            <button
              type="button"
              onClick={handleMicClick}
              className={`p-3 rounded-full transition-all flex-shrink-0 relative ${
                isRecording 
                  ? 'bg-red-500 text-white scale-110 shadow-[0_0_15px_rgba(239,68,68,0.5)]' 
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

            <button
              type="submit"
              disabled={(!newMessage.trim() && !selectedFile && !audioBlob) || isRecording}
              className={`p-3 rounded-full transition-all active:scale-95 flex-shrink-0 ${
                (newMessage.trim() || selectedFile || audioBlob)
                  ? `bg-gradient-to-r from-[#FF69B4] to-[#FF1493] text-white shadow-md`
                  : 'bg-gray-200 text-gray-400'
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
    onInput={(input: any) => {
      // 1. Check if the keyboard is triggering the camera overlay
      if (input === 'VIDEO_START') {
      setIsRecordingVideoNote(true); // This opens the screen we added in Step 2
      return; // Stop here so "VIDEO_START" doesn't go into the text box
    }

      // 2. Check for Video/Image Blobs
      if (input instanceof Blob || input instanceof File) {
        if (input.type.includes('video')) {
          setSelectedVideo(input); // Saving the video value
          setVideoPreview(URL.createObjectURL(input));
        } else {
          setSelectedFile(input as File);
          const reader = new FileReader();
          reader.onloadend = () => setImagePreview(reader.result as string);
          reader.readAsDataURL(input);
        }
        return;
      }

      // 3. Regular Text Logic
      setNewMessage(prev => prev + input);
      handleTyping();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
      }
    }}
    onDelete={() => {
      setNewMessage(prev => prev.slice(0, -1));
      if (newMessage.length <= 1 && textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }}
    onSend={() => handleSendMessage(new Event('submit') as any)}
  />
)}
    </div> // This is the final closing div of ChatWindow
  );
}

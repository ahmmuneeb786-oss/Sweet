import { useState, useEffect } from 'react';
import { User, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FloatingHearts } from '../components/FloatingHearts';
import { supabase } from '../lib/supabase';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance } from '../contexts/PerformanceContext';

// Shown to a Telegram Mini App user whose account has no username yet —
// either they never set one in Telegram, or their Telegram username was
// already claimed by someone else in Sweet. Deliberately never assigns one
// automatically: the user must pick it themselves, same as email signup.
export function TelegramUsernameSetup({ theme = 'light' }: { theme?: 'light' | 'dark' | 'sweet' }) {
  const { updateProfile } = useAuth();
  const { showError, showSuccess } = useNotify();
  const { isLowPerfMode } = usePerformance();

  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!username) {
      setUsernameError('');
      setUsernameAvailable(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      if (!/^[a-z0-9_-]+$/.test(username)) {
        setUsernameError('Username can only contain a-z, 0-9, - and _');
        setUsernameAvailable(false);
        return;
      }

      setCheckingUsername(true);
      setUsernameError('');

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('username', username.toLowerCase().trim())
          .maybeSingle();

        if (error) {
          console.error('Database query issue:', error);
          setUsernameError('Could not verify availability. Try again.');
          setUsernameAvailable(false);
          return;
        }

        if (data) {
          setUsernameError('Username already taken');
          setUsernameAvailable(false);
        } else {
          setUsernameError('');
          setUsernameAvailable(true);
        }
      } catch (error) {
        console.error('Error checking username:', error);
        setUsernameAvailable(false);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!usernameAvailable || usernameError || checkingUsername) return;

    setSubmitting(true);
    try {
      const lowerUsername = username.toLowerCase().trim();

      // Re-check right before writing — closes the gap between the live
      // check above and someone else grabbing the same name in between.
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', lowerUsername)
        .maybeSingle();

      if (existingUser) {
        setUsernameError('That username was just taken — please choose another.');
        setUsernameAvailable(false);
        return;
      }

      const { error } = await updateProfile({ username: lowerUsername });
      if (error) {
        // Unique-constraint race lost at the DB level, even after our checks.
        if ((error as { code?: string }).code === '23505') {
          setUsernameError('That username was just taken — please choose another.');
          setUsernameAvailable(false);
        } else {
          throw error;
        }
        return;
      }

      showSuccess('Username set! Welcome to Sweet 💕');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not set your username. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const isSweet = theme === 'sweet';

  return (
    <div className={`min-h-screen flex items-center justify-center relative bg-gradient-to-br ${
      isSweet ? 'from-[#FFF0F5] via-[#FFE4E1] to-[#FFD1DC]' : 'from-pink-50 via-purple-50 to-blue-50'
    }`}>
      <div className="fixed inset-0 z-0 pointer-events-none">
        <FloatingHearts theme={theme} />
      </div>

      <div className="w-full max-w-md relative z-10 px-4 py-8 sm:px-6">
        <div className={`rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 ${isLowPerfMode ? '' : 'backdrop-blur-sm'} ${
          isSweet ? 'bg-[#FFF0F5]/90 border border-[#FFB6C1]' : 'bg-white/90'
        }`}>
          <div className="flex flex-col items-center text-center gap-3 pb-2">
            <div className={`p-3 rounded-full ${isSweet ? 'bg-[#FFE4E1]' : 'bg-pink-50'}`}>
              <ShieldCheck className={`w-6 h-6 ${isSweet ? 'text-[#FF69B4]' : 'text-pink-500'}`} />
            </div>
            <h1 className={`text-2xl font-bold ${isSweet ? 'text-[#4B004B]' : 'text-gray-900'}`}>
              Choose your username
            </h1>
            <p className={`text-sm ${isSweet ? 'text-[#8B004B]' : 'text-gray-600'}`}>
              We couldn't find (or already claimed) a Telegram username for you. You'll need to set one to continue — it's how friends find and add you in Sweet.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isSweet ? 'text-[#8B004B]' : 'text-gray-700'}`}>
                Username
              </label>
              <div className="relative">
                <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${isSweet ? 'text-[#FF69B4]/60' : 'text-gray-400'}`} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="sweet_alex"
                  autoFocus
                  className={`w-full pl-10 pr-10 py-3 border rounded-xl focus:ring-2 focus:border-transparent outline-none transition-all ${
                    usernameError ? 'border-red-500' : username && usernameAvailable ? 'border-green-500' : isSweet ? 'border-[#FFB6C1]' : 'border-gray-300'
                  } ${isSweet ? 'text-[#4B004B] focus:ring-[#FF69B4] bg-white' : 'focus:ring-pink-500'}`}
                  required
                />
                {checkingUsername && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!checkingUsername && username && usernameAvailable && (
                  <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                )}
                {!checkingUsername && usernameError && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" />
                )}
              </div>
              {usernameError && (
                <p className="mt-1 text-sm text-red-600">{usernameError}</p>
              )}
              {!usernameError && username && usernameAvailable && (
                <p className="mt-1 text-sm text-green-600">Username available!</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !username || !usernameAvailable || !!usernameError || checkingUsername}
              className={`w-full py-3 px-4 text-white font-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-r ${
                isSweet ? 'from-[#FF69B4] to-[#FF1493] hover:from-[#FF1493] hover:to-[#FF69B4] focus:ring-[#FF69B4]' : 'from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 focus:ring-pink-500'
              }`}
            >
              {submitting ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Setting username...</span>
                </div>
              ) : (
                'Continue'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

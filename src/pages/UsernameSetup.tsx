import { useState, useEffect } from 'react';
import { User, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FloatingHearts } from '../components/FloatingHearts';
import { useAppIsSweet } from '../theme/sweetHearts';
import { supabase } from '../lib/supabase';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance } from '../contexts/PerformanceContext';

// Safety net for a signed-in account whose profile has no username — email
// signup always sets one, so normally this never shows. Blocks entry until
// the user picks one; never assigns one automatically.
export function UsernameSetup({ theme = 'light' }: { theme?: 'light' | 'dark' | 'sweet' }) {
  const appIsSweet = useAppIsSweet();
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

  // Colours come from the theme this device last used (th-* CSS variables),
  // so sign-in already looks like the user's app.

  return (
    <div className={`min-h-screen flex items-center justify-center relative bg-gradient-to-br ${
      'from-th-bg via-th-panel to-th-secondary'
    }`}>
      <div className="fixed inset-0 z-0 pointer-events-none">
        {/* Hearts are Sweet-only. */}
        {appIsSweet && <FloatingHearts theme={theme} />}
      </div>

      <div className="w-full max-w-md relative z-10 px-4 py-8 sm:px-6">
        <div className={`rounded-3xl shadow-2xl p-6 sm:p-8 space-y-6 ${isLowPerfMode ? '' : 'backdrop-blur-sm'} ${
          'bg-th-card/90 text-th-ink border border-th-border'
        }`}>
          <div className="flex flex-col items-center text-center gap-3 pb-2">
            <div className={`p-3 rounded-full ${'bg-th-secondary'}`}>
              <ShieldCheck className={`w-6 h-6 ${'text-th-primary'}`} />
            </div>
            <h1 className={`text-2xl font-bold ${'text-th-ink'}`}>
              Choose your username
            </h1>
            <p className={`text-sm ${'text-th-ink-soft'}`}>
              Your account doesn't have a username yet. You'll need to set one to continue — it's how friends find and add you in Sweet.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${'text-th-ink-soft'}`}>
                Username
              </label>
              <div className="relative">
                <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${'text-th-ink-faint'}`} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="sweet_alex"
                  autoFocus
                  className={`w-full pl-10 pr-10 py-3 border rounded-xl focus:ring-2 focus:border-transparent outline-none transition-all ${
                    usernameError ? 'border-red-500' : username && usernameAvailable ? 'border-green-500' : 'border-th-border'
                  } ${'text-th-ink placeholder:text-th-ink-faint focus:ring-th-primary/50 bg-th-input'}`}
                  required
                />
                {checkingUsername && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 border-2 border-th-primary border-t-transparent rounded-full animate-spin" />
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
              className={`w-full py-3 px-4 font-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98] bg-gradient-to-r ${
                'from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine hover:opacity-90 focus:ring-th-primary'
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

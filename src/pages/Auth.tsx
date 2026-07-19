import { useState, useEffect } from 'react';
import { Heart, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FloatingHearts } from '../components/FloatingHearts';
import { supabase } from '../lib/supabase';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance } from '../contexts/PerformanceContext';

type AuthMode = 'login' | 'signup' | 'forgot' | 'verify-otp';

// Mirrors the allowlist in the `signup_email_domains` table (Supabase
// before-user-created hook) — this copy is ONLY for instant client-side
// feedback before a network round trip. The real enforcement that can't be
// bypassed lives server-side; this just avoids making someone wait on a
// request we already know will be rejected.
const TRUSTED_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com'
];

function isTrustedEmailDomain(emailToCheck: string) {
  const domain = emailToCheck.split('@')[1]?.toLowerCase().trim();
  return !!domain && TRUSTED_EMAIL_DOMAINS.includes(domain);
}

// Basic shape check — has an "@", something before it, and a domain with a
// dot (e.g. "example.com"). This is just to keep the button disabled for
// obviously-incomplete input; the trusted-domain check above (and the
// server-side hook) is the real gatekeeper.
function isValidEmailFormat(emailToCheck: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToCheck.trim());
}

export function Auth() {
  const { signIn, signUp, verifySignupOtp, resendSignupOtp, completeProfileSetup } = useAuth();
  const { showSuccess, showError, showInfo } = useNotify();
  const { isLowPerfMode } = usePerformance();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (password) {
      const hasLower = /[a-z]/.test(password);
      const hasUpper = /[A-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecial = /[^a-zA-Z0-9]/.test(password);
      const isLongEnough = password.length >= 8;

      const strengthScore = [hasLower, hasUpper, hasNumber, hasSpecial, isLongEnough].filter(Boolean).length;

      if (strengthScore <= 2) {
        setPasswordStrength('weak');
      } else if (strengthScore <= 4) {
        setPasswordStrength('medium');
      } else {
        setPasswordStrength('strong');
      }
    } else {
      setPasswordStrength(null);
    }
  }, [password]);

useEffect(() => {
    if (mode === 'signup' && username) {
      const timeoutId = setTimeout(async () => {
        // 1. Basic character validation
        if (!/^[a-z0-9_-]+$/.test(username)) {
          setUsernameError('Username can only contain a-z, 0-9, - and _');
          setUsernameAvailable(false);
          return;
        }

        setCheckingUsername(true);
        setUsernameError('');

        try {
          // 2. The Bug Fix: Clean the input and explicitly capture potential database errors
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', username.toLowerCase().trim()) // Added .trim() to prevent space bypass bugs
            .maybeSingle();

          // 3. The Bug Fix: If the database throws an error, stop and handle it safely
          if (fetchError) {
            console.error('Database query issue:', fetchError);
            setUsernameError('Could not verify availability. Try again.');
            setUsernameAvailable(false);
            return;
          }

          // 4. Evaluate the actual presence of data
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
    } else {
      setUsernameError('');
      setUsernameAvailable(false);
    }
  }, [username, mode]);

  useEffect(() => {
    if (mode === 'signup' && email && isValidEmailFormat(email)) {
      const timeoutId = setTimeout(async () => {
        setCheckingEmail(true);
        try {
          const { data, error } = await supabase.rpc('is_email_registered', {
            check_email: email.trim(),
          });
          if (error) {
            console.error('Email availability check failed:', error);
            setEmailAlreadyRegistered(false); // fail open on our own check — the real block is server-side at signup anyway
          } else {
            setEmailAlreadyRegistered(!!data);
          }
        } catch (err) {
          console.error('Email availability check failed:', err);
          setEmailAlreadyRegistered(false);
        } finally {
          setCheckingEmail(false);
        }
      }, 500);

      return () => clearTimeout(timeoutId);
    } else {
      setEmailAlreadyRegistered(false);
    }
  }, [email, mode]);

  const isFormValid = () => {
    if (mode === 'login') {
      return email && password;
    } else if (mode === 'signup') {
      return (
        email &&
        isValidEmailFormat(email) &&
        !emailAlreadyRegistered &&
        !checkingEmail &&
        password &&
        confirmPassword &&
        password === confirmPassword &&
        username &&
        displayName &&
        usernameAvailable &&
        !usernameError &&
        passwordStrength !== 'weak'
      );
    } else if (mode === 'verify-otp') {
      return otpCode.length === 6;
    } else {
      return email;
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        if (error) {
          // Interrupted signup (closed the app before entering the OTP code)
          // shouldn't be a dead end — route straight back into verification
          // instead of just showing an opaque error.
          if (error.message.toLowerCase().includes('email not confirmed')) {
            setMode('verify-otp');
            setOtpCode('');
            showInfo("Looks like you haven't verified your email yet — enter the code we sent you.");
            return;
          }
          throw error;
        }
        // Nothing to do here anymore — App derives its "Preparing your inbox"
        // splash directly from `user` becoming set (see profileSyncLoading in
        // App.tsx), so the hand-off happens automatically the instant the
        // session propagates, with no flash to guard against manually.
      } else if (mode === 'signup') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }

        if (!isTrustedEmailDomain(email)) {
          showError('Dear user, please enter a valid and trusted email');
          return;
        }

        // Belt-and-suspenders: don't trust the debounced background check
        // alone (a fast typer could submit before it resolves) — verify
        // fresh, right now, immediately before actually creating anything.
        const { data: freshCheck } = await supabase.rpc('is_email_registered', {
          check_email: email.trim(),
        });
        if (freshCheck) {
          showError('This email already has an account. Please log in instead.');
          setEmailAlreadyRegistered(true);
          return;
        }

        const result = await signUp(email, password);
        if (result?.error) throw result.error;

        // Supabase's own documented signal: signing up an email that's
        // already registered AND confirmed doesn't return an error — it
        // returns a user object with an empty `identities` array instead.
        if (result?.data?.user?.identities?.length === 0) {
          showError('This email already has an account. Please log in instead.');
          return;
        }

        if (result?.data?.session) {
          // "Confirm email" is currently OFF in Supabase (no way to send
          // mail to real users yet without a verified domain) — a session
          // came back immediately, so there's no code to enter. Finish
          // account setup right away instead of showing a dead-end OTP
          // screen that no code was ever sent for. The moment "Confirm
          // email" gets switched back on later, `session` will come back
          // null instead and this same code drops into the OTP path below
          // automatically — nothing to remember to change back.
          const { error: profileError } = await completeProfileSetup(username, displayName);
          if (profileError) {
            await supabase.auth.signOut();
            throw new Error(`Account created, but profile setup failed: ${profileError.message}. Please try signing up again.`);
          }
          showSuccess('Welcome to Sweet! Your account is ready. 💕');
          return;
        }

        // Profile creation deliberately does NOT happen here — with email
        // confirmation required, there's no session yet to authenticate
        // those writes. It happens in handleVerifyOtp, right after the
        // code is confirmed and a real session exists.
        setMode('verify-otp');
        setOtpCode('');
        showInfo(`We sent a 6-digit code to ${email}. Enter it below to finish creating your account.`);
      } else if (mode === 'verify-otp') {
        const { error: verifyError } = await verifySignupOtp(email, otpCode);
        if (verifyError) throw verifyError;

        const { error: profileError } = await completeProfileSetup(username, displayName);
        if (profileError) {
          // A real session now exists (OTP just verified), but there's no
          // profile row — leaving this as-is would let the rest of the app
          // think login succeeded and push them into the Dashboard with no
          // profile, breaking basically everything downstream. Safer to
          // sign back out and surface a clear error than leave them in a
          // half-authenticated state.
          await supabase.auth.signOut();
          throw new Error(
            `Your email was verified, but we couldn't finish setting up your account: ${profileError.message}. Please try signing up again.`
          );
        }

        showSuccess('Welcome to Sweet! Your account is ready. 💕');
        // Real session + profile now exist — App's derived splash takes over
        // automatically once the session propagates.
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/reset-password',
        });
        if (error) throw error;
        showSuccess('Password reset email sent! Check your inbox.');
      }
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    if (resendCooldown > 0) return;
    try {
      const { error } = await resendSignupOtp(email);
      if (error) throw error;
      showInfo('A fresh code is on its way!');
      setResendCooldown(60);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not resend the code. Please try again.');
    }
  }

  const getPasswordStrengthColor = () => {
    if (passwordStrength === 'weak') return 'bg-red-500';
    if (passwordStrength === 'medium') return 'bg-yellow-500';
    if (passwordStrength === 'strong') return 'bg-green-500';
    return 'bg-gray-300';
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength === 'weak') return 'Weak';
    if (passwordStrength === 'medium') return 'Medium';
    if (passwordStrength === 'strong') return 'Strong';
    return '';
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      {!isLowPerfMode && <FloatingHearts />}

      <div className="w-full max-w-md mx-4 relative z-10">
        <div className={`bg-white/90 rounded-3xl shadow-2xl p-8 space-y-6 ${isLowPerfMode ? '' : 'backdrop-blur-sm'}`}>
{/* Header Section: Minimalist, Layered Logo */}
          <div className="text-center space-y-3 pb-4">
            <div className="flex justify-center mb-6 relative group">
              {/* Glassmorphic Layered Ring - Creates Depth (Stylish) */}
              {!isLowPerfMode && (
                <div className="absolute inset-0 bg-pink-100/50 rounded-full blur-xl scale-125 opacity-70 animate-pulse group-hover:opacity-100 transition-opacity"></div>
              )}
              
              {/* Main Icon Container - Solid & Premium (Professional) */}
              <div className="relative z-10 bg-white p-5 rounded-[30px] shadow-lg shadow-pink-100/60 border border-pink-50 transition-transform duration-500 group-hover:scale-105 group-hover:-rotate-3">
                {/* The "Double Heart" Icon - Playful & Modern (Sweet) */}
                <div className="relative">
                  {/* Two extra echo hearts were adding continuous stacked
                      bounce animations for a purely decorative effect —
                      cut in low-perf mode, one heart still bounces. */}
                  {!isLowPerfMode && (
                    <>
                      <Heart className="w-12 h-12 text-pink-100 fill-pink-50 absolute -top-2 -right-2 opacity-40 animate-[bounce_1.8s_infinite_ease-in-out]" style={{ animationDelay: '0.4s' }} />
                      <Heart className="w-12 h-12 text-pink-200 fill-pink-200 absolute -top-1 -right-1 opacity-60 animate-[bounce_1.8s_infinite_ease-in-out]" style={{ animationDelay: '0.3s' }} />
                    </>
                  )}
                  <Heart className={`relative z-10 w-12 h-12 text-pink-500 fill-pink-500 drop-shadow-[0_4px_6px_rgba(219,39,119,0.3)] ${isLowPerfMode ? '' : 'animate-[bounce_1.8s_infinite_ease-in-out]'}`} />
                </div>
              </div>
            </div>

            {/* Title: The "Sweet" Text - Clean but bold (Professional) */}
            <h1 className="text-4xl font-extrabold tracking-tighter bg-gradient-to-br from-pink-500 via-rose-500 to-purple-600 bg-clip-text text-transparent">
              Sweet
            </h1>

            {/* Subtitle: Spread Love - Balanced and clear */}
            <p className="text-pink-900/60 text-xs font-semibold uppercase tracking-[0.25em] flex items-center justify-center gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity duration-300">
              <span className="h-0.5 w-6 bg-pink-100"></span>
              Spread Love By SWEET
              <span className="h-0.5 w-6 bg-pink-100"></span>
            </p>
          </div>

          {mode !== 'verify-otp' && (
          <div className="flex gap-2 p-1 bg-gray-100 rounded-full">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 px-4 rounded-full font-medium transition-all ${
                mode === 'login'
                  ? 'bg-white text-pink-600 shadow-md'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 px-4 rounded-full font-medium transition-all ${
                mode === 'signup'
                  ? 'bg-white text-pink-600 shadow-md'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Sign Up
            </button>
          </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'verify-otp' ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center gap-2 pb-2">
                  <div className="bg-pink-50 p-3 rounded-full">
                    <ShieldCheck className="w-6 h-6 text-pink-500" />
                  </div>
                  <p className="text-sm text-gray-600">
                    We sent a 6-digit code to <span className="font-semibold text-gray-900">{email}</span>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full py-3 text-center text-2xl font-bold tracking-[0.5em] border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                    required
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => { setMode('signup'); setOtpCode(''); }}
                    className="text-gray-500 hover:text-gray-700 font-medium"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendCooldown > 0}
                    className="text-pink-600 hover:text-pink-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                  </button>
                </div>
              </div>
            ) : (
              <>
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Display Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your Name"
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Username
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase())}
                      placeholder="sweet_alex"
                      className={`w-full pl-10 pr-10 py-3 border rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all ${
                        usernameError ? 'border-red-500' : username && usernameAvailable ? 'border-green-500' : 'border-gray-300'
                      }`}
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
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                  required
                />
                {mode === 'signup' && checkingEmail && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              {mode === 'signup' && email && !isValidEmailFormat(email) && (
                <p className="mt-1 text-sm text-red-600">Enter a complete email, like you@example.com</p>
              )}
              {mode === 'signup' && !checkingEmail && emailAlreadyRegistered && (
                <p className="mt-1 text-sm text-red-600">
                  This email already has an account.{' '}
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="underline font-semibold hover:text-red-700"
                  >
                    Log in instead
                  </button>
                </p>
              )}
            </div>

            {mode !== 'forgot' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {mode === 'signup' && password && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${getPasswordStrengthColor()}`}
                            style={{
                              width: passwordStrength === 'weak' ? '33%' : passwordStrength === 'medium' ? '66%' : '100%'
                            }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${
                          passwordStrength === 'weak' ? 'text-red-600' :
                          passwordStrength === 'medium' ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {getPasswordStrengthText()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {mode === 'signup' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className={`w-full pl-10 pr-12 py-3 border rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all ${
                          confirmPassword && password !== confirmPassword ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                    {confirmPassword && password !== confirmPassword && (
                      <p className="mt-1 text-sm text-red-600">Passwords do not match</p>
                    )}
                  </div>
                )}
              </>
            )}
            </>
            )}

            {mode === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="text-sm text-pink-600 hover:text-pink-700 font-medium"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !isFormValid()}
              className="w-full py-3 px-4 bg-gradient-to-r from-pink-500 to-rose-500 text-white font-medium rounded-xl hover:from-pink-600 hover:to-rose-600 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Please wait...</span>
                </div>
              ) : (
                <>
                  {mode === 'login' && 'Sign In'}
                  {mode === 'signup' && 'Create Account'}
                  {mode === 'forgot' && 'Send Reset Link'}
                  {mode === 'verify-otp' && 'Verify & Continue'}
                </>
              )}
            </button>

            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => setMode('login')}
                className="w-full text-center text-sm text-gray-600 hover:text-gray-900"
              >
                Back to login
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
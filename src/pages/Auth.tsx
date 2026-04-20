import { useState, useEffect } from 'react';
import { Heart, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { FloatingHearts } from '../components/FloatingHearts';
import { supabase } from '../lib/supabase';

type AuthMode = 'login' | 'signup' | 'forgot';

export function Auth() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);

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
        if (!/^[a-z0-9_-]+$/.test(username)) {
          setUsernameError('Username can only contain a-z, 0-9, - and _');
          setUsernameAvailable(false);
          return;
        }

        setCheckingUsername(true);
        setUsernameError('');

        try {
          const { data } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', username.toLowerCase())
            .maybeSingle();

          if (data) {
            setUsernameError('Username already taken');
            setUsernameAvailable(false);
          } else {
            setUsernameError('');
            setUsernameAvailable(true);
          }
        } catch (error) {
          console.error('Error checking username:', error);
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

  const isFormValid = () => {
    if (mode === 'login') {
      return email && password;
    } else if (mode === 'signup') {
      return (
        email &&
        password &&
        confirmPassword &&
        password === confirmPassword &&
        username &&
        displayName &&
        usernameAvailable &&
        !usernameError &&
        passwordStrength !== 'weak'
      );
    } else {
      return email;
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }

        const { error } = await signUp(email, password, username, displayName);
        if (error) throw error;
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/reset-password',
        });
        if (error) throw error;
        setSuccess('Password reset email sent! Check your inbox.');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An error occurred');
      }
    } finally {
      setLoading(false);
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
      <FloatingHearts />

      <div className="w-full max-w-md mx-4 relative z-10">
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl p-8 space-y-6">
{/* Header Section: Minimalist Luxury Design */}
          <div className="text-center pb-2 group">
            <div className="flex justify-center mb-8">
              <div className="relative">
                {/* The "Glow" - Extremely subtle, soft pink aura */}
                <div className="absolute inset-0 bg-pink-200 rounded-full blur-3xl opacity-30 group-hover:opacity-50 transition-opacity duration-700"></div>
                
                {/* The Icon Container - Simple, clean white circle with a thin border */}
                <div className="relative z-10 w-24 h-24 bg-white rounded-[2rem] shadow-[0_10px_40px_-10px_rgba(244,114,182,0.2)] border border-pink-50/50 flex items-center justify-center transition-all duration-500 group-hover:shadow-pink-200/50">
                  <Heart 
                    className="w-10 h-10 text-pink-500 fill-pink-500 transition-transform duration-500 group-hover:scale-110" 
                    strokeWidth={1.5}
                  />
                </div>
              </div>
            </div>

            {/* Title: Ultra-clean Typography */}
            <h1 className="text-5xl font-black text-slate-800 tracking-tight mb-1">
              Sweet<span className="text-pink-500">.</span>
            </h1>

            {/* Subtitle: High-end "Tagline" style */}
            <div className="flex flex-col items-center">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.4em] mb-3">
                Messaging App
              </p>
              <div className="flex items-center gap-2">
                <div className="h-[1px] w-4 bg-pink-200"></div>
                <p className="text-pink-600/60 text-xs font-medium italic">
                  Spread Love by SWEET
                </p>
                <div className="h-[1px] w-4 bg-pink-200"></div>
              </div>
            </div>
          </div>

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

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl flex items-start gap-2">
              <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                  required
                />
              </div>
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

import { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { hashSecret } from '../lib/secureHash';

interface VaultVerifyProps {
  mode: 'pin' | 'password';
  expectedHash: string;
  userId: string;
  onUnlock: () => void;
  onCancel: () => void;
}

export function VaultVerify({ mode, expectedHash, userId, onUnlock, onCancel }: VaultVerifyProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function verify(candidate: string) {
    setChecking(true);
    setError('');
    const hash = await hashSecret(candidate, userId);
    if (hash === expectedHash) {
      onUnlock();
    } else {
      setError(mode === 'pin' ? 'Incorrect PIN' : 'Incorrect password');
      setValue('');
      setChecking(false);
    }
  }

  function handleKeyPress(digit: string) {
    if (checking || value.length >= 4) return;
    const next = value + digit;
    setValue(next);
    if (next.length === 4) verify(next);
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-[#FFF0F3] flex flex-col items-center justify-center p-8">
      <div className="absolute top-10 flex items-center gap-2 bg-white/50 px-4 py-2 rounded-full backdrop-blur-md border border-white">
        <Lock className="w-4 h-4 text-pink-500" />
        <span className="text-pink-600 text-xs font-bold uppercase tracking-widest">
          {mode === 'pin' ? 'Enter Vault PIN' : 'Enter Vault Password'}
        </span>
      </div>

      <div className="bg-white/80 backdrop-blur-sm p-6 rounded-[32px] shadow-xl border border-white max-w-xs w-full mt-16">
        {error && (
          <div className="flex items-center gap-2 text-red-500 text-xs font-bold mb-3 justify-center">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {mode === 'pin' ? (
          <>
            <div className="flex justify-center gap-4 py-2 mb-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full border-2 transition-all ${
                    value.length > i ? 'bg-[#FF69B4] border-[#FF69B4] scale-110' : 'border-gray-300 bg-gray-50'
                  }`}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  disabled={checking}
                  onClick={() => handleKeyPress(num.toString())}
                  className="h-11 w-11 mx-auto flex items-center justify-center rounded-full font-bold text-sm bg-[#FFC0CB]/40 border border-[#FFB6C1] text-[#4B004B] active:scale-90 transition-all disabled:opacity-50"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => setValue((v) => v.slice(0, -1))}
                className="h-11 w-11 mx-auto flex items-center justify-center text-xs font-semibold text-gray-400 hover:text-red-500"
              >
                Clear
              </button>
              <button
                disabled={checking}
                onClick={() => handleKeyPress('0')}
                className="h-11 w-11 mx-auto flex items-center justify-center rounded-full font-bold text-sm bg-[#FFC0CB]/40 border border-[#FFB6C1] text-[#4B004B] active:scale-90 transition-all disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={onCancel}
                className="h-11 w-11 mx-auto flex items-center justify-center text-xs font-semibold text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              type="password"
              autoFocus
              value={value}
              disabled={checking}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value) verify(value);
              }}
              placeholder="Enter password..."
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none border border-[#FFB6C1] bg-[#FFC0CB]/20 text-[#4B004B] mb-3"
            />
            <div className="flex gap-2">
              <button
                disabled={checking || !value}
                onClick={() => verify(value)}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-[#FF1493] hover:bg-[#FF69B4] transition-colors disabled:opacity-50"
              >
                {checking ? 'Checking...' : 'Unlock'}
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
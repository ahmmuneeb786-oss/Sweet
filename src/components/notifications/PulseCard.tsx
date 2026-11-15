import { useRef, useState } from 'react';
import { Check, X, Wrench } from 'lucide-react';
import { freshSteps, runSweetPulse, type Step } from '../../lib/sweetPulse';
import type { Tokens } from '../storage/tokens';

function StepIcon({ state }: { state: Step['state'] }) {
  if (state === 'running') return <div className="w-4 h-4 border-2 border-th-primary border-t-transparent rounded-full animate-spin" />;
  if (state === 'ok') return <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check className="w-3 h-3" strokeWidth={3} /></span>;
  if (state === 'repaired') return <span className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center"><Wrench className="w-2.5 h-2.5" strokeWidth={3} /></span>;
  if (state === 'fail') return <span className="w-4 h-4 rounded-full bg-th-danger text-white flex items-center justify-center"><X className="w-3 h-3" strokeWidth={3} /></span>;
  return <span className="w-4 h-4 rounded-full border-2 border-th-border" />;
}

/**
 * 🍬 "Send me a test candy" — checks every step of the notification pipeline
 * for this device, repairs what it can, and proves it with a real push.
 */
export function PulseCard({ t, userId, onFinished }: { t: Tokens; userId: string; onFinished?: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const runningRef = useRef(false);

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setResult(null);
    setSteps(freshSteps());
    const ok = await runSweetPulse(userId, (id, patch) =>
      setSteps((prev) => (prev ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)))
    );
    // Steps after a failure never ran — drop them so the list ends at the problem.
    setSteps((prev) => {
      const list = prev ?? [];
      const failAt = list.findIndex((s) => s.state === 'fail');
      return failAt >= 0 ? list.slice(0, failAt + 1) : list;
    });
    setResult(ok ? 'ok' : 'fail');
    setRunning(false);
    runningRef.current = false;
    onFinished?.();
  }

  const repaired = steps?.some((s) => s.state === 'repaired');

  return (
    <div className={`rounded-2xl p-4 space-y-3 ${t.intro}`}>
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg ${t.iconBox}`} aria-hidden="true">🍬</div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold">Sweet Pulse</h4>
          <p className={`text-[11px] mt-0.5 ${t.sub}`}>Not getting notifications? Send yourself a test — Sweet checks every step and fixes what it can.</p>
        </div>
      </div>

      {steps && (
        <ul className="space-y-2" aria-live="polite">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0"><StepIcon state={s.state} /></span>
              <div className="min-w-0">
                <p className={`text-[12px] font-semibold ${s.state === 'waiting' ? t.faint : ''}`}>
                  {s.label}
                  {s.note && <span className={`font-normal ${t.sub}`}> · {s.note}</span>}
                </p>
                {s.fix && <p className="text-[11px] mt-0.5 text-th-danger">{s.fix}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {result === 'ok' && (
        <p className="text-[12px] font-bold text-th-link">
          {repaired ? 'Fixed and working — you’re all set 🍬' : 'Everything works — whispers can reach you 🍬'}
        </p>
      )}

      <button
        onClick={run}
        disabled={running}
        className={`w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-60 ${t.primary}`}
      >
        {running ? 'Checking…' : result ? 'Run it again' : 'Send me a test candy'}
      </button>
    </div>
  );
}

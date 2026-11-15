import { supabase } from './supabase';
import { PermissionManager } from '../services/PermissionManager';
import { deviceTimezone, savePrefs } from './notificationPrefs';

/*
  Sweet Pulse — "Send me a test candy".
  Walks the whole notification pipeline for THIS device, step by step,
  repairs what an app can repair by itself, and finally sends a real push
  and waits for it to land (the service worker reports back).

  Each step ends as:
    ok        worked
    repaired  was broken, fixed automatically
    fail      broken, and `fix` tells the user what to do
*/

export type StepId = 'support' | 'permission' | 'worker' | 'device' | 'server' | 'landed';
export type StepState = 'waiting' | 'running' | 'ok' | 'repaired' | 'fail';

export interface Step {
  id: StepId;
  label: string;
  state: StepState;
  note?: string;
  fix?: string;
}

export const STEP_LABELS: Record<StepId, string> = {
  support: 'This browser can show notifications',
  permission: 'Permission granted',
  worker: 'Sweet’s helper is running',
  device: 'This device is registered',
  server: 'Sweet’s server reached you',
  landed: 'The candy landed',
};

export function freshSteps(): Step[] {
  return (Object.keys(STEP_LABELS) as StepId[]).map((id) => ({ id, label: STEP_LABELS[id], state: 'waiting' }));
}

type Report = (id: StepId, patch: Partial<Step>) => void;

interface TestReply { ok: boolean; step?: string; reason?: string; status?: number | null }

async function sendTest(testId: string, endpoint: string, vibrate?: number[]): Promise<TestReply> {
  const { data, error } = await supabase.functions.invoke('send-sweet-push', {
    body: { action: 'test', testId, endpoint, ...(vibrate ? { vibrate } : {}) },
  });
  if (error) {
    // functions.invoke wraps non-2xx answers; read the JSON body if there is one.
    const ctx = (error as { context?: Response }).context;
    try {
      const body = ctx ? await ctx.json() : null;
      if (body && typeof body === 'object') return body as TestReply;
    } catch {
      // not JSON
    }
    return { ok: false, step: 'network', reason: navigator.onLine ? 'unreachable' : 'offline' };
  }
  return (data ?? { ok: false, step: 'network', reason: 'empty' }) as TestReply;
}

function waitForLanding(testId: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) return resolve(null);
    const started = performance.now();
    const done = (v: number | null) => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'sweet:test-landed' && e.data.testId === testId) done(performance.now() - started);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.serviceWorker.addEventListener('message', onMessage);
  });
}

/**
 * Runs the check. `vibrate` lets Heartbeat Tap send a pattern to "feel it on
 * the lock screen". Never throws; every outcome is reported through `report`.
 */
export async function runSweetPulse(userId: string, report: Report, vibrate?: number[]): Promise<boolean> {
  const fail = (id: StepId, fix: string, note?: string) => { report(id, { state: 'fail', fix, note }); return false; };

  // 1. support
  report('support', { state: 'running' });
  const status = await PermissionManager.getPushStatus();
  if (status === 'unsupported') return fail('support', 'Open Sweet in Chrome, Edge or Firefox — this browser has no notifications.');
  if (status === 'ios-install') return fail('support', 'On iPhone: Share → “Add to Home Screen”, then open Sweet from the Home Screen.');
  report('support', { state: 'ok' });

  // 2. permission
  report('permission', { state: 'running' });
  if (status === 'blocked') return fail('permission', 'Your browser blocks Sweet. Tap the 🔒 next to the address bar → Notifications → Allow.');
  if (PermissionManager.isPushOptedOut()) return fail('permission', 'Notifications are switched off on this device — turn on the switch above first.');
  if (Notification.permission !== 'granted') {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') {
      return fail('permission', answer === 'denied'
        ? 'You chose Block. Tap the 🔒 next to the address bar → Notifications → Allow.'
        : 'Tap “Allow” when the browser asks, then try again.');
    }
    report('permission', { state: 'repaired', note: 'Asked and allowed' });
  } else {
    report('permission', { state: 'ok' });
  }

  // 3. service worker
  report('worker', { state: 'running' });
  if (!(await PermissionManager.workerReady())) {
    return fail('worker', 'Close every Sweet tab and open Sweet again (an update may be waiting).');
  }
  report('worker', { state: 'ok' });

  // 4. device registration (+ keep the timezone right for Bedtime Jars)
  report('device', { state: 'running' });
  let repairedDevice = false;
  let sub = await PermissionManager.currentSubscription();
  if (!sub) {
    if (!(await PermissionManager.setupPushSubscription(userId, { userAction: true }))) {
      return fail('device', navigator.onLine ? 'Could not register this device. Try again in a minute.' : 'You’re offline — connect and try again.');
    }
    sub = await PermissionManager.currentSubscription();
    repairedDevice = true;
  } else {
    // Re-save it: cheap, and fixes a server copy that went missing.
    await PermissionManager.setupPushSubscription(userId, { userAction: true });
  }
  if (!sub) return fail('device', 'Could not register this device. Try again in a minute.');
  savePrefs(userId, { timezone: deviceTimezone() }).catch(() => {});
  report('device', { state: repairedDevice ? 'repaired' : 'ok', note: repairedDevice ? 'Registered again' : undefined });

  // 5. server sends a real push (one automatic retry after a repair)
  report('server', { state: 'running' });
  const testId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const landing = waitForLanding(testId, 20000);
  let reply = await sendTest(testId, sub.endpoint, vibrate);
  let repairedServer = false;
  if (!reply.ok && (reply.reason === 'not_registered' || reply.reason === 'expired')) {
    // The server lost this device, or the browser's push address died:
    // start a fresh subscription and try once more.
    try { await sub.unsubscribe(); } catch { /* already gone */ }
    if (await PermissionManager.setupPushSubscription(userId, { userAction: true })) {
      sub = await PermissionManager.currentSubscription();
      if (sub) {
        reply = await sendTest(testId, sub.endpoint, vibrate);
        repairedServer = reply.ok;
      }
    }
  }
  if (!reply.ok) {
    if (reply.reason === 'offline') return fail('server', 'You’re offline — connect and try again.');
    if (reply.reason === 'not_configured') return fail('server', 'Sweet’s push keys aren’t set on the server yet (VAPID secrets).');
    if (reply.reason === 'signed_out') return fail('server', 'Your sign-in expired — sign out and back in, then try again.');
    if (reply.step === 'network') return fail('server', 'Couldn’t reach Sweet’s server. Try again in a minute.');
    return fail('server', 'The browser’s push service refused the candy. Try again; if it keeps failing, turn the switch off and on.', reply.status ? `Code ${reply.status}` : undefined);
  }
  report('server', { state: repairedServer ? 'repaired' : 'ok', note: repairedServer ? 'Fixed a stale address' : undefined });

  // 6. it actually showed up on this device
  report('landed', { state: 'running' });
  const ms = await landing;
  if (ms === null) {
    return fail('landed', 'Sent, but this device didn’t show it. Check battery saver / Focus mode, and that Chrome may show notifications in your phone’s settings.');
  }
  report('landed', { state: 'ok', note: `Arrived in ${(ms / 1000).toFixed(1)}s 🍬` });
  return true;
}

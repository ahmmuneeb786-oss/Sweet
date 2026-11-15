import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNotify } from '../../contexts/NotificationContext';
import { supabase } from '../../lib/supabase';
import { PermissionManager, type PushStatus } from '../../services/PermissionManager';
import { cachedPrefs, deviceTimezone, loadPrefs, savePrefs, type NotificationPrefs, type Peek } from '../../lib/notificationPrefs';
import { TabBody, TabHeader } from '../storage/parts';
import { tokens, type AppTheme, type Tokens } from '../storage/tokens';
import { LockPreview } from './LockPreview';
import { MutedChatsView, loadMutedChats } from './MutedChatsView';
import { SectionLabel, SettingRow, Switch } from './parts';
import { HeartbeatView } from './HeartbeatView';
import { JarEditor, JarsView } from './JarsView';
import { PulseCard } from './PulseCard';
import { loadPeople, type Person } from './people';
import { describePattern, canFeelHere } from '../../lib/heartbeat';
import { jarIsActive, listJars, type Jar } from '../../lib/jars';

type View =
  | { name: 'home' }
  | { name: 'muted' }
  | { name: 'heartbeat' }
  | { name: 'jars' }
  | { name: 'jar-edit'; jar: Jar | null };

function NavRow({ t, emoji, title, detail, onClick }: { t: Tokens; emoji: string; title: string; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full text-left rounded-2xl p-4 flex items-center gap-3 transition-all ${t.card}`}>
      <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg ${t.iconBox}`} aria-hidden="true">{emoji}</div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold">{title}</h4>
        <p className={`text-[11px] mt-0.5 truncate ${t.sub}`}>{detail}</p>
      </div>
      <ChevronRight className={`w-4 h-4 shrink-0 ${t.faint}`} />
    </button>
  );
}

const PEEKS: { id: Peek; emoji: string; label: string; detail: string }[] = [
  { id: 'full', emoji: '👀', label: 'Full', detail: 'Name + message' },
  { id: 'sender', emoji: '🙈', label: 'Sender only', detail: 'Name, no text' },
  { id: 'secret', emoji: '🍬', label: 'Secret candy', detail: 'Nothing revealed' },
];

const CATEGORIES: { key: 'messages' | 'friend_requests' | 'theme_changes'; emoji: string; title: string; detail: string }[] = [
  { key: 'messages', emoji: '💌', title: 'Messages', detail: 'Texts, photos, voice notes and more' },
  { key: 'friend_requests', emoji: '🤝', title: 'Friend requests', detail: 'When someone wants to be friends' },
  { key: 'theme_changes', emoji: '🎨', title: 'Theme changes', detail: 'When someone recolours your chat' },
];

/** What the master card says for each device state. */
function statusCopy(status: PushStatus | null, otherDevices: number) {
  const elsewhere = otherDevices > 0 ? ` · also on ${otherDevices} other device${otherDevices === 1 ? '' : 's'}` : '';
  switch (status) {
    case 'on': return { title: 'On for this device', detail: `Whispers arrive even when Sweet is closed${elsewhere}` };
    case 'off': return { title: 'Off on this device', detail: `Turn on to get whispers when Sweet is closed${elsewhere}` };
    case 'blocked': return { title: 'Blocked by your browser', detail: 'Sweet can’t switch this back on by itself — see how below' };
    case 'ios-install': return { title: 'Add Sweet to your Home Screen', detail: 'iPhone only allows notifications for installed apps' };
    case 'unsupported': return { title: 'Not available here', detail: 'This browser can’t show notifications. Try Chrome, Edge or Firefox.' };
    default: return { title: 'Checking…', detail: ' ' };
  }
}

function FixSteps({ t, status, onRecheck }: { t: Tokens; status: PushStatus; onRecheck: () => void }) {
  const steps = status === 'ios-install'
    ? ['Open Sweet in Safari', 'Tap the Share button (square with ↑)', 'Choose “Add to Home Screen”', 'Open Sweet from your Home Screen and turn this on']
    : ['Tap the 🔒 or ⓘ next to the address bar', 'Open “Permissions” or “Site settings”', 'Set Notifications to “Allow”', 'Installed app? Long-press the Sweet icon → App info → Notifications'];
  return (
    <div className={`rounded-2xl p-4 space-y-2 ${t.intro}`}>
      <p className="text-xs font-bold">{status === 'ios-install' ? 'How to install' : 'How to unblock'}</p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className={`text-[11px] flex gap-2 ${t.sub}`}>
            <span className="w-4 h-4 shrink-0 rounded-full bg-th-primary text-th-on-primary text-[9px] font-black flex items-center justify-center">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {status === 'blocked' && (
        <button onClick={onRecheck} className={`text-xs font-bold ${t.action}`}>I’ve allowed it — check again</button>
      )}
    </div>
  );
}

export function NotificationsTab({ theme, userId, onBack }: { theme: AppTheme; userId?: string | null; onBack: () => void }) {
  const t = tokens(theme);
  const { showSuccess, showError, showInfo } = useNotify();
  const [view, setView] = useState<View>({ name: 'home' });
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => (userId ? cachedPrefs(userId) : cachedPrefs('')));
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const [otherDevices, setOtherDevices] = useState(0);
  const [mutedCount, setMutedCount] = useState<number | null>(null);
  const [sampleName, setSampleName] = useState('Sweetheart');
  const [people, setPeople] = useState<Person[]>([]);
  const [jars, setJars] = useState<Jar[] | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const refreshStatus = useCallback(async () => {
    setStatus(await PermissionManager.getPushStatus());
    if (!userId) return;
    // Devices other than this one (the own-row policy lets us count them).
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const mine = await registration?.pushManager?.getSubscription().catch(() => null);
    const { data } = await supabase.from('push_subscriptions').select('endpoint').eq('user_id', userId);
    setOtherDevices((data ?? []).filter((d) => d.endpoint !== mine?.endpoint).length);
  }, [userId]);

  const refreshJars = useCallback(() => {
    if (userId) listJars(userId).then(setJars).catch(() => setJars(null));
  }, [userId]);

  const refreshMuted = useCallback(() => {
    if (userId) loadMutedChats(userId).then((r) => setMutedCount(r.length)).catch(() => setMutedCount(null));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadPrefs(userId)
      .then((p) => {
        setPrefs(p);
        // Bedtime Jars use the server's copy of the timezone. If another
        // device (or a wrong clock) left it different from this one, fix it
        // here — the start-up sync only writes when THIS device's zone changes.
        const tz = deviceTimezone();
        if (p.timezone !== tz) savePrefs(userId, { timezone: tz }).then(() => setPrefs((cur) => ({ ...cur, timezone: tz }))).catch(() => {});
      })
      .catch(() => { /* cached copy stays on screen */ });
    refreshStatus().catch(() => setStatus('unsupported'));
    refreshMuted();
    refreshJars();
    // A real name makes the preview feel like yours (never a locked chat's).
    loadPeople().then((list) => {
      setPeople(list);
      if (list[0]) setSampleName(list[0].name.split(' ')[0]);
    });
    // Coming back from the browser's site settings (after unblocking).
    const onVisible = () => { if (document.visibilityState === 'visible') refreshStatus().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [userId, refreshStatus, refreshMuted, refreshJars]);

  /** Optimistic save: show it now, put it back if the server says no. */
  async function update(patch: Partial<NotificationPrefs>): Promise<boolean> {
    if (!userId) return false;
    const before = prefsRef.current;
    setPrefs({ ...before, ...patch });
    try {
      await savePrefs(userId, patch);
      return true;
    } catch {
      setPrefs(before);
      showError(navigator.onLine ? 'Could not save — please try again.' : 'You’re offline — this needs a connection to save.');
      return false;
    }
  }

  async function toggleMaster(next: boolean) {
    if (!userId || switching) return;
    setSwitching(true);
    try {
      if (next) {
        const result = await PermissionManager.enablePush(userId);
        if (result === 'on') showSuccess('Sweet Whispers are on for this device 🍬');
        else if (result === 'blocked') showInfo('Your browser is blocking notifications — follow the steps below to allow them.');
        else if (result === 'off') showInfo('No problem — turn it on whenever you like.');
        else if (result === 'failed') showError('Could not register this device. Check your connection and try again.');
      } else {
        await PermissionManager.disablePush();
        showSuccess('Whispers are off on this device. Your other devices still get them.');
      }
    } finally {
      await refreshStatus().catch(() => {});
      setSwitching(false);
    }
  }

  const home = () => setView({ name: 'home' });
  if (view.name === 'muted' && userId) {
    return <MutedChatsView t={t} userId={userId} onBack={home} onChanged={refreshMuted} />;
  }
  if (view.name === 'heartbeat' && userId) {
    return <HeartbeatView t={t} userId={userId} prefs={prefs} people={people} update={update} onBack={home} />;
  }
  if (view.name === 'jars' && userId) {
    return <JarsView t={t} userId={userId} onBack={() => { refreshJars(); home(); }} onEdit={(jar) => setView({ name: 'jar-edit', jar })} />;
  }
  if (view.name === 'jar-edit' && userId) {
    return <JarEditor t={t} userId={userId} jar={view.jar} people={people} peek={prefs.peek} onDone={() => setView({ name: 'jars' })} />;
  }

  const quietJar = jars?.find((j) => jarIsActive(j));
  const personalBeats = Object.keys(prefs.vibration_by_sender ?? {}).length;
  const jarDetail = !jars || jars.length === 0 ? 'Quiet hours with a wake-up note'
    : quietJar ? `${quietJar.name} is quiet now 🌙`
    : `${jars.length} jar${jars.length === 1 ? '' : 's'} · ${jars.filter((j) => j.enabled).length} on`;

  const copy = statusCopy(status, otherDevices);
  const canSwitch = status === 'on' || status === 'off';

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} label="Notifications" />

      {/* Live lock-screen preview */}
      <div className={`rounded-3xl p-4 space-y-3 ${t.intro}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-th-link">Sweet Whispers</span>
          <span className={`text-[10px] font-bold ${t.sub}`}>Live preview</span>
        </div>
        <LockPreview peek={prefs.peek} senderName={sampleName} off={status !== null && status !== 'on'} />
      </div>

      {/* Master switch — this device */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>This device</SectionLabel>
        <SettingRow t={t} emoji={status === 'on' ? '🔔' : status === 'blocked' ? '🚫' : status === 'ios-install' ? '📲' : '🔕'} title={copy.title} detail={copy.detail}>
          {canSwitch && (
            <Switch on={status === 'on'} onChange={toggleMaster} disabled={switching} label="Background notifications on this device" />
          )}
        </SettingRow>
        {(status === 'blocked' || status === 'ios-install') && (
          <FixSteps t={t} status={status} onRecheck={() => refreshStatus().catch(() => {})} />
        )}
      </div>

      {/* Categories — saved to the account, so they apply to every device */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>What can buzz you</SectionLabel>
        {CATEGORIES.map((c) => (
          <SettingRow key={c.key} t={t} emoji={c.emoji} title={c.title} detail={c.detail}>
            <Switch on={prefs[c.key]} onChange={(v) => update({ [c.key]: v })} label={c.title} />
          </SettingRow>
        ))}
        <SettingRow t={t} emoji="📞" title="Calls" detail="Ring you when someone calls" dim>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.chipMissing}`}>Coming soon</span>
        </SettingRow>
      </div>

      {/* Peek privacy */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>Peek privacy</SectionLabel>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What the lock screen shows">
          {PEEKS.map((p) => {
            const on = prefs.peek === p.id;
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={on}
                onClick={() => update({ peek: p.id })}
                className={`rounded-2xl p-3 text-center transition-all ${on ? t.cardSelected : t.card}`}
              >
                <span className="text-2xl block" aria-hidden="true">{p.emoji}</span>
                <span className="text-[12px] font-bold block mt-1">{p.label}</span>
                <span className={`text-[10px] block mt-0.5 leading-tight ${t.sub}`}>{p.detail}</span>
              </button>
            );
          })}
        </div>
        <p className={`text-[11px] px-1 ${t.sub}`}>🔒 Locked chats always stay secret, whatever you pick.</p>
      </div>

      {/* The sweet extras */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>Sweet extras</SectionLabel>
        <NavRow
          t={t} emoji="💓" title="Heartbeat Tap" onClick={() => setView({ name: 'heartbeat' })}
          detail={`${describePattern(prefs.vibration)}${personalBeats ? ` · ${personalBeats} personal` : ''}${canFeelHere() ? '' : ' · felt on your phone'}`}
        />
        <NavRow t={t} emoji="🌙" title="Bedtime Jars" detail={jarDetail} onClick={() => setView({ name: 'jars' })} />
        {userId && <PulseCard t={t} userId={userId} onFinished={() => refreshStatus().catch(() => {})} />}
      </div>

      {/* Muted chats */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>Quiet chats</SectionLabel>
        <NavRow
          t={t} emoji="🔕" title="Muted chats" onClick={() => setView({ name: 'muted' })}
          detail={mutedCount === null ? 'See and unmute' : mutedCount === 0 ? 'Nothing muted' : `${mutedCount} muted · see time left`}
        />
      </div>
    </TabBody>
  );
}

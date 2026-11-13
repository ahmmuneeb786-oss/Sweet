import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNotify } from '../../contexts/NotificationContext';
import { usePerformance } from '../../contexts/PerformanceContext';
import {
  clean, getChatShelf, getStorageSummary, requestPersistence, runStorageMaintenance,
  type CleanTarget, type ShelfRow, type StorageSummary,
} from '../../lib/storage/manager';
import { formatBytes, getForecast, type Forecast, type Suggestion } from '../../lib/storage/forecast';
import { getStoragePrefs, onStoragePrefsChange, setStoragePrefs } from '../../lib/storage/prefs';
import { CandyJar } from './CandyJar';
import { CleanSheet, type CleanRequest } from './CleanSheet';
import { ForecastCard } from './ForecastCard';
import { ChatJarView, KeepsakeView, ShelfView } from './MediaViews';
import { SugarDiet } from './SugarDiet';
import { CandyIcon, TabBody, TabHeader } from './parts';
import { CANDY, tokens, type AppTheme, type CandyKey, type Tokens } from './tokens';

type View =
  | { name: 'home' }
  | { name: 'shelf' }
  | { name: 'chat'; row: ShelfRow }
  | { name: 'keepsakes' }
  | { name: 'diet' };

interface StorageTabProps {
  theme: AppTheme;
  userId?: string | null;
  onBack: () => void;
}

const MB = 1024 * 1024;

/** A row in the "Candy wrappers" list — same shape as the lock tabs' LockCard. */
function WrapperCard({
  k, t, dark, title, detail, bytes, status, action, highlighted,
}: {
  k: CandyKey; t: Tokens; dark: boolean; title: string; detail: string; bytes: number | null;
  status?: { text: string; saved: boolean };
  action?: { label: string; onClick: () => void; disabled?: boolean };
  highlighted: boolean;
}) {
  return (
    <div id={`candy-${k}`} className={`rounded-2xl p-4 transition-all ${highlighted ? t.cardSelected : t.card}`}>
      <div className="flex items-center gap-3">
        <CandyIcon k={k} dark={dark} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold">{title}</h4>
          <p className={`text-[11px] mt-0.5 ${t.sub}`}>{detail}</p>
        </div>
        <p className="text-sm font-black shrink-0">{bytes === null ? '…' : formatBytes(bytes)}</p>
      </div>
      {(status || action) && (
        <div className="flex items-center justify-between gap-3 mt-3 pl-14">
          {status && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.saved ? t.chipSaved : t.chipMissing}`}>
              {status.saved && status.text === 'Protected' ? '✓ ' : ''}{status.text}
            </span>
          )}
          {action && (
            <button onClick={action.onClick} disabled={action.disabled} className={`ml-auto text-xs font-bold disabled:opacity-40 ${t.action}`}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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

export function StorageTab({ theme, userId, onBack }: StorageTabProps) {
  const t = tokens(theme);
  const dark = theme === 'dark';
  const { showSuccess, showError, showInfo } = useNotify();
  const { perfLevel } = usePerformance();

  const [view, setView] = useState<View>({ name: 'home' });
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [prefs, setPrefs] = useState(getStoragePrefs);
  const [sorting, setSorting] = useState(true);
  const [request, setRequest] = useState<CleanRequest | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [burst, setBurst] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeKey, setActiveKey] = useState<CandyKey | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const load = useCallback(async () => {
    const [s, f] = await Promise.all([getStorageSummary(), getForecast()]);
    setSummary(s);
    setForecast(f);
    setPrefs(getStoragePrefs());
  }, []);

  useEffect(() => {
    let alive = true;
    load().catch(() => {});
    // Index any photos saved before this version and tidy per Sugar Diet,
    // then refresh with accurate numbers.
    runStorageMaintenance()
      .then(() => (alive ? load() : undefined))
      .catch(() => {})
      .finally(() => alive && setSorting(false));
    const off = onStoragePrefsChange(() => {
      if (alive) load().catch(() => {});
    });
    return () => {
      alive = false;
      off();
    };
  }, [load]);

  // Sub-screens scroll to the top when opened, like the other tabs.
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    topRef.current?.closest('.overflow-y-auto')?.scrollTo({ top: 0 });
  }, [view.name]);

  const afterFreed = useCallback(
    async (r: { count: number; bytes: number }, what: string) => {
      setBurst((b) => b + 1);
      await load();
      setRefreshKey((k) => k + 1);
      // A chat's jar shows message counts from its shelf row — refresh it.
      const v = viewRef.current;
      if (v.name === 'chat') {
        const fresh = (await getChatShelf()).find((x) => x.key === v.row.key);
        if (fresh) setView((cur) => (cur.name === 'chat' && cur.row.key === fresh.key ? { name: 'chat', row: fresh } : cur));
      }
      if (r.count > 0) showSuccess(`🍬 Freed ${formatBytes(r.bytes)} · ${r.count.toLocaleString()} ${what} unwrapped`);
      else showInfo('Nothing needed unwrapping 🍬');
    },
    [load, showSuccess, showInfo]
  );

  const runClean = async (target: CleanTarget) => {
    setRequest(null);
    setCleaning(true);
    try {
      const r = await clean(target, userId);
      const what = target.kind === 'photos' ? (r.count === 1 ? 'photo' : 'photos') : r.count === 1 ? 'message' : 'messages';
      await afterFreed(r, what);
    } catch (err) {
      console.error('Storage clean failed:', err);
      showError('Something went wrong while cleaning. Please try again.');
    } finally {
      setTimeout(() => setCleaning(false), 450);
    }
  };

  const onSuggestion = async (s: Suggestion) => {
    const a = s.action;
    if (a.kind === 'autoDownload') {
      setStoragePrefs({ autoDownload: a.value });
      showSuccess(a.value === 'wifi' ? '📶 Photos now auto-download on Wi-Fi only' : 'Auto-download updated');
    } else if (a.kind === 'keepDays') {
      setView({ name: 'diet' });
    } else if (a.kind === 'cleanNeverOpened') {
      setRequest({ title: 'Unwrap never-opened photos', subtitle: 'Auto-downloaded, never looked at', target: { kind: 'photos', neverOpened: true }, filters: true });
    } else if (a.kind === 'openChat') {
      const row = (await getChatShelf()).find((r) => r.key === a.chatId);
      if (row) setView({ name: 'chat', row });
    }
  };

  const seal = async () => {
    const ok = await requestPersistence();
    await load();
    if (ok) showSuccess('🛡️ Jar sealed! Your browser will keep Sweet\'s data safe.');
    else showInfo('Your browser decides this. Installing Sweet as an app, or using it often, usually lets the jar be sealed.');
  };

  const highlight = (k: CandyKey) => {
    setActiveKey((cur) => (cur === k ? null : k));
    document.getElementById(`candy-${k}`)?.scrollIntoView({ behavior: perfLevel === 'full' ? 'smooth' : 'auto', block: 'nearest' });
  };

  const sheet = request && <CleanSheet request={request} t={t} dark={dark} onCancel={() => setRequest(null)} onConfirm={runClean} />;
  const home = () => setView({ name: 'home' });

  // --- sub-screens ---
  let screen: React.ReactNode = null;
  if (view.name === 'shelf') {
    screen = <ShelfView t={t} refreshKey={refreshKey} onBack={home} onOpenChat={(row) => setView({ name: 'chat', row })} onClean={setRequest} />;
  } else if (view.name === 'chat') {
    screen = <ChatJarView row={view.row} t={t} dark={dark} refreshKey={refreshKey} onBack={() => setView({ name: 'shelf' })} onClean={setRequest} />;
  } else if (view.name === 'keepsakes') {
    screen = <KeepsakeView t={t} refreshKey={refreshKey} onBack={home} />;
  } else if (view.name === 'diet') {
    screen = <SugarDiet t={t} onBack={home} onFreed={(r) => afterFreed(r, r.count === 1 ? 'photo' : 'photos')} />;
  }
  if (screen) {
    return (
      <div ref={topRef}>
        {screen}
        {sheet}
      </div>
    );
  }

  // --- home ---
  const s = summary;
  const layers = s
    ? [
        { key: 'other' as const, bytes: s.other },
        { key: 'photos' as const, bytes: s.photos.bytes },
        { key: 'messages' as const, bytes: s.messages.bytes },
        { key: 'waiting' as const, bytes: s.waiting.bytes },
      ]
    : [];
  const used = layers.reduce((sum, l) => sum + l.bytes, 0);
  // A full jar = the photo limit plus everything else that's stored.
  const capacity = s ? Math.max(prefs.maxPhotoMB * MB + s.other + s.messages.bytes + s.waiting.bytes, used / 0.95) : 1;
  const fullPct = s ? Math.round(Math.min(1, used / capacity) * 100) : 0;
  const free = s?.quota != null && s.usage != null ? Math.max(0, s.quota - s.usage) : null;
  const autoLabel = prefs.autoDownload === 'always' ? 'Auto-download always' : prefs.autoDownload === 'wifi' ? 'Wi-Fi only' : 'No auto-download';
  const keepLabel = prefs.keepDays === 0 ? 'keep forever' : `keep ${prefs.keepDays === 7 ? '1 week' : prefs.keepDays === 30 ? '1 month' : '3 months'}`;
  const capLabel = prefs.maxPhotoMB >= 1024 ? `${prefs.maxPhotoMB / 1024} GB` : `${prefs.maxPhotoMB} MB`;

  return (
    <div ref={topRef}>
      <TabBody t={t}>
        <TabHeader t={t} onBack={onBack} label="Storage & Media 🍬" />

        {/* Hero: the jar */}
        <div className={`p-5 rounded-3xl space-y-4 ${t.intro}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Your Candy Jar 🍬</h2>
              <p className={`text-xs leading-relaxed mt-1 ${t.sub}`}>Everything Sweet keeps on this device, one flavour at a time.</p>
            </div>
            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${sorting ? t.chipMissing : t.chipSaved}`}>
              {sorting ? 'Sorting…' : `✓ ${fullPct}% full`}
            </span>
          </div>

          <div className="grid grid-cols-[42%_1fr] gap-4 items-center">
            <CandyJar
              layers={layers}
              capacity={capacity}
              t={t}
              cleaning={cleaning}
              burst={burst}
              motion={perfLevel}
              activeKey={activeKey}
              onLayerClick={highlight}
            />
            <div className="min-w-0">
              <p className="text-3xl font-black tracking-tight text-[#FF1493]">{s ? formatBytes(used) : '…'}</p>
              <p className={`text-[10px] font-bold ${t.faint}`}>
                {free !== null ? `${formatBytes(free)} more fits on this device` : 'stored on this device'}
              </p>
              <div className="mt-2 space-y-0.5">
                {(['photos', 'messages', 'waiting', 'other'] as CandyKey[]).map((k) => {
                  const bytes = layers.find((l) => l.key === k)?.bytes ?? 0;
                  return (
                    <button
                      key={k}
                      onClick={() => highlight(k)}
                      aria-pressed={activeKey === k}
                      className={`w-full flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors ${activeKey === k ? t.iconBox : ''}`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CANDY[k].base }} />
                      <span className="text-[11px] font-bold flex-1 truncate">{CANDY[k].label}</span>
                      <span className={`text-[11px] font-bold ${t.sub}`}>{s ? formatBytes(bytes) : '–'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <p className={`text-[10px] text-center ${t.faint}`}>A full jar is your {capLabel} photo limit. Tap a flavour to find it.</p>
        </div>

        <ForecastCard forecast={forecast} t={t} onSuggestion={onSuggestion} />

        {/* Candy wrappers */}
        <div className="space-y-3">
          <p className={`${t.sectionLabel} px-1`}>Candy wrappers</p>
          <WrapperCard
            k="photos" t={t} dark={dark} highlighted={activeKey === 'photos'}
            title="Photos"
            detail={s ? `${s.photos.count.toLocaleString()} saved for offline` : 'Counting…'}
            bytes={s?.photos.bytes ?? null}
            status={s?.photos.keepsakes ? { text: `💝 ${s.photos.keepsakes} kept forever`, saved: true } : undefined}
            action={{
              label: 'Unwrap',
              disabled: !s || s.photos.count === s.photos.keepsakes,
              onClick: () => setRequest({ title: 'Unwrap photos', subtitle: 'From every chat', target: { kind: 'photos' }, filters: true }),
            }}
          />
          <WrapperCard
            k="messages" t={t} dark={dark} highlighted={activeKey === 'messages'}
            title="Message history"
            detail={s ? `${s.messages.count.toLocaleString()} messages cached for offline` : 'Counting…'}
            bytes={s?.messages.bytes ?? null}
            action={{
              label: 'Unwrap',
              disabled: !s || s.messages.count === 0,
              onClick: () => setRequest({ title: 'Unwrap message history', subtitle: 'From every chat', target: { kind: 'messages' }, filters: true }),
            }}
          />
          <WrapperCard
            k="waiting" t={t} dark={dark} highlighted={activeKey === 'waiting'}
            title="Pendings"
            detail={s?.waiting.count ? `${s.waiting.count} message${s.waiting.count === 1 ? '' : 's'} go out by themselves once you're online.` : 'Nothing waiting. Every message is delivered.'}
            bytes={s?.waiting.bytes ?? null}
            status={{ text: 'Protected', saved: true }}
          />
          <WrapperCard
            k="other" t={t} dark={dark} highlighted={activeKey === 'other'}
            title="App & Face Lock"
            detail="App files, Face Lock models and settings, so Sweet opens offline."
            bytes={s?.other ?? null}
            status={{ text: 'Protected', saved: true }}
          />
        </div>

        {/* Deeper */}
        <div className="space-y-3">
          <p className={`${t.sectionLabel} px-1`}>Manage</p>
          <NavRow t={t} emoji="🍭" title="Candy Shelf" detail="See which chats fill the jar" onClick={() => setView({ name: 'shelf' })} />
          <NavRow
            t={t} emoji="💝" title="Keepsake Box"
            detail={s?.photos.keepsakes ? `${s.photos.keepsakes} photos kept forever · ${formatBytes(s.photos.keepsakeBytes)}` : 'Heart photos so cleanup never touches them'}
            onClick={() => setView({ name: 'keepsakes' })}
          />
          <NavRow t={t} emoji="🥗" title="Sugar Diet" detail={`${autoLabel} · ${capLabel} · ${keepLabel}`} onClick={() => setView({ name: 'diet' })} />
        </div>

        {/* Seal */}
        {s && s.persisted !== null && (
          <div className={`p-4 rounded-2xl flex items-start justify-between gap-4 ${t.intro}`}>
            <div className="min-w-0">
              <h4 className="text-sm font-bold">{s.persisted ? 'Jar sealed 🛡️' : 'Seal your jar 🔐'}</h4>
              <p className={`text-[11px] mt-0.5 leading-snug ${t.sub}`}>
                {s.persisted
                  ? 'Your browser won\'t clear Sweet\'s data when the device runs low on space.'
                  : 'If the device runs low on space, the browser may clear Sweet\'s saved data on its own.'}
              </p>
            </div>
            {s.persisted ? (
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${t.chipSaved}`}>✓ Sealed</span>
            ) : (
              <button onClick={seal} className={`shrink-0 px-4 py-2 rounded-2xl text-xs font-bold ${t.primary}`}>Seal</button>
            )}
          </div>
        )}

        <p className={`text-[11px] text-center leading-relaxed px-4 ${t.faint}`}>
          Your chats live safely on Sweet's servers. Unwrapping only frees space on this device.
        </p>
      </TabBody>
      {sheet}
    </div>
  );
}

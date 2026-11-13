import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Heart, CheckCircle2, Circle, X } from 'lucide-react';
import { ChatImage } from '../ChatImage';
import { usePerformance } from '../../contexts/PerformanceContext';
import type { LocalMediaEntry } from '../../db';
import { setKeepsake } from '../../lib/mediaCache';
import { getChatPhotos, getChatShelf, getKeepsakes, PRIVATE_SHELF_KEY, type ShelfRow } from '../../lib/storage/manager';
import { formatBytes } from '../../lib/storage/forecast';
import { MiniJar } from './CandyJar';
import type { Tokens } from './tokens';
import { CandyIcon, Loading, TabBody, TabHeader } from './parts';
import type { CleanRequest } from './CleanSheet';

// Every grid tile decodes a full photo, so low-end devices get smaller pages.
const PAGE_FULL = 48;
const PAGE_LOW = 18;

// --- photo grid + viewer ---

interface PhotoGridProps {
  items: LocalMediaEntry[];
  t: Tokens;
  selecting: boolean;
  selected: Set<string>;
  onSelect: (url: string) => void;
  onKeepsake: (url: string, on: boolean) => void;
  captions?: Map<string, string>;
}

function PhotoGrid({ items, t, selecting, selected, onSelect, onKeepsake, captions }: PhotoGridProps) {
  const { isLowPerfMode } = usePerformance();
  const page = isLowPerfMode ? PAGE_LOW : PAGE_FULL;
  const [shown, setShown] = useState(page);
  const [viewing, setViewing] = useState<LocalMediaEntry | null>(null);

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        {items.slice(0, shown).map((m) => {
          const isKeep = m.keepsake === 1;
          const isSel = selected.has(m.url);
          return (
            <div key={m.url} className={`relative aspect-square rounded-xl overflow-hidden ${t.iconBox}`}>
              <button
                className="absolute inset-0 w-full h-full"
                onClick={() => (selecting ? !isKeep && onSelect(m.url) : setViewing(m))}
                aria-label={selecting ? (isKeep ? 'Keepsake, can\'t be selected' : isSel ? 'Deselect photo' : 'Select photo') : 'View photo'}
              >
                <ChatImage
                  src={m.url}
                  alt=""
                  countAsView={false}
                  className={`w-full h-full object-cover ${isSel ? 'scale-90 rounded-lg' : ''} ${selecting && isKeep ? 'opacity-40' : ''}`}
                  placeholderClassName="w-full h-full"
                />
              </button>
              <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-black/50 text-white text-[9px] font-bold pointer-events-none">
                {formatBytes(m.bytes)}
              </span>
              {captions?.get(m.url) && (
                <span className="absolute top-1 left-1 max-w-[65%] truncate px-1.5 py-0.5 rounded-full bg-black/50 text-white text-[9px] font-bold pointer-events-none">
                  {captions.get(m.url)}
                </span>
              )}
              {selecting && !isKeep ? (
                <span className="absolute top-1 right-1 pointer-events-none">
                  {isSel ? <CheckCircle2 className="w-6 h-6 text-white fill-[#FF1493]" /> : <Circle className="w-6 h-6 text-white" />}
                </span>
              ) : (
                <button
                  onClick={() => onKeepsake(m.url, !isKeep)}
                  aria-label={isKeep ? 'Remove from keepsakes' : 'Keep forever'}
                  aria-pressed={isKeep}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/35"
                >
                  <Heart className={`w-4 h-4 ${isKeep ? 'text-pink-400 fill-pink-400' : 'text-white'}`} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {items.length > shown && (
        <button onClick={() => setShown((s) => s + page)} className={`w-full py-3 rounded-2xl text-xs font-bold transition-colors ${t.secondary}`}>
          Show {Math.min(page, items.length - shown)} more
        </button>
      )}

      {viewing &&
        createPortal(
          <div className="fixed inset-0 z-[10000] bg-black/90 flex flex-col" role="dialog" aria-modal="true" aria-label="Photo">
            <div className="flex items-center justify-between p-4 text-white">
              <button onClick={() => setViewing(null)} className="p-2 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close">
                <X className="w-6 h-6" />
              </button>
              <p className="text-xs font-bold opacity-80">
                {formatBytes(viewing.bytes)}
                {viewing.saved_at > 0 && ` · saved ${new Date(viewing.saved_at).toLocaleDateString()}`}
              </p>
              <button
                onClick={() => {
                  const on = viewing.keepsake !== 1;
                  onKeepsake(viewing.url, on);
                  setViewing({ ...viewing, keepsake: on ? 1 : 0 });
                }}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20"
                aria-label={viewing.keepsake === 1 ? 'Remove from keepsakes' : 'Keep forever'}
                aria-pressed={viewing.keepsake === 1}
              >
                <Heart className={`w-6 h-6 ${viewing.keepsake === 1 ? 'text-pink-400 fill-pink-400' : 'text-white'}`} />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4 min-h-0" onClick={() => setViewing(null)}>
              <ChatImage
                src={viewing.url}
                alt="Saved photo"
                eager
                onClick={(e) => e.stopPropagation()}
                className="max-w-full max-h-full object-contain rounded-2xl"
                placeholderClassName="w-64 h-64 rounded-2xl"
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function EmptyCard({ t, emoji, title, text }: { t: Tokens; emoji: string; title: string; text: string }) {
  return (
    <div className={`rounded-2xl p-6 text-center ${t.intro}`}>
      <p className="text-3xl">{emoji}</p>
      <p className="text-sm font-bold mt-2">{title}</p>
      <p className={`text-[11px] mt-1 ${t.sub}`}>{text}</p>
    </div>
  );
}

// --- Candy Shelf (all chats) ---

interface ShelfViewProps {
  t: Tokens;
  refreshKey: number;
  onBack: () => void;
  onOpenChat: (row: ShelfRow) => void;
  onClean: (r: CleanRequest) => void;
}

export function ShelfView({ t, refreshKey, onBack, onOpenChat, onClean }: ShelfViewProps) {
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getChatShelf().then((r) => !cancelled && setRows(r)).catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const biggest = rows?.reduce((m, r) => Math.max(m, r.photoBytes + r.messageBytes), 0) || 1;

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} backLabel="Candy Jar" label="Candy Shelf 🍭" />
      <div className={`p-5 rounded-3xl ${t.intro}`}>
        <h2 className="text-lg font-black">Every chat is a jar 🍭</h2>
        <p className={`text-xs leading-relaxed mt-1 ${t.sub}`}>
          The biggest ones are at the front. Open a chat to see its photos, heart the ones to keep, or unwrap the rest.
        </p>
      </div>

      {!rows ? (
        <Loading t={t} text="Lining up the jars…" />
      ) : rows.length === 0 ? (
        <EmptyCard t={t} emoji="🍭" title="The shelf is empty" text="Nothing from your chats is stored on this device yet." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const size = r.photoBytes + r.messageBytes;
            const stats = (
              <p className={`text-[11px] mt-0.5 truncate ${t.sub}`}>
                {r.photoCount.toLocaleString()} photo{r.photoCount === 1 ? '' : 's'} · {r.messageCount.toLocaleString()} message{r.messageCount === 1 ? '' : 's'}
                {r.keepsakes > 0 && ` · 💝 ${r.keepsakes}`}
              </p>
            );
            if (r.key === PRIVATE_SHELF_KEY) {
              return (
                <div key={r.key} className={`rounded-2xl p-4 ${t.card}`}>
                  <div className="flex items-center gap-3">
                    <MiniJar ratio={size / biggest} k="messages" t={t} locked />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold truncate">{r.name}</h4>
                      {stats}
                    </div>
                    <p className="text-sm font-black shrink-0">{formatBytes(size)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3 pl-12">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.chipMissing}`}>🔒 Kept private</span>
                    <div className="flex items-center gap-3">
                      <button
                        disabled={r.photoCount === 0}
                        onClick={() => onClean({ title: 'Unwrap private photos', subtitle: 'Locked & hidden chats', target: { kind: 'photos', shelfKey: r.key }, filters: true })}
                        className={`text-xs font-bold disabled:opacity-40 ${t.action}`}
                      >
                        Photos
                      </button>
                      <button
                        disabled={r.messageCount === 0}
                        onClick={() => onClean({ title: 'Unwrap private messages', subtitle: 'Locked & hidden chats', target: { kind: 'messages', shelfKey: r.key }, filters: true })}
                        className={`text-xs font-bold disabled:opacity-40 ${t.action}`}
                      >
                        Messages
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <button key={r.key} onClick={() => onOpenChat(r)} className={`w-full text-left rounded-2xl p-4 flex items-center gap-3 transition-all ${t.card}`}>
                <MiniJar ratio={size / biggest} k={r.photoBytes >= r.messageBytes ? 'photos' : 'messages'} t={t} />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold truncate">{r.name}</h4>
                  {stats}
                </div>
                <p className="text-sm font-black shrink-0">{formatBytes(size)}</p>
                <ChevronRight className={`w-4 h-4 shrink-0 ${t.faint}`} />
              </button>
            );
          })}
        </div>
      )}
    </TabBody>
  );
}

// --- one chat's jar ---

interface ChatJarViewProps {
  row: ShelfRow;
  t: Tokens;
  dark: boolean;
  refreshKey: number;
  onBack: () => void;
  onClean: (r: CleanRequest) => void;
}

export function ChatJarView({ row, t, dark, refreshKey, onBack, onClean }: ChatJarViewProps) {
  const [photos, setPhotos] = useState<LocalMediaEntry[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getChatPhotos(row.key).then((p) => !cancelled && setPhotos(p)).catch(() => !cancelled && setPhotos([]));
    setSelected(new Set());
    setSelecting(false);
    return () => {
      cancelled = true;
    };
  }, [row.key, refreshKey]);

  const toggleKeep = async (url: string, on: boolean) => {
    setPhotos((p) => p?.map((m) => (m.url === url ? { ...m, keepsake: on ? 1 : 0 } : m)) ?? p);
    await setKeepsake(url, on, row.key);
  };
  const toggleSelect = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const photoCount = photos?.length ?? row.photoCount;
  const photoBytes = photos?.reduce((s, m) => s + m.bytes, 0) ?? row.photoBytes;
  const keepCount = photos?.filter((m) => m.keepsake === 1).length ?? row.keepsakes;
  const selectedBytes = photos?.reduce((s, m) => s + (selected.has(m.url) ? m.bytes : 0), 0) ?? 0;

  const Stat = ({ k, label, value, detail, disabled, onClick }: { k: 'photos' | 'messages'; label: string; value: string; detail: string; disabled: boolean; onClick: () => void }) => (
    <div className={`rounded-2xl p-4 ${t.card}`}>
      <div className="flex items-center gap-3">
        <CandyIcon k={k} dark={dark} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold">{label}</h4>
          <p className={`text-[11px] mt-0.5 ${t.sub}`}>{detail}</p>
        </div>
        <p className="text-sm font-black shrink-0">{value}</p>
      </div>
      <div className="flex justify-end mt-2">
        <button disabled={disabled} onClick={onClick} className={`text-xs font-bold disabled:opacity-40 ${t.action}`}>Unwrap</button>
      </div>
    </div>
  );

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} backLabel="Candy Shelf" label="Chat jar 🍭" />

      <div className={`p-5 rounded-3xl flex items-center gap-3 ${t.intro}`}>
        {row.avatar ? (
          <img src={row.avatar} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-pink-300 shrink-0" />
        ) : (
          <MiniJar ratio={1} k="photos" t={t} />
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-black truncate">{row.name}</h2>
          <p className={`text-xs ${t.sub}`}>{formatBytes(photoBytes + row.messageBytes)} on this device</p>
        </div>
      </div>

      <div className="space-y-3">
        <Stat
          k="photos" label="Photos" value={formatBytes(photoBytes)}
          detail={`${photoCount.toLocaleString()} saved${keepCount ? ` · 💝 ${keepCount} kept` : ''}`}
          disabled={photoCount === 0 || photoCount === keepCount}
          onClick={() => onClean({ title: 'Unwrap photos', subtitle: row.name, target: { kind: 'photos', shelfKey: row.key }, filters: true })}
        />
        <Stat
          k="messages" label="Message history" value={formatBytes(row.messageBytes)}
          detail={`${row.messageCount.toLocaleString()} cached for offline`}
          disabled={row.messageCount === 0}
          onClick={() => onClean({ title: 'Unwrap messages', subtitle: row.name, target: { kind: 'messages', shelfKey: row.key }, filters: true })}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className={t.sectionLabel}>Saved photos</p>
          {photos && photos.length > 0 && (
            <button
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
              className={`text-xs font-bold ${t.action}`}
            >
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
        </div>
        <p className={`text-[11px] px-1 ${t.faint}`}>Tap 🤍 to make a photo a keepsake. Keepsakes are never cleaned up.</p>

        {!photos ? (
          <Loading t={t} text="Opening the jar…" />
        ) : photos.length === 0 ? (
          <EmptyCard t={t} emoji="📷" title="No saved photos" text="No photos from this chat are stored on this device." />
        ) : (
          <PhotoGrid items={photos} t={t} selecting={selecting} selected={selected} onSelect={toggleSelect} onKeepsake={toggleKeep} />
        )}
      </div>

      {selecting && selected.size > 0 && (
        <div className="sticky bottom-4 z-10">
          <button
            onClick={() => onClean({ title: 'Unwrap selected photos', subtitle: row.name, target: { kind: 'photos', urls: [...selected] }, filters: false })}
            className={`w-full py-3.5 rounded-2xl text-xs font-bold shadow-lg shadow-pink-200/50 ${t.primary}`}
          >
            Unwrap {selected.size} selected · {formatBytes(selectedBytes)}
          </button>
        </div>
      )}
    </TabBody>
  );
}

// --- Keepsake Box ---

export function KeepsakeView({ t, refreshKey, onBack }: { t: Tokens; refreshKey: number; onBack: () => void }) {
  const [data, setData] = useState<{ visible: LocalMediaEntry[]; hidden: number; names: Map<string, string> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKeepsakes()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ visible: [], hidden: 0, names: new Map() }));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const toggle = async (url: string, on: boolean) => {
    setData((d) => (d ? { ...d, visible: d.visible.map((m) => (m.url === url ? { ...m, keepsake: on ? 1 : 0 } : m)) } : d));
    await setKeepsake(url, on);
  };

  const captions = new Map((data?.visible ?? []).map((m) => [m.url, data!.names.get(m.chat_id ?? '') ?? '']));
  const kept = data?.visible.filter((m) => m.keepsake === 1) ?? [];
  const bytes = kept.reduce((s, m) => s + m.bytes, 0);

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} backLabel="Candy Jar" label="Keepsake Box 💝" />

      <div className={`p-5 rounded-3xl space-y-3 ${t.intro}`}>
        <div>
          <h2 className="text-lg font-black">Kept forever, just for you 💝</h2>
          <p className={`text-xs leading-relaxed mt-1 ${t.sub}`}>
            Photos you've hearted. No cleanup ever removes them, not Unwrap, not your Sugar Diet limits and not auto-tidy. They stay viewable offline too.
          </p>
        </div>
        {data && (
          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${kept.length ? t.chipSaved : t.chipMissing}`}>
            {kept.length ? `✓ ${kept.length.toLocaleString()} keepsake${kept.length === 1 ? '' : 's'} · ${formatBytes(bytes)}` : 'No keepsakes yet'}
          </span>
        )}
      </div>

      {!data ? (
        <Loading t={t} text="Opening the box…" />
      ) : data.visible.length === 0 ? (
        <EmptyCard
          t={t}
          emoji="🎀"
          title="Your box is empty"
          text="Open a photo in any chat and tap 🤍, or heart one in the Candy Shelf, to keep it forever."
        />
      ) : (
        <PhotoGrid items={data.visible} t={t} selecting={false} selected={new Set()} onSelect={() => {}} onKeepsake={toggle} captions={captions} />
      )}

      {data && data.hidden > 0 && (
        <p className={`text-[11px] text-center leading-relaxed px-4 ${t.faint}`}>
          🔒 {data.hidden} more keepsake{data.hidden === 1 ? '' : 's'} from locked chats {data.hidden === 1 ? 'isn\'t' : 'aren\'t'} shown here.
        </p>
      )}
    </TabBody>
  );
}

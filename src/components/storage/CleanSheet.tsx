import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { ChatImage } from '../ChatImage';
import { usePerformance } from '../../contexts/PerformanceContext';
import { previewClean, type CleanPreview, type CleanTarget } from '../../lib/storage/manager';
import { formatBytes } from '../../lib/storage/forecast';
import type { Tokens } from './tokens';
import { CandyIcon } from './parts';

export interface CleanRequest {
  title: string;
  subtitle?: string;
  target: CleanTarget;
  /** Offer the age / never-opened filter chips. */
  filters: boolean;
}

type FilterId = 'all' | '7' | '30' | '90' | 'never';

const PHOTO_FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'never', label: 'Never opened' },
  { id: '7', label: 'Unseen 1 week+' },
  { id: '30', label: 'Unseen 1 month+' },
  { id: '90', label: 'Unseen 3 months+' },
];
const MESSAGE_FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: '30', label: 'Older than 1 month' },
  { id: '90', label: 'Older than 3 months' },
];

function applyFilter(target: CleanTarget, f: FilterId): CleanTarget {
  if (f === 'all') return target;
  if (f === 'never') return target.kind === 'photos' ? { ...target, neverOpened: true } : target;
  return { ...target, olderThanDays: Number(f) };
}

const EMPTY: CleanPreview = { count: 0, bytes: 0, keptKeepsakes: 0, keptUnsent: 0, sampleUrls: [] };

interface CleanSheetProps {
  request: CleanRequest;
  t: Tokens;
  dark: boolean;
  onCancel: () => void;
  onConfirm: (target: CleanTarget) => void;
}

export function CleanSheet({ request, t, dark, onCancel, onConfirm }: CleanSheetProps) {
  const { isLowPerfMode } = usePerformance();
  const isPhotos = request.target.kind === 'photos';
  const [filter, setFilter] = useState<FilterId>(
    request.target.kind === 'photos' && request.target.neverOpened ? 'never' : 'all'
  );
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  // The chips are the single source of truth for filters, so strip any the
  // request arrived with (e.g. "never opened" from a forecast tip).
  const base: CleanTarget =
    request.target.kind === 'photos'
      ? { ...request.target, neverOpened: undefined, olderThanDays: undefined }
      : { ...request.target, olderThanDays: undefined };
  const effective = request.filters ? applyFilter(base, filter) : request.target;
  const effectiveKey = JSON.stringify(effective);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    previewClean(effective)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(EMPTY));
    return () => {
      cancelled = true;
    };
    // effectiveKey captures every field of `effective`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  const k = isPhotos ? 'photos' : 'messages';
  const filters = isPhotos ? PHOTO_FILTERS : MESSAGE_FILTERS;
  const unit = isPhotos ? (preview?.count === 1 ? 'photo' : 'photos') : preview?.count === 1 ? 'message' : 'messages';
  // Fewer thumbnails on low-end devices: each one is a full image to decode.
  const samples = preview?.sampleUrls.slice(0, isLowPerfMode ? 3 : 5) ?? [];

  return (
    <div className="fixed inset-0 z-[9998] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        className={`sheet-up w-full max-w-sm rounded-3xl p-6 space-y-5 shadow-2xl max-h-[88vh] overflow-y-auto ${t.sheet} ${t.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <CandyIcon k={k} dark={dark} />
          <div className="min-w-0">
            <h3 className="text-lg font-black leading-tight">{request.title}</h3>
            {request.subtitle && <p className={`text-xs truncate ${t.sub}`}>{request.subtitle}</p>}
          </div>
        </div>

        {request.filters && (
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1" role="radiogroup" aria-label="Which ones">
            {filters.map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${filter === f.id ? t.pillOn : t.pill}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* What's going */}
        <div className={`rounded-2xl p-4 ${t.intro}`}>
          {!preview ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
              <p className={`text-xs font-bold ${t.sub}`}>Counting candies…</p>
            </div>
          ) : preview.count === 0 ? (
            <p className="text-sm font-bold">Nothing to unwrap here 🍬</p>
          ) : (
            <>
              <p className={t.sectionLabel}>Will be unwrapped</p>
              <p className="text-2xl font-black leading-tight mt-1">
                {formatBytes(preview.bytes)}
                <span className={`ml-2 text-xs font-bold ${t.sub}`}>{preview.count.toLocaleString()} {unit}</span>
              </p>
              {samples.length > 0 && (
                <div className="flex gap-1.5 mt-3">
                  {samples.map((u) => (
                    <div key={u} className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
                      <ChatImage src={u} alt="" eager countAsView={false} className="w-full h-full object-cover" placeholderClassName="w-full h-full" />
                    </div>
                  ))}
                  {preview.count > samples.length && (
                    <div className={`w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-[10px] font-black ${t.iconBox}`}>
                      +{(preview.count - samples.length).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* What stays */}
        {preview && (preview.keptKeepsakes > 0 || preview.keptUnsent > 0) && (
          <div className="flex flex-wrap gap-1.5 -mt-2">
            {preview.keptKeepsakes > 0 && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.chipSaved}`}>
                💝 {preview.keptKeepsakes.toLocaleString()} keepsake{preview.keptKeepsakes === 1 ? '' : 's'} stay
              </span>
            )}
            {preview.keptUnsent > 0 && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.chipSaved}`}>
                🍯 {preview.keptUnsent.toLocaleString()} unsent stay until delivered
              </span>
            )}
          </div>
        )}

        <p className={`text-[11px] leading-relaxed ${t.sub}`}>
          {isPhotos
            ? 'Photos stay safe on Sweet\'s servers and download again the next time you open them online.'
            : 'Your chats stay in the list. Messages reload when you open a chat, and the last week refills in the background.'}
        </p>

        {!online && (
          <div className="flex items-start gap-2 rounded-2xl p-3 bg-amber-50 text-amber-800 border border-amber-200">
            <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-[11px] font-semibold leading-snug">
              You're offline. Anything you unwrap now can't be seen again until you reconnect.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onCancel} className={`flex-1 py-3 rounded-2xl text-xs font-bold transition-colors ${t.secondary}`}>
            Keep them
          </button>
          <button
            onClick={() => onConfirm(effective)}
            disabled={!preview || preview.count === 0}
            className={`flex-1 py-3 rounded-2xl text-xs font-bold transition-colors disabled:opacity-50 ${t.primary}`}
          >
            {preview && preview.count > 0 ? `Unwrap ${formatBytes(preview.bytes)}` : 'Unwrap'}
          </button>
        </div>
      </div>
    </div>
  );
}

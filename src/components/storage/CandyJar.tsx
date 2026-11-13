import { useEffect, useId, useRef, useState } from 'react';
import { CANDY, type CandyKey, type Tokens } from './tokens';

export interface JarLayer {
  key: CandyKey;
  bytes: number;
}

interface CandyJarProps {
  layers: JarLayer[]; // bottom to top
  capacity: number; // bytes that make a full jar
  t: Tokens;
  cleaning: boolean; // lid lifts while a clean runs
  burst: number; // bump to throw candies out of the jar
  motion: 'full' | 'reduced' | 'minimal';
  activeKey?: CandyKey | null;
  onLayerClick?: (key: CandyKey) => void;
}

// Jar geometry (viewBox 0 0 220 260). Candy fills from FLOOR up to BRIM.
const BODY = 'M70 50 Q70 66 46 72 Q30 76 30 96 L30 222 Q30 244 52 244 L168 244 Q190 244 190 222 L190 96 Q190 76 174 72 Q150 66 150 50 Z';
const FLOOR = 244;
const BRIM = 84;
const MIN_LAYER = 5; // px — a non-empty layer is always visible

/** Animate a number toward its target (instant on minimal effects). */
function useTween(target: number, enabled: boolean, ms = 700) {
  const [value, setValue] = useState(enabled ? 0 : target);
  const fromRef = useRef(value);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      fromRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, ms]);
  return value;
}

function LayerRect({ y, h, k, uid, active, dim, onClick }: { y: number; h: number; k: CandyKey; uid: string; active: boolean; dim: boolean; onClick?: () => void }) {
  return (
    <rect
      x={0}
      y={y}
      width={220}
      height={h + 1}
      fill={`url(#${uid}-${k})`}
      opacity={dim ? 0.45 : 1}
      stroke={active ? '#fff' : 'none'}
      strokeWidth={active ? 2 : 0}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, transition: 'opacity 0.25s' }}
    />
  );
}

export function CandyJar({ layers, capacity, t, cleaning, burst, motion, activeKey, onLayerClick }: CandyJarProps) {
  const uid = useId().replace(/:/g, '');
  // Low-end devices (reduced/minimal effects) get a still jar: no fill tween
  // (a re-render per frame) and no drifting candies.
  const animate = motion === 'full';
  const total = layers.reduce((s, l) => s + l.bytes, 0);
  const fillRatio = capacity > 0 ? Math.min(1, total / capacity) : 0;
  const fillPx = useTween(fillRatio * (FLOOR - BRIM), animate);

  // Split the filled height between layers, keeping tiny ones visible.
  const nonEmpty = layers.filter((l) => l.bytes > 0);
  const raw = nonEmpty.map((l) => (total > 0 ? (l.bytes / total) * fillPx : 0));
  const boosted = raw.map((h) => (fillPx > nonEmpty.length * MIN_LAYER ? Math.max(MIN_LAYER, h) : h));
  const scale = boosted.reduce((s, h) => s + h, 0) > 0 ? fillPx / boosted.reduce((s, h) => s + h, 0) : 0;
  let cursor = FLOOR;
  const rects = nonEmpty.map((l, i) => {
    const h = boosted[i] * scale;
    cursor -= h;
    return { key: l.key, y: cursor, h };
  });
  const surface = cursor; // top of the candy pile
  const topKey = rects.length ? rects[rects.length - 1].key : null;
  const nearlyFull = fillRatio >= 0.85;

  // Candies thrown out of the jar when `burst` changes.
  const [pops, setPops] = useState<{ id: number; dx: number; rot: number; emoji: string; delay: number }[]>([]);
  const lastBurst = useRef(burst);
  useEffect(() => {
    if (burst === lastBurst.current) return;
    lastBurst.current = burst;
    if (motion === 'minimal') return;
    const emojis = ['🍬', '🍭', '🍓', '🍇', '🍩', '🍫', '🧁', '🍡'];
    const count = motion === 'reduced' ? 5 : 10;
    setPops(Array.from({ length: count }, (_, i) => ({
      id: burst * 100 + i,
      dx: Math.round((Math.random() - 0.5) * 180),
      rot: Math.round((Math.random() - 0.5) * 540),
      emoji: emojis[i % emojis.length],
      delay: Math.round(Math.random() * 180),
    })));
    const timer = setTimeout(() => setPops([]), 1400);
    return () => clearTimeout(timer);
  }, [burst, motion]);

  return (
    <div className="relative w-full select-none" style={{ aspectRatio: '220 / 260' }}>
      <svg
        viewBox="0 0 220 260"
        className={`absolute inset-0 w-full h-full overflow-visible ${nearlyFull && motion === 'full' && !cleaning ? 'jar-wobble' : ''}`}
        role="img"
        aria-label={`Candy jar ${Math.round(fillRatio * 100)}% full`}
      >
        <defs>
          <clipPath id={`${uid}-clip`}>
            <path d={BODY} />
          </clipPath>
          {(Object.keys(CANDY) as CandyKey[]).map((k) => {
            const c = CANDY[k];
            return (
              <pattern key={k} id={`${uid}-${k}`} width="30" height="24" patternUnits="userSpaceOnUse">
                <rect width="30" height="24" fill={c.base} />
                {/* round candy */}
                <circle cx="8" cy="7" r="5.5" fill={c.light} />
                <circle cx="6.5" cy="5.5" r="1.6" fill="#fff" opacity="0.7" />
                {/* wrapped candy */}
                <ellipse cx="22" cy="17" rx="5" ry="3.6" fill={c.deep} />
                <path d="M17 17 L13.5 14 L13.5 20 Z M27 17 L30.5 14 L30.5 20 Z" fill={c.deep} />
                <ellipse cx="21" cy="15.8" rx="2" ry="1" fill="#fff" opacity="0.45" />
                <circle cx="24" cy="5" r="1.3" fill="#fff" opacity="0.5" />
                <circle cx="5" cy="19" r="1.1" fill="#fff" opacity="0.4" />
              </pattern>
            );
          })}
          <pattern id={`${uid}-lid`} width="12" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="12" height="22" fill={t.lid[0]} />
            <rect width="5" height="22" fill={t.lid[1]} />
          </pattern>
          <linearGradient id={`${uid}-shine`} x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* glass */}
        <path d={BODY} fill={t.jarGlass} />

        {/* candy */}
        <g clipPath={`url(#${uid}-clip)`}>
          {rects.map((r) => (
            <LayerRect
              key={r.key}
              y={r.y}
              h={r.h}
              k={r.key}
              uid={uid}
              active={activeKey === r.key}
              dim={!!activeKey && activeKey !== r.key}
              onClick={onLayerClick ? () => onLayerClick(r.key) : undefined}
            />
          ))}
          {/* bumpy pile on top */}
          {topKey && fillPx > 6 &&
            Array.from({ length: 12 }, (_, i) => (
              <circle
                key={i}
                cx={i * 19 + 8}
                cy={surface + 1}
                r={i % 2 ? 7 : 9}
                fill={`url(#${uid}-${topKey})`}
                opacity={activeKey && activeKey !== topKey ? 0.45 : 1}
                pointerEvents="none"
              />
            ))}
          {/* drifting candies in the empty part of the jar */}
          {animate && surface - BRIM > 40 && (
            <g pointerEvents="none" opacity="0.85">
              <text x="62" y={Math.max(BRIM + 26, surface - 34)} fontSize="16" className="candy-float">🍬</text>
              <text x="132" y={Math.max(BRIM + 44, surface - 20)} fontSize="13" className="candy-float" style={{ animationDelay: '-1.1s' }}>✨</text>
              <text x="100" y={Math.max(BRIM + 14, surface - 58)} fontSize="12" className="candy-float" style={{ animationDelay: '-2.2s' }}>🍭</text>
            </g>
          )}
        </g>

        {/* glass outline + shine */}
        <path d={BODY} fill="none" stroke={t.jarStroke} strokeWidth="3.5" strokeLinejoin="round" />
        <rect x="42" y="98" width="9" height="118" rx="4.5" fill={`url(#${uid}-shine)`} pointerEvents="none" />
        <rect x="56" y="104" width="4" height="34" rx="2" fill="#fff" opacity="0.4" pointerEvents="none" />

        {/* neck + lid */}
        <rect x="66" y="40" width="88" height="14" rx="5" fill={t.jarGlass} stroke={t.jarStroke} strokeWidth="3" />
        <g className={`jar-lid ${cleaning ? 'jar-lid-open' : ''}`}>
          <rect x="56" y="16" width="108" height="26" rx="10" fill={`url(#${uid}-lid)`} stroke={t.jarStroke} strokeWidth="3" />
          <rect x="98" y="6" width="24" height="12" rx="6" fill={t.lid[0]} stroke={t.jarStroke} strokeWidth="2.5" />
        </g>
      </svg>

      {/* candy burst */}
      {pops.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-[14%]" aria-hidden="true">
          {pops.map((p) => (
            <span
              key={p.id}
              className="candy-pop absolute text-xl"
              style={{ ['--dx' as any]: `${p.dx}px`, ['--rot' as any]: `${p.rot}deg`, animationDelay: `${p.delay}ms`, left: -10 }}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tiny jar for list rows: one flavour, filled to `ratio`. */
export function MiniJar({ ratio, k, t, locked }: { ratio: number; k: CandyKey; t: Tokens; locked?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const h = Math.max(ratio > 0 ? 3 : 0, Math.min(1, ratio) * 24);
  return (
    <svg viewBox="0 0 32 40" className="w-9 h-11 shrink-0" aria-hidden="true">
      <defs>
        <clipPath id={`${uid}-c`}>
          <path d="M10 8 Q10 11 6 12 Q3 13 3 17 L3 34 Q3 37 6 37 L26 37 Q29 37 29 34 L29 17 Q29 13 26 12 Q22 11 22 8 Z" />
        </clipPath>
      </defs>
      <path d="M10 8 Q10 11 6 12 Q3 13 3 17 L3 34 Q3 37 6 37 L26 37 Q29 37 29 34 L29 17 Q29 13 26 12 Q22 11 22 8 Z" fill={t.jarGlass} />
      <g clipPath={`url(#${uid}-c)`}>
        <rect x="0" y={37 - h} width="32" height={h} fill={CANDY[k].base} />
        <circle cx="10" cy={37 - h + 4} r="2.4" fill={CANDY[k].light} />
        <circle cx="21" cy={37 - h + 6} r="2" fill={CANDY[k].light} />
      </g>
      <path d="M10 8 Q10 11 6 12 Q3 13 3 17 L3 34 Q3 37 6 37 L26 37 Q29 37 29 34 L29 17 Q29 13 26 12 Q22 11 22 8 Z" fill="none" stroke={t.jarStroke} strokeWidth="1.8" />
      <rect x="8" y="3" width="16" height="6" rx="2.5" fill={t.lid[0]} stroke={t.jarStroke} strokeWidth="1.2" />
      {locked && <text x="16" y="29" fontSize="11" textAnchor="middle">🔒</text>}
    </svg>
  );
}

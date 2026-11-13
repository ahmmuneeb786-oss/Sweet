import { formatBytes, type Forecast, type Suggestion } from '../../lib/storage/forecast';
import { CANDY, type Tokens } from './tokens';

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-24 h-8 overflow-visible" aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} opacity="0.15" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
    </svg>
  );
}

function headline(f: Forecast): { title: string; detail: string } {
  if (f.daysUntilCap === 0) {
    return {
      title: 'Your jar is at its limit 🍬',
      detail: 'New photos now take the place of the ones you looked at longest ago. Keepsakes are never swapped out.',
    };
  }
  if (f.daysOfData < 1) {
    return {
      title: 'Still tasting your habits…',
      detail: 'Give it a day of chatting and the forecast will tell you when your jar fills up.',
    };
  }
  if (f.daysUntilCap === null) {
    return { title: 'Your jar isn\'t growing 🍃', detail: 'No new photos lately, so there\'s nothing to forecast. Sweet!' };
  }
  const d = f.daysUntilCap;
  const when =
    d > 365 ? 'over a year' :
    d > 60 ? `~${Math.round(d / 30)} months` :
    d > 13 ? `~${Math.round(d / 7)} weeks` :
    `~${d} day${d === 1 ? '' : 's'}`;
  return {
    title: `Full in ${when}`,
    detail: `Photos are adding ${formatBytes(f.photoBytesPerDay)} a day toward your ${formatBytes(f.capBytes)} limit.`,
  };
}

interface ForecastCardProps {
  forecast: Forecast | null;
  t: Tokens;
  onSuggestion: (s: Suggestion) => void;
}

export function ForecastCard({ forecast, t, onSuggestion }: ForecastCardProps) {
  return (
    <div className="space-y-3">
      <p className={`${t.sectionLabel} px-1`}>🔮 Sugar Forecast</p>
      {!forecast ? (
        <div className={`rounded-2xl p-4 ${t.card}`}>
          <p className={`text-xs font-bold ${t.sub}`}>Reading the sugar crystals…</p>
        </div>
      ) : (
        <ForecastBody forecast={forecast} t={t} onSuggestion={onSuggestion} />
      )}
    </div>
  );
}

function ForecastBody({ forecast, t, onSuggestion }: { forecast: Forecast; t: Tokens; onSuggestion: (s: Suggestion) => void }) {
  const { title, detail } = headline(forecast);
  const trend = forecast.history.map((h) => h.total);
  const fill = Math.min(1, forecast.photoBytes / forecast.capBytes);

  return (
    <div className={`rounded-2xl p-4 ${t.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold leading-tight">{title}</h4>
          <p className={`text-[11px] mt-1 leading-snug ${t.sub}`}>{detail}</p>
        </div>
        {trend.length >= 2 && (
          <div className="shrink-0 text-right">
            <Sparkline values={trend} color={CANDY.photos.base} />
            <p className={`text-[9px] font-bold mt-0.5 ${t.faint}`}>last {trend.length} days</p>
          </div>
        )}
      </div>

      {/* photo limit gauge */}
      <div className="mt-3">
        <div className={`h-2 rounded-full overflow-hidden ${t.track}`}>
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${Math.max(2, fill * 100)}%`, background: `linear-gradient(90deg, ${CANDY.photos.light}, ${CANDY.photos.base})` }}
          />
        </div>
        <p className={`text-[10px] font-bold mt-1 ${t.faint}`}>
          Photos {formatBytes(forecast.photoBytes)} of {formatBytes(forecast.capBytes)}
        </p>
      </div>

      {forecast.suggestions.length > 0 && (
        <div className={`mt-3 pt-3 border-t border-dashed space-y-2 ${t.divider}`}>
          {forecast.suggestions.slice(0, 3).map((s) => (
            <div key={s.id} className="flex items-center gap-2.5">
              <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-sm ${t.iconBox}`} aria-hidden="true">{s.emoji}</div>
              <p className="text-[11px] font-semibold leading-snug flex-1">{s.text}</p>
              <button onClick={() => onSuggestion(s)} className={`shrink-0 text-xs font-bold ${t.action}`}>
                {s.actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

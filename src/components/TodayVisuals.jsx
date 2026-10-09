import polyline from '@mapbox/polyline';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { ZONES } from '../lib/zoneColors';
import { COLORS } from '../lib/palette';

// ─────────────────────────────────────────────────────────────────────────────
// Piezas gráficas de la portada (TodayView). Solo pintan: no calculan nada, así
// que lo que muestran es exactamente lo que les pasa la portada.
//
//  · Scale        — un valor sobre SU escala, con bandas de color: el lenguaje
//                   común de todas las cifras de estado de la portada.
//  · Ring         — anillo de progreso (readiness en la cabecera).
//  · WorkoutProfile — la sesión como perfil (ancho = minutos, alto = zona).
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const finite = (v) => v != null && Number.isFinite(v);

// Un valor sobre su escala. `bands` = [{ to, color }] ascendente (la última con
// to: Infinity); el tramo donde cae el valor se pinta pleno y el resto apagado.
export function Scale({ value, min, max, bands, className = '' }) {
  const tOf = (v) => clamp01((v - min) / (max - min));
  const segs = bands.map((b, i) => ({
    color: b.color,
    from: i === 0 ? min : bands[i - 1].to,
    to: Math.min(b.to, max),
  })).filter((s) => s.to > s.from);
  const has = finite(value);
  const active = has ? segs.findIndex((s) => value <= s.to || s === segs[segs.length - 1]) : -1;
  return (
    <div className={`relative h-3.5 ${className}`}>
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 flex gap-[2px]">
        {segs.map((s, i) => (
          <div
            key={i}
            className="h-full first:rounded-l-full last:rounded-r-full transition-opacity"
            style={{ width: `${(tOf(s.to) - tOf(s.from)) * 100}%`, background: s.color, opacity: !has || i === active ? 1 : 0.25 }}
          />
        ))}
      </div>
      {has && (
        <div
          className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-slate-900 ring-2 ring-white dark:bg-white dark:ring-slate-900"
          style={{ left: `${tOf(value) * 100}%` }}
        />
      )}
    </div>
  );
}

// Anillo de progreso. `children` va centrado dentro.
export function Ring({ value, max = 100, size = 120, stroke = 10, color, trackClass = 'text-slate-200 dark:text-slate-800', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const t = finite(value) ? clamp01(value / max) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className={trackClass} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - t)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// Silueta del recorrido a partir del summary_polyline de Strava. Proyección
// equirectangular con la corrección cos(lat): a escala de una carrera basta.
export function RouteShape({ encoded, className = '' }) {
  let pts = [];
  try { pts = encoded ? polyline.decode(encoded) : []; } catch { pts = []; }
  if (pts.length < 2) {
    return (
      <div className={`flex items-center justify-center rounded bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 ${className}`}>
        Sin recorrido GPS
      </div>
    );
  }
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const xy = pts.map(([lat, lng]) => [lng * k, -lat]);
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1e-6, h = Math.max(...ys) - minY || 1e-6;
  const S = 100, pad = 8, scale = (S - pad * 2) / Math.max(w, h);
  const ox = (S - w * scale) / 2, oy = (S - h * scale) / 2;
  const P = xy.map(([x, y]) => [ox + (x - minX) * scale, oy + (y - minY) * scale]);
  const d = P.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const [sx, sy] = P[0], [ex, ey] = P[P.length - 1];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className={`rounded bg-slate-50 dark:bg-slate-800/50 ${className}`} role="img" aria-label="Recorrido de la carrera">
      <path d={d} fill="none" stroke={COLORS.signal} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx} cy={sy} r="2.4" fill={COLORS.good} stroke="white" strokeWidth="0.8" />
      <circle cx={ex} cy={ey} r="2.4" fill={COLORS.ink} stroke="white" strokeWidth="0.8" />
    </svg>
  );
}

// Colores de zona (Z1…Z5) compartidos con la vista de Zonas.
const ZONE_COLORS = [1, 2, 3, 4, 5].map(z => ZONES[z].color);

// La sesión como perfil: ancho = minutos, alto = zona (1-5).
export function WorkoutProfile({ segments }) {
  const total = segments.reduce((s, sg) => s + sg.min, 0) || 1;
  return (
    <div className="flex items-end gap-[3px] h-28">
      {segments.map((sg, i) => {
        const z = Math.max(1, Math.min(5, sg.z || 1));
        return (
          <div key={i} className="h-full min-w-0 flex flex-col justify-end" style={{ width: `${(sg.min / total) * 100}%` }} title={`${sg.label} · ${sg.detail}`}>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate mb-1 px-0.5">{Math.round(sg.min)}′</span>
            <div className="rounded" style={{ height: `${18 + z * 14}%`, background: ZONE_COLORS[z - 1] }} />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate mt-1.5 px-0.5 first-letter:uppercase lowercase">{sg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Enlace a la vista donde vive el detalle de un bloque.
export function DetailLink({ onClick, children, dark = false }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 cursor-pointer ${dark
        ? 'rounded-full px-3 py-1.5 bg-white/10 text-white hover:bg-white hover:text-slate-900 transition-colors'
        : 'rounded text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300'}`}
    >
      {children}
      <ChevronRightIcon className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

// Tendencia de una serie diaria dentro de su rango, con área degradada, el
// valor de hoy marcado y una línea de referencia opcional (`refLine`).
export function TrendChart({ values, min, max, color, refLine, className = '' }) {
  const pts = (values || []).map((v, i) => [i, v]).filter(([, v]) => finite(v));
  const n = (values || []).length - 1 || 1;
  const H = 40;
  const y = (v) => H - clamp01((v - min) / (max - min)) * H;
  const xOf = (i) => ((i / n) * 100).toFixed(2);
  const line = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${xOf(i)},${y(v).toFixed(2)}`).join(' ');
  const area = pts.length > 1 ? `${line} L${xOf(pts[pts.length - 1][0])},${H} L${xOf(pts[0][0])},${H} Z` : null;
  const last = pts[pts.length - 1];
  const gid = `trend-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full h-full block overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {refLine && finite(refLine.value) && (
          <line x1="0" x2="100" y1={y(refLine.value)} y2={y(refLine.value)} stroke={COLORS.inkFaint} strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        {area && <path d={area} fill={`url(#${gid})`} />}
        {pts.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      {last && (
        <span
          className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-slate-900"
          style={{ left: `${(last[0] / n) * 100}%`, top: `${(y(last[1]) / H) * 100}%`, background: color }}
        />
      )}
      {refLine?.label && finite(refLine.value) && (
        <span className="absolute left-0 -translate-y-full pb-0.5 text-[10px] font-semibold text-slate-400" style={{ top: `${(y(refLine.value) / H) * 100}%` }}>{refLine.label}</span>
      )}
    </div>
  );
}

// Panel plano: título, enlace al detalle y cuerpo. Sin sombra ni icono: la
// jerarquía la pone la pista de arriba, no cada caja.
export function Panel({ title, sub, link, className = '', children }) {
  return (
    <section className={`flex flex-col min-w-0 rounded border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      <header className="flex items-baseline gap-2 px-4 pt-3 pb-2">
        <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        {sub && <span className="hidden sm:inline text-xs text-slate-500 truncate">{sub}</span>}
        {link && <span className="ml-auto">{link}</span>}
      </header>
      <div className="flex-1 flex flex-col px-4 pb-4 min-w-0">{children}</div>
    </section>
  );
}

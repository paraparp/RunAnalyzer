import { useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import { ChartPieIcon, ScaleIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { karvonenBounds, POLARIZED_TARGETS } from '../lib/hrZones';
import { zoneMix, polarizedGroups, polarizationStatus } from '../lib/zoneMix';
import { loadPhase, fmt1 } from '../lib/statusStats';
import useCalibratedPMC from '../hooks/useCalibratedPMC';

// ─────────────────────────────────────────────────────────────────────────────
// La franja de apertura de HOY: CÓMO se ha entrenado (reparto por zonas) y CÓMO
// está el cuerpo (carga contra la propia capacidad). Las cuatro tarjetas de
// `StatusHero` dan los números; esto da la forma que tienen.
//
// No pinta ninguna serie temporal a propósito: el dueño del PMC es Carga › PMC y
// el de la evolución por zonas es Motor › Zonas (§4 de REESTRUCTURACION_SECCIONES).
// Aquí van los dos repartos de HOY, y cada panel enlaza a su dueño.
//
// Todo sale de las fórmulas compartidas: `zoneMix` sobre los cortes de Karvonen
// —el único modelo de zonas de la app— con la FCmax y la FC de reposo de la
// calibración única, y el PMC calibrado (`useCalibratedPMC`), el mismo que el
// MCP reproduce en el servidor.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 28;

// Las cinco zonas de Karvonen, con los mismos colores que la vista de Zonas para
// que el mismo reparto no cambie de pinta según dónde se mire.
const ZONES = [
  { key: 'z1', name: 'Z1', role: 'Recuperación', color: '#94a3b8' },
  { key: 'z2', name: 'Z2', role: 'Base',         color: '#38bdf8' },
  { key: 'z3', name: 'Z3', role: 'Aeróbico',     color: '#4ade80' },
  { key: 'z4', name: 'Z4', role: 'Umbral',       color: '#fb923c' },
  { key: 'z5', name: 'Z5', role: 'VO2max',       color: '#f87171' },
];

// La lectura polarizada: Z1+Z2 fácil · Z3 gris · Z4+Z5 duro (lib/zoneMix).
const GROUPS = [
  { key: 'low',  label: 'Fácil',  sub: 'Z1–Z2', color: '#4ade80', text: 'text-emerald-600' },
  { key: 'mod',  label: 'Gris',   sub: 'Z3',    color: '#fbbf24', text: 'text-amber-600'   },
  { key: 'high', label: 'Duro',   sub: 'Z4–Z5', color: '#f87171', text: 'text-rose-600'    },
];

const VERDICT = {
  ok:   { label: '80/20 cumplido', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  gray: { label: 'Zona gris',      cls: 'bg-amber-50 text-amber-700 ring-amber-200'       },
  low:  { label: 'Falta calidad',  cls: 'bg-sky-50 text-sky-700 ring-sky-200'             },
  mod:  { label: 'Reparto mixto',  cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200'    },
};

const PHASE_CLS = {
  fit:     'bg-emerald-50 text-emerald-700 ring-emerald-200',
  build:   'bg-amber-50 text-amber-700 ring-amber-200',
  load:    'bg-orange-50 text-orange-700 ring-orange-200',
  redRisk: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const hoursStr = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}′` : `${m}′`;
};

// ─── átomos ──────────────────────────────────────────────────────────────────

function Pill({ children, cls }) {
  return <span className={`shrink-0 px-2 py-0.5 rounded-md ring-1 text-[11px] font-bold ${cls}`}>{children}</span>;
}

function PanelHead({ icon: Icon, title, scope, badge, onOpen, openLabel }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400 shrink-0" />
          <h3 className="text-sm font-bold text-slate-800 truncate">{title}</h3>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5">{scope}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge}
        {onOpen && (
          <button
            onClick={onOpen}
            className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700"
          >
            {openLabel}
            <ArrowRightIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// Barra con la escala COMPARTIDA por fitness y fatiga: las dos contra el mismo
// máximo, que es lo que hace visible el hueco entre ellas — y ese hueco es el
// TSB. Un "84/100" y un "94/110" con denominadores inventados no comparan nada.
function ScaleBar({ label, value, pct, bar, note }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className="text-xs text-slate-400">
          <span className="font-black text-slate-800 text-sm tabular-nums">{value}</span>
          {note && <span className="ml-1.5">{note}</span>}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

// ─── vista ───────────────────────────────────────────────────────────────────

export default function TodayBalance({ activities, runActivities, hrParams, onOpenZones, onOpenLoad }) {
  const { pmc } = useCalibratedPMC(activities);
  const { hrmax, hrrest } = hrParams ?? {};

  // "Ahora" estable por montaje: la ventana de 28 días no puede moverse entre
  // repintados (mismo criterio que StatusHero).
  const [nowMs] = useState(() => Date.now());

  const bounds = useMemo(
    () => (hrmax && hrrest ? karvonenBounds({ hrmax, hrrest }) : null),
    [hrmax, hrrest],
  );
  const mix = useMemo(
    () => (bounds ? zoneMix(runActivities, bounds, { days: WINDOW_DAYS, now: nowMs }) : null),
    [runActivities, bounds, nowMs],
  );

  const cur = pmc?.current ?? null;
  if (!cur && !mix?.hasData) return null;

  const groups = mix?.hasData ? polarizedGroups(mix.pct) : null;
  const verdict = groups ? VERDICT[polarizationStatus(groups.low, groups.mod, groups.high)] : null;

  const phase = cur ? loadPhase(cur.tsb) : null;
  // Escala común: el propio techo del atleta. Si la fatiga de hoy lo supera, la
  // escala crece con ella para que la barra no mienta saturándose al 100 %.
  const scale = cur ? Math.max(cur.peak, cur.ctl, cur.atl, 1) : 1;

  const acwr = cur?.acwr ?? null;
  const acwrCls = acwr == null ? 'text-slate-400'
    : acwr > 1.5 ? 'text-rose-600'
    : acwr > 1.3 ? 'text-amber-600'
    : acwr < 0.8 ? 'text-sky-600'
    : 'text-emerald-600';

  // Rampa semanal de CTL: por encima de ~7 puntos/semana es el ritmo de subida
  // que se asocia a sobrecarga.
  const ramp = cur?.ramp ?? 0;
  const rampCls = ramp > 7 ? 'text-amber-600' : ramp >= 0 ? 'text-emerald-600' : 'text-slate-500';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      {/* ── Reparto por zonas (28 d) ── */}
      <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
        <PanelHead
          icon={ChartPieIcon}
          title="Distribución de zonas"
          scope={`Últimos ${WINDOW_DAYS} días · Karvonen (HRR)${hrmax && hrrest ? ` · ${hrrest}–${hrmax} ppm` : ''}`}
          badge={verdict && <Pill cls={verdict.cls}>{verdict.label}</Pill>}
          onOpen={onOpenZones}
          openLabel="Zonas"
        />

        {!mix?.hasData ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            Sin sesiones con frecuencia cardíaca en los últimos {WINDOW_DAYS} días.
          </p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3 mb-3">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black leading-none text-emerald-600 tabular-nums">
                  {Math.round(groups.low)}%
                </span>
                <span className="text-xs font-semibold text-slate-500">fácil (Z1–Z2)</span>
              </div>
              <span className="text-[11px] text-slate-400 pb-0.5">objetivo ≥ {POLARIZED_TARGETS.low}%</span>
            </div>

            {/* Dos lecturas del mismo reparto: las cinco zonas de Karvonen y,
                debajo, su agrupación polarizada. La marca vertical es el
                objetivo de volumen fácil: el veredicto se VE, no hay que
                creerse la pastilla. */}
            <div className="relative">
              <div className="h-4 rounded-lg bg-slate-100 overflow-hidden flex">
                {ZONES.map((z, i) => (
                  <div
                    key={z.key}
                    style={{ width: `${mix.pct[i]}%`, background: z.color }}
                    title={`${z.name} ${z.role} · ${mix.pct[i]}% · ${hoursStr(mix.times[i])} · ${bounds[i].lo <= 0 ? `< ${bounds[i].hi + 1}` : bounds[i].hi >= 999 ? `≥ ${bounds[i].lo}` : `${bounds[i].lo}–${bounds[i].hi}`} ppm`}
                  />
                ))}
              </div>
              <div className="h-1.5 mt-1 rounded-full bg-slate-100 overflow-hidden flex">
                {GROUPS.map((g) => (
                  <div
                    key={g.key}
                    style={{ width: `${groups[g.key]}%`, background: g.color }}
                    title={`${g.label} (${g.sub}) · ${groups[g.key]}%`}
                  />
                ))}
              </div>
              <div
                className="absolute -top-1 bottom-0 w-px bg-slate-800/70"
                style={{ left: `${POLARIZED_TARGETS.low}%` }}
                title={`Objetivo: ${POLARIZED_TARGETS.low}% del tiempo en fácil`}
              />
            </div>

            <div className="grid grid-cols-5 gap-1.5 mt-3">
              {ZONES.map((z, i) => (
                <div key={z.key} className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: z.color }} />
                    <span className="text-[10px] font-bold text-slate-500 truncate">{z.name}</span>
                  </div>
                  <div className="text-sm font-black text-slate-700 tabular-nums leading-tight">{mix.pct[i]}%</div>
                  <div className="text-[10px] text-slate-400 tabular-nums">{hoursStr(mix.times[i])}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-3 pt-3 border-t border-slate-100">
              {GROUPS.map((g) => (
                <span key={g.key} className="text-[11px] text-slate-400">
                  {g.label} <span className={`font-black tabular-nums ${g.text}`}>{groups[g.key]}%</span>
                </span>
              ))}
              <span className="text-[10px] text-slate-300 ml-auto">
                {mix.sessions} sesiones · {hoursStr(mix.totalSec)} con FC
                {mix.avgOnlySessions > 0 && ` · ${mix.avgOnlySessions} sin parciales`}
              </span>
            </div>
          </>
        )}
      </Card>

      {/* ── Carga contra la propia capacidad ── */}
      <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
        <PanelHead
          icon={ScaleIcon}
          title="Carga y forma"
          scope="PMC Banister · TRIMP por reserva de FC"
          badge={phase && <Pill cls={PHASE_CLS[phase.key]}>{phase.label}</Pill>}
          onOpen={onOpenLoad}
          openLabel="PMC"
        />

        {!cur ? (
          <p className="text-xs text-slate-400 py-6 text-center">Aún no hay carga suficiente para el modelo.</p>
        ) : (
          <>
            <div className="space-y-3">
              <ScaleBar
                label="Forma física (CTL)"
                value={fmt1(cur.ctl)}
                pct={(cur.ctl / scale) * 100}
                bar="bg-blue-500"
                note={`${cur.pctPeak}% de tu pico ${fmt1(cur.peak)}`}
              />
              <ScaleBar
                label="Fatiga (ATL)"
                value={fmt1(cur.atl)}
                pct={(cur.atl / scale) * 100}
                bar="bg-orange-400"
                note={`${Math.round((cur.atl / scale) * 100)}% de la misma escala`}
              />
            </div>

            {/* Frescura (TSB) en escala divergente: lo que se lee es el signo y
                la distancia al cero, no el número suelto. */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-600">Frescura (TSB)</span>
                <span className="text-sm font-black text-slate-800 tabular-nums">
                  {cur.tsb >= 0 ? '+' : ''}{fmt1(cur.tsb)}
                </span>
              </div>
              {(() => {
                // La escala se abre si el TSB se sale de ±30, para que el punto
                // nunca se quede clavado en el extremo.
                const span = Math.max(30, Math.ceil(Math.abs(cur.tsb) / 10) * 10);
                const left = 50 + (Math.max(-span, Math.min(span, cur.tsb)) / span) * 50;
                return (
                  <div className="relative h-4">
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full overflow-hidden flex">
                      <div className="w-[33%] bg-rose-100"    title="Fatiga alta" />
                      <div className="w-[17%] bg-orange-100"  title="Bloque de carga" />
                      <div className="w-[25%] bg-emerald-100" title="Rango productivo" />
                      <div className="w-[25%] bg-sky-100"     title="Fresco / afinado" />
                    </div>
                    <div className="absolute top-0 bottom-0 w-px bg-slate-300" style={{ left: '50%' }} />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white ring-2 ring-slate-700 shadow"
                      style={{ left: `${left}%` }}
                      title={`TSB ${fmt1(cur.tsb)}`}
                    />
                  </div>
                );
              })()}
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>fatiga</span><span>equilibrio</span><span>fresco</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-100 text-[11px]">
              <span className="text-slate-400">
                ACWR <span className={`font-black tabular-nums ${acwrCls}`}>{acwr == null ? '—' : acwr.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                Rampa <span className={`font-black tabular-nums ${rampCls}`}>{ramp >= 0 ? '+' : ''}{fmt1(ramp)}</span> CTL/sem
              </span>
              <span className="text-slate-400">
                7 d <span className="font-black tabular-nums text-slate-600">{cur.ctlTrend7 >= 0 ? '+' : ''}{fmt1(cur.ctlTrend7)}</span>
              </span>
              <span className="text-slate-300 ml-auto hidden xl:inline">{phase?.description}</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

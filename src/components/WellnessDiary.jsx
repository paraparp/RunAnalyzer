import { useMemo, useState } from 'react';
import { PencilSquareIcon, CheckIcon } from '@heroicons/react/24/outline';
import cloudStorage from '../lib/cloudStorage';
import { toISODate } from '../lib/planSchedule';
import {
  BODY_ZONES, DIARY_EVENT, readDiary, saveEntry, painLabel, sessionRpeLoads,
} from '../lib/wellnessDiary';
import { COLORS } from '../lib/palette';

// Diario de molestias, RPE y bienestar (lib/wellnessDiary). Alimenta el índice de
// InjuryRisk, que escucha DIARY_EVENT para recalcular al guardar.

const MOOD = ['Muy bajo', 'Bajo', 'Normal', 'Bien', 'Muy bien'];
const STRESS = ['Nada', 'Poco', 'Normal', 'Alto', 'Muy alto'];

// Color de una molestia según intensidad (0-10).
const painColor = (lvl) => (lvl >= 6 ? COLORS.risk : lvl >= 3 ? COLORS.caution : lvl > 0 ? COLORS.cautionLight : COLORS.hairlineStrong);
const heatCls = (lvl) => (lvl >= 6 ? 'bg-rose-500 text-white' : lvl >= 3 ? 'bg-amber-400 text-white' : lvl > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-50 text-slate-300');

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + n));
};

// Silueta mínima (120 × 260): tronco, pelvis y dos piernas. Las zonas se
// dibujan encima como puntos clicables, en espejo para el lado contrario.
function Silhouette({ view, pains, selected, onPick }) {
  const zones = BODY_ZONES.filter((z) => z.view === view);
  const levelOf = (zone, side) => pains.find((p) => p.zone === zone && p.side === side)?.level ?? 0;
  // En la vista frontal la derecha del atleta queda a la izquierda del dibujo; en la trasera, al revés.
  const sideAt = (isLeftOfDrawing) => (view === 'front' ? (isLeftOfDrawing ? 'R' : 'L') : (isLeftOfDrawing ? 'L' : 'R'));
  return (
    <svg viewBox="0 0 120 262" className="w-full max-w-[150px]" role="group" aria-label={view === 'front' ? 'Vista frontal' : 'Vista trasera'}>
      <g fill={COLORS.hairlineSoft} stroke={COLORS.hairlineStrong} strokeWidth="1">
        <circle cx="60" cy="16" r="11" />
        <rect x="40" y="30" width="40" height="78" rx="12" />
        <rect x="38" y="104" width="44" height="24" rx="10" />
        <rect x="39" y="122" width="17" height="118" rx="8" />
        <rect x="64" y="122" width="17" height="118" rx="8" />
        <ellipse cx="45" cy="250" rx="9" ry="6" />
        <ellipse cx="75" cy="250" rx="9" ry="6" />
      </g>
      {zones.flatMap((z) => {
        const spots = z.bilateral
          ? [{ x: z.x, side: sideAt(true) }, { x: 120 - z.x, side: sideAt(false) }]
          : [{ x: z.x, side: 'C' }];
        return spots.map(({ x, side }) => {
          const lvl = levelOf(z.id, side);
          const isSel = selected?.zone === z.id && selected?.side === side;
          return (
            <g key={`${z.id}-${side}`} onClick={() => onPick({ zone: z.id, side })} className="cursor-pointer">
              <title>{painLabel({ zone: z.id, side })}{lvl ? `: ${lvl}/10` : ''}</title>
              <circle cx={x} cy={z.y} r={isSel ? 7.5 : 6} fill={painColor(lvl)} fillOpacity={lvl ? 0.9 : 0.5}
                stroke={isSel ? COLORS.signal : COLORS.paper} strokeWidth={isSel ? 2.5 : 1.5} />
              {lvl > 0 && <text x={x} y={z.y + 3} textAnchor="middle" fontSize="8" fontWeight="700" fill={COLORS.paper} pointerEvents="none">{lvl}</text>}
            </g>
          );
        });
      })}
    </svg>
  );
}

function Scale({ label, value, options, onChange }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((o, i) => {
          const v = typeof o === 'number' ? o : i + 1;
          const text = typeof o === 'number' ? o : o;
          return (
            <button
              key={v} type="button" onClick={() => onChange(value === v ? null : v)}
              className={`min-w-8 px-2 py-1 rounded-md text-xs font-semibold border ${value === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
            >{text}</button>
          );
        })}
      </div>
    </div>
  );
}

export default function WellnessDiary({ activities }) {
  const todayISO = toISODate(new Date());
  const [entries, setEntries] = useState(() => readDiary(cloudStorage));
  const [date, setDate] = useState(todayISO);
  const existing = entries.find((e) => e.date === date);
  // Borrador de la fecha elegida; se reinicia al cambiar de fecha (clave en `draftDate`).
  const [draftState, setDraftState] = useState({ date, draft: existing ?? { date, pains: [] } });
  const draft = draftState.date === date ? draftState.draft : (existing ?? { date, pains: [] });
  const setDraft = (fn) => setDraftState({ date, draft: typeof fn === 'function' ? fn(draft) : fn });
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState(false);

  const ranThatDay = useMemo(
    () => (activities || []).some((a) => (a.start_date_local || a.start_date || '').slice(0, 10) === date),
    [activities, date],
  );
  const rpeLoads = useMemo(() => sessionRpeLoads(entries, activities), [entries, activities]);

  const selLevel = selected ? draft.pains.find((p) => p.zone === selected.zone && p.side === selected.side)?.level ?? 0 : 0;
  const setLevel = (level) => {
    setSaved(false);
    setDraft((d) => ({
      ...d,
      pains: [...d.pains.filter((p) => !(p.zone === selected.zone && p.side === selected.side)), ...(level ? [{ ...selected, level }] : [])],
    }));
  };
  const setField = (k) => (v) => { setSaved(false); setDraft((d) => ({ ...d, [k]: v })); };

  const save = () => {
    const next = saveEntry(cloudStorage, { ...draft, date });
    setEntries(next);
    setSaved(true);
    window.dispatchEvent(new Event(DIARY_EVENT));
  };

  // Mapa de calor de las 2 últimas semanas: una fila por molestia anotada.
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(todayISO, i - 13));
  const recentEntries = entries.filter((e) => e.date >= days14[0]);
  const painRows = [...new Map(recentEntries.flatMap((e) => e.pains).map((p) => [`${p.zone}:${p.side}`, p])).values()];
  const levelAt = (p, d) => recentEntries.find((e) => e.date === d)?.pains.find((x) => x.zone === p.zone && x.side === p.side)?.level ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PencilSquareIcon className="w-5 h-5 text-slate-500" />
          <h3 className="text-base font-bold text-slate-900">Diario de molestias y bienestar</h3>
        </div>
        <input
          type="date" value={date} max={todayISO}
          onChange={(e) => { setDate(e.target.value || todayISO); setSelected(null); setSaved(false); }}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div>
          <div className="flex gap-3 justify-center">
            <div className="text-center"><Silhouette view="front" pains={draft.pains} selected={selected} onPick={setSelected} /><p className="text-[11px] text-slate-500">Delante</p></div>
            <div className="text-center"><Silhouette view="back" pains={draft.pains} selected={selected} onPick={setSelected} /><p className="text-[11px] text-slate-500">Detrás</p></div>
          </div>
          {selected ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-700 mb-1">{painLabel(selected)}: <span className="tabular-nums">{selLevel}/10</span></p>
              <input type="range" min="0" max="10" value={selLevel} onChange={(e) => setLevel(Number(e.target.value))} className="w-full accent-rose-500" />
              <p className="text-[11px] text-slate-500">0 nada · 3 molesta · 6 cambia la zancada · 10 no puedo correr</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500 text-center">Toca una zona para anotar dolor.</p>
          )}
        </div>

        <div className="space-y-4">
          <Scale
            label={ranThatDay ? 'RPE de la sesión (esfuerzo percibido 1-10)' : 'RPE de la sesión (ese día no hay actividad registrada)'}
            value={draft.rpe ?? null} options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} onChange={setField('rpe')}
          />
          <Scale label="Ánimo" value={draft.mood ?? null} options={MOOD} onChange={setField('mood')} />
          <Scale label="Estrés (trabajo, vida)" value={draft.stress ?? null} options={STRESS} onChange={setField('stress')} />
          <textarea
            value={draft.note ?? ''} onChange={(e) => setField('note')(e.target.value)} rows={2}
            placeholder="Notas (opcional): cuándo aparece, qué lo empeora…"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
          />
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
              Guardar {date === todayISO ? 'hoy' : date}
            </button>
            {saved && <span className="flex items-center gap-1 text-sm font-semibold text-emerald-600"><CheckIcon className="w-4 h-4" /> Guardado</span>}
            {rpeLoads[date] && (
              <span className="text-xs text-slate-500">Carga sRPE: {rpeLoads[date].rpe} × {rpeLoads[date].minutes} min = <span className="font-semibold">{rpeLoads[date].load}</span> UA</span>
            )}
          </div>
        </div>
      </div>

      {painRows.length > 0 && (
        <div className="overflow-x-auto">
          <p className="text-xs font-bold uppercase text-slate-500 mb-2">Últimas 2 semanas</p>
          <table className="text-xs">
            <thead>
              <tr>
                <th />
                {days14.map((d) => (
                  <th key={d} className="px-0.5 font-medium text-slate-400 tabular-nums">{Number(d.slice(8))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {painRows.map((p) => (
                <tr key={`${p.zone}:${p.side}`}>
                  <td className="pr-2 py-0.5 font-semibold text-slate-700 whitespace-nowrap">{painLabel(p)}</td>
                  {days14.map((d) => {
                    const lvl = levelAt(p, d);
                    return <td key={d} className="px-0.5"><div className={`w-6 h-6 rounded flex items-center justify-center font-bold tabular-nums ${heatCls(lvl)}`}>{lvl || ''}</div></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ArrowUpTrayIcon, SunIcon, BoltIcon, BeakerIcon, TrashIcon } from '@heroicons/react/24/outline';
import cloudStorage from '../lib/cloudStorage';
import { DISTANCES } from '../lib/targetRaces';
import { predictRaces } from '../lib/racePrediction';
import {
  parseCourseFile, buildCourse, compactCourse, pacePlan, raceHeat, typicalFade, timeWithFade, fuelPlan,
} from '../lib/raceStrategy';
import { fetchRaceWeather } from '../services/raceWeather';
import { formatDuration } from '../lib/timeFormat';
import { COLORS, AXIS_TICK } from '../lib/palette';

// Estrategia de la carrera objetivo (lib/raceStrategy): ritmo km a km desde el
// GPX del recorrido, calor esperado, fade habitual y avituallamiento.
// El recorrido se guarda aparte de la carrera (`race_courses`): pesa decenas de
// KB y la lista de carreras la leen el MCP y el coach.

const COURSES_KEY = 'race_courses';
const readCourses = () => {
  try { return JSON.parse(cloudStorage.getItem(COURSES_KEY) || '{}') || {}; } catch { return {}; }
};
const writeCourse = (raceId, course) => {
  const all = readCourses();
  if (course) all[raceId] = course; else delete all[raceId];
  cloudStorage.setItem(COURSES_KEY, JSON.stringify(all));
};

const pace = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

function Section({ icon: Icon, title, children, aside }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-800"><Icon className="w-4 h-4 text-slate-500" />{title}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

export default function RaceStrategy({ race, activities }) {
  const raceM = (DISTANCES[race.distance] || 0) * 1000;
  const [course, setCourse] = useState(() => readCourses()[race.id] ?? null);
  const [fileError, setFileError] = useState('');
  const fileRef = useRef(null);

  // Objetivo: el de la carrera o, si no hay, la predicción para esa distancia.
  const predicted = useMemo(
    () => predictRaces(activities).items?.find((i) => Math.abs(i.distanceM - raceM) < 50)?.timeSeconds ?? null,
    [activities, raceM],
  );
  const goalSec = race.goalTimeMin != null ? Math.round(race.goalTimeMin * 60) : predicted;
  const goalSource = race.goalTimeMin != null ? 'objetivo' : predicted ? 'predicción' : null;

  const plan = useMemo(() => (course && goalSec ? pacePlan(course, raceM, goalSec) : null), [course, raceM, goalSec]);
  const fade = useMemo(() => typicalFade(activities, raceM), [activities, raceM]);

  // Meteorología: en el punto de salida del recorrido (sin GPX no hay dónde mirar).
  const start = course?.points?.[0];
  const [weather, setWeather] = useState({ key: null, data: null, error: null });
  const weatherKey = start && race.date ? `${start.lat},${start.lng},${race.date},${race.startTime}` : null;
  useEffect(() => {
    if (!weatherKey) return undefined;
    const ctrl = new AbortController();
    fetchRaceWeather({
      lat: start.lat, lng: start.lng, date: race.date, startTime: race.startTime,
      hours: goalSec ? goalSec / 3600 : 2, signal: ctrl.signal,
    })
      .then((data) => setWeather({ key: weatherKey, data, error: null }))
      .catch((e) => { if (e.name !== 'AbortError') setWeather({ key: weatherKey, data: null, error: e.message }); });
    return () => ctrl.abort();
    // `start` cambia de identidad con el recorrido; `weatherKey` ya lo recoge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherKey, goalSec]);
  const heat = weather.key === weatherKey && weather.data ? raceHeat(weather.data, goalSec) : null;
  const fuel = goalSec ? fuelPlan(heat?.adjusted_goal_s ?? goalSec, heat?.wbgt_c ?? null, plan) : null;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError('');
    const text = await file.text();
    const c = buildCourse(parseCourseFile(text));
    if (!c) { setFileError('No se encontraron puntos de recorrido en el fichero (GPX o TCX).'); return; }
    const compact = compactCourse(c);
    writeCourse(race.id, compact);
    setCourse(compact);
  };
  const removeCourse = () => { writeCourse(race.id, null); setCourse(null); };

  const profile = course?.points?.map((p) => ({ km: +(p.d / 1000 * (raceM / course.distance_m)).toFixed(2), ele: Math.round(p.ele) })) ?? [];
  const chartData = plan ? profile.map((p) => {
    const k = plan.kms[Math.min(plan.kms.length - 1, Math.floor(p.km))];
    return { ...p, pace: k?.pace_s ?? null };
  }) : profile;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {goalSec
            ? <>Plan para <span className="font-bold text-slate-800">{formatDuration(goalSec)}</span> ({goalSource}) · ritmo medio {pace(goalSec / (raceM / 1000))}/km</>
            : 'Pon un tiempo objetivo a la carrera (o registra marcas para tener predicción) para calcular el plan de ritmo.'}
        </p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".gpx,.tcx,application/gpx+xml" className="hidden" onChange={onFile} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-700">
            <ArrowUpTrayIcon className="w-3.5 h-3.5" />{course ? 'Cambiar GPX' : 'Subir GPX del recorrido'}
          </button>
          {course && (
            <button type="button" onClick={removeCourse} title="Quitar recorrido" className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50">
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {fileError && <p className="text-xs font-semibold text-rose-600">{fileError}</p>}

      {course && (
        <Section icon={BoltIcon} title="Ritmo km a km (esfuerzo constante)"
          aside={<span className="text-xs text-slate-500">GPX {(course.distance_m / 1000).toFixed(2)} km · +{course.gain_m} / −{course.loss_m} m{!course.has_elevation ? ' · sin altitud' : ''}</span>}>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.hairlineSoft} vertical={false} />
                <XAxis dataKey="km" type="number" domain={[0, 'dataMax']} tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" km" />
                <YAxis yAxisId="ele" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={['dataMin - 10', 'dataMax + 10']} unit=" m" />
                {plan && <YAxis yAxisId="pace" orientation="right" reversed tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={pace} />}
                <Tooltip formatter={(v, n) => (n === 'pace' ? [`${pace(v)}/km`, 'Ritmo'] : [`${v} m`, 'Altitud'])} labelFormatter={(v) => `km ${v}`} />
                <Area yAxisId="ele" dataKey="ele" stroke={COLORS.inkFaint} fill={COLORS.hairline} isAnimationActive={false} />
                {plan && <Line yAxisId="pace" dataKey="pace" type="stepAfter" stroke={COLORS.signal} strokeWidth={2} dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {plan && (
            <>
              <p className="text-xs text-slate-500">
                Ritmo equivalente en llano: <span className="font-semibold text-slate-700">{pace(plan.flat_pace_s)}/km</span>. Sube con el esfuerzo, no con el reloj:
                en las cuestas el ritmo cae y en las bajadas se recupera solo.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-slate-500 text-left">
                    <tr><th className="py-1 pr-3">Km</th><th className="py-1 pr-3">Pendiente</th><th className="py-1 pr-3">D+/D−</th><th className="py-1 pr-3">Ritmo</th><th className="py-1">Paso</th></tr>
                  </thead>
                  <tbody>
                    {plan.kms.map((k) => (
                      <tr key={k.km} className="border-t border-slate-100">
                        <td className="py-1 pr-3 font-semibold">{k.km}{k.length_m < 990 ? ` (${k.length_m} m)` : ''}</td>
                        <td className={`py-1 pr-3 ${k.grade_pct > 1.5 ? 'text-rose-600' : k.grade_pct < -1.5 ? 'text-emerald-600' : 'text-slate-500'}`}>{k.grade_pct > 0 ? '+' : ''}{k.grade_pct}%</td>
                        <td className="py-1 pr-3 text-slate-500">+{k.gain_m}/−{k.loss_m}</td>
                        <td className="py-1 pr-3 font-bold text-slate-900">{pace(k.pace_s)}</td>
                        <td className="py-1 text-slate-600">{formatDuration(k.cum_s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Section icon={SunIcon} title="Calor el día de la carrera">
          {!course ? (
            <p className="text-xs text-slate-500">Sube el GPX: la previsión se pide en el punto de salida.</p>
          ) : !race.date ? (
            <p className="text-xs text-slate-500">La carrera no tiene fecha.</p>
          ) : weather.key !== weatherKey ? (
            <p className="text-xs text-slate-500">Consultando Open-Meteo…</p>
          ) : !heat ? (
            <p className="text-xs text-slate-500">Sin datos meteorológicos{weather.error ? `: ${weather.error}` : ''}.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p>
                <span className="font-bold">{heat.temp_c} °C</span> · {heat.humidity_pct}% humedad · WBGT <span className="font-bold">{heat.wbgt_c} °C</span>
                <span className="text-xs text-slate-500"> ({heat.source === 'forecast' ? 'previsión' : 'lo normal esa fecha, últimos 3 años'}, {race.startTime || '09:00'} en adelante)</span>
              </p>
              {heat.penalty_pct > 0 ? (
                <p className="text-xs text-slate-700">
                  Coste esperado del calor: <span className="font-bold text-amber-600">+{heat.penalty_pct}%</span>
                  {heat.adjusted_goal_s && <> → objetivo realista <span className="font-bold">{formatDuration(heat.adjusted_goal_s)}</span>. Sal a ese ritmo, no al de tu objetivo en fresco.</>}
                </p>
              ) : (
                <p className="text-xs text-emerald-700">Condiciones sin penalización por calor.</p>
              )}
            </div>
          )}
        </Section>

        <Section icon={BoltIcon} title="Bajada de ritmo esperada">
          {!fade ? (
            <p className="text-xs text-slate-500">Hacen falta al menos 2 tiradas largas (≥ {Math.round(Math.min(30, Math.max(12, raceM * 0.75 / 1000)))} km) con parciales en el último año.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p>
                En tus {fade.runs} tiradas largas sueles terminar el último tercio
                <span className={`font-bold ${fade.fade_pct > 3 ? 'text-rose-600' : fade.fade_pct > 0 ? 'text-amber-600' : 'text-emerald-600'}`}> {fade.fade_pct > 0 ? `${fade.fade_pct}% más lento` : `${Math.abs(fade.fade_pct)}% más rápido`}</span> que el primero (ritmo ajustado por desnivel).
              </p>
              {plan && fade.fade_pct > 1 && (
                <p className="text-xs text-slate-600">
                  Si se repite el patrón, el plan de {formatDuration(plan.kms[plan.kms.length - 1].cum_s)} acabaría en <span className="font-bold">{formatDuration(timeWithFade(plan, fade.fade_pct))}</span>.
                  Sal 2-3 s/km por encima del plan los primeros km y guarda el esfuerzo para el último tercio.
                </p>
              )}
            </div>
          )}
        </Section>
      </div>

      {fuel && (
        <Section icon={BeakerIcon} title="Avituallamiento">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">Carbohidratos</p><p className="text-sm font-bold">{fuel.carbs_g_h.lo}–{fuel.carbs_g_h.hi} g/h</p></div>
            <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">Líquido</p><p className="text-sm font-bold">{fuel.fluid_ml_h.lo}–{fuel.fluid_ml_h.hi} ml/h</p></div>
            <div className="rounded-lg bg-slate-50 p-2"><p className="text-[11px] text-slate-500">Sodio</p><p className="text-sm font-bold">{fuel.sodium_mg_h.lo}–{fuel.sodium_mg_h.hi} mg/h</p></div>
          </div>
          {fuel.gels.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-1">Geles de {fuel.gel_carbs_g} g:</p>
              <div className="flex flex-wrap gap-1.5">
                {fuel.gels.map((g, i) => (
                  <span key={i} className="px-2 py-1 rounded-md bg-amber-50 text-amber-800 text-xs font-semibold tabular-nums">
                    min {g.at_min}{g.km ? ` · km ${g.km}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          <ul className="list-disc pl-5 text-xs text-slate-600 space-y-0.5">
            {fuel.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

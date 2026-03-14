import { useMemo, useState } from 'react';
import { Card, Title, Text, Badge, Callout, Select, SelectItem } from '@tremor/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';

// ============================================================
// Daniels-Gilbert Formula (1979)
// "Oxygen Power: Performance Tables for Distance Runners"
// by Jack Daniels & Jimmy Gilbert
//
// This is the mathematical foundation of the VDOT system.
// It uses two regression equations:
// 1. Oxygen cost as a function of running velocity
// 2. Sustainable fraction of VO2max as a function of race duration
// ============================================================

/**
 * Oxygen cost of running at velocity v (ml/kg/min)
 * @param {number} v - velocity in meters per minute
 */
function oxygenCost(v) {
  return -4.60 + 0.182258 * v + 0.000104 * v * v;
}

/**
 * Fraction of VO2max sustainable for a given race duration
 * Approaches ~0.8 for very long efforts, >1.0 for very short efforts
 * @param {number} t - time in minutes
 */
function sustainableFraction(t) {
  return 0.8
    + 0.1894393 * Math.exp(-0.012778 * t)
    + 0.2989558 * Math.exp(-0.1932605 * t);
}

/**
 * Calculate VDOT from a race performance using the Daniels-Gilbert formula.
 * Valid for race durations approximately 3.5 to 230 minutes.
 * @param {number} distanceMeters
 * @param {number} timeSeconds
 * @returns {number} VDOT value
 */
function calculateVDOT(distanceMeters, timeSeconds) {
  const t = timeSeconds / 60;
  const v = distanceMeters / t;
  const vo2 = oxygenCost(v);
  const fraction = sustainableFraction(t);
  if (fraction <= 0) return null;
  const vdot = vo2 / fraction;
  return vdot > 0 ? vdot : null;
}

/**
 * Inverse of oxygenCost: get velocity (m/min) from VO2 (ml/kg/min)
 * Solves: 0.000104*v² + 0.182258*v + (-4.60 - vo2) = 0
 */
function velocityFromVO2(vo2) {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.60 - vo2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  return (-b + Math.sqrt(disc)) / (2 * a);
}

/**
 * Predict race time for a given VDOT and distance.
 * Uses bisection method since the equation is transcendental.
 * @param {number} vdot
 * @param {number} distanceMeters
 * @returns {number} predicted time in seconds
 */
function predictRaceTime(vdot, distanceMeters) {
  let lo = 60;        // 1 min
  let hi = 60 * 600;  // 10 hours

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const midVdot = calculateVDOT(distanceMeters, mid);
    if (midVdot === null || midVdot > vdot) {
      lo = mid; // too fast → increase time
    } else {
      hi = mid; // too slow → decrease time
    }
  }
  return (lo + hi) / 2;
}

/**
 * Training paces derived from %VO2max zones (Daniels' Running Formula).
 *
 * Percentages reverse-engineered from published Daniels pace tables
 * using the Daniels-Gilbert VO2-velocity quadratic:
 *   Easy:       60–68% VO2max
 *   Marathon:   74% VO2max
 *   Tempo/T:    80% VO2max
 *   Interval/I: 97% VO2max
 *   Repetition: 110% VO2max
 *
 * @param {number} vdot
 * @returns training paces in min/km
 */
function getTrainingPaces(vdot) {
  function paceMinPerKm(pct) {
    const targetVO2 = vdot * pct;
    const v = velocityFromVO2(targetVO2);
    if (v <= 0) return 0;
    return 1000 / v; // min/km
  }

  return {
    easy: { min: paceMinPerKm(0.68), max: paceMinPerKm(0.60) },
    marathon: { pace: paceMinPerKm(0.74) },
    tempo: { pace: paceMinPerKm(0.80) },
    interval: { pace: paceMinPerKm(0.97) },
    repetition: { pace: paceMinPerKm(1.10) },
  };
}

// ============================================================
// Standard race distances for detection & prediction
// ============================================================

const DISTANCE_RANGES = [
  { name: '5K', minKm: 4.9, maxKm: 5.2, distM: 5000, color: '#ef4444' },
  { name: '10K', minKm: 9.9, maxKm: 10.5, distM: 10000, color: '#f59e0b' },
  { name: 'Media Maratón', minKm: 21.0, maxKm: 21.5, distM: 21097.5, color: '#10b981' },
  { name: 'Maratón', minKm: 42.0, maxKm: 43.0, distM: 42195, color: '#6366f1' },
];

// ============================================================
// Helpers
// ============================================================

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPace(minPerKm) {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ============================================================
// Component
// ============================================================

export default function VDOTEstimator({ activities }) {
  const [timeWindow, setTimeWindow] = useState('all');
  const [hiddenSeries, setHiddenSeries] = useState({});

  const handleLegendClick = (e) => {
    if (!e || !e.dataKey) return;
    setHiddenSeries(prev => ({
      ...prev,
      [e.dataKey]: !prev[e.dataKey]
    }));
  };

  // Find best efforts at standard distances and estimate VDOT
  const vdotEstimates = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    let filtered = activities;
    if (timeWindow !== 'all') {
      const months = parseInt(timeWindow);
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      filtered = activities.filter(a => new Date(a.start_date) >= cutoff);
    }

    const estimates = [];

    DISTANCE_RANGES.forEach(range => {
      const matching = filtered
        .filter(a => {
          const km = a.distance / 1000;
          return km >= range.minKm && km <= range.maxKm;
        })
        .sort((a, b) => {
          const paceA = a.moving_time / (a.distance / 1000);
          const paceB = b.moving_time / (b.distance / 1000);
          return paceA - paceB;
        });

      if (matching.length > 0) {
        const best = matching[0];
        // Normalize time to exact standard distance
        const actualKm = best.distance / 1000;
        const pacePerKm = best.moving_time / actualKm;
        const normalizedTime = pacePerKm * (range.distM / 1000);
        const vdot = calculateVDOT(range.distM, normalizedTime);

        if (vdot && vdot >= 10 && vdot <= 95) {
          estimates.push({
            distance: range.name,
            distM: range.distM,
            time: best.moving_time,
            normalizedTime,
            date: best.start_date,
            name: best.name,
            id: best.id,
            vdot: Number(vdot.toFixed(1)),
          });
        }
      }
    });

    return estimates;
  }, [activities, timeWindow]);

  // Best VDOT estimate
  const bestVDOT = useMemo(() => {
    if (vdotEstimates.length === 0) return null;
    return vdotEstimates.reduce((best, curr) => curr.vdot > best.vdot ? curr : best);
  }, [vdotEstimates]);

  // VDOT evolution over time
  const vdotTimeline = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    const dateMap = new Map();

    activities.forEach(a => {
      const km = a.distance / 1000;
      const matchedRange = DISTANCE_RANGES.find(r => km >= r.minKm && km <= r.maxKm);
      if (!matchedRange) return;

      const pacePerKm = a.moving_time / km;
      const normalizedTime = pacePerKm * (matchedRange.distM / 1000);
      const vdot = calculateVDOT(matchedRange.distM, normalizedTime);

      if (vdot && vdot >= 10 && vdot <= 95) {
        const dateStr = a.start_date.split('T')[0];
        
        if (!dateMap.has(dateStr)) {
          dateMap.set(dateStr, {
            date: dateStr,
            sortDate: new Date(a.start_date).getTime(),
          });
        }
        
        const entry = dateMap.get(dateStr);
        const roundedVDOT = Number(vdot.toFixed(1));
        
        // Mantener la mejor estimación de VDOT para esa distancia en ese día
        if (!entry[matchedRange.name] || roundedVDOT > entry[matchedRange.name]) {
          entry[matchedRange.name] = roundedVDOT;
          entry[`id_${matchedRange.name}`] = a.id;
        }
      }
    });

    return Array.from(dateMap.values()).sort((a, b) => a.sortDate - b.sortDate);
  }, [activities]);

  // Training paces
  const trainingPaces = useMemo(() => {
    if (!bestVDOT) return null;
    return getTrainingPaces(bestVDOT.vdot);
  }, [bestVDOT]);

  // Predicted race times using the Daniels-Gilbert formula
  const predictions = useMemo(() => {
    if (!bestVDOT) return [];
    return DISTANCE_RANGES.map(r => {
      const time = predictRaceTime(bestVDOT.vdot, r.distM);
      const pace = time / (r.distM / 1000);
      return { distance: r.name, time, pace, distM: r.distM };
    });
  }, [bestVDOT]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl min-w-[140px]">
          <p className="text-xs text-slate-500 mb-2 font-medium">{label}</p>
          <div className="space-y-1.5">
            {payload.map(p => (
              <div key={p.dataKey} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: p.stroke }} />
                  <p className="text-xs font-medium text-slate-600">{p.name || p.dataKey}</p>
                </div>
                <p className="text-sm font-black tabular-nums" style={{ color: p.stroke }}>{p.value}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  if (!activities || activities.length === 0) {
    return (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold">Estimador VDOT</Title>
        <Text className="text-slate-500 mt-2">No hay actividades disponibles para analizar.</Text>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <Title className="text-slate-800 font-bold mb-1">Estimador VDOT (Daniels)</Title>
            <Text className="text-slate-500 text-sm">
              Tu índice de forma aeróbica estimado a partir de tus carreras en 5K, 10K, Media y Maratón.
              Un VDOT más alto = mejor forma. Con él se calculan tus ritmos de entrenamiento y predicciones de carrera.
            </Text>
          </div>
          <Select value={timeWindow} onValueChange={setTimeWindow} enableClear={false} className="w-40">
            <SelectItem value="all">Todo el historial</SelectItem>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Último año</SelectItem>
          </Select>
        </div>

        {bestVDOT ? (
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Big VDOT number */}
            <div className="bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl p-8 text-center min-w-[160px] shadow-lg shadow-indigo-200 flex flex-col justify-center">
              <p className="text-indigo-100 text-[10px] font-bold uppercase tracking-widest mb-1">Tu VDOT</p>
              <p className="text-5xl font-black text-white tabular-nums">{bestVDOT.vdot}</p>
              <div className="mt-3 space-y-1.5 flex flex-col items-center">
                <p className="text-indigo-200 text-[11px] leading-tight">Basado en {bestVDOT.distance}</p>
                <div className="bg-white/10 px-2 py-1 rounded w-fit border border-white/10 mt-1">
                  <p className="text-[10px] text-indigo-50 leading-tight">
                    <span className="opacity-80">Rendimiento (VO₂): </span>
                    <span className="font-bold">{bestVDOT.vdot} ml/kg/min</span>
                  </p>
                </div>
              </div>
            </div>

            {/* VDOT estimates from each distance */}
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
              {DISTANCE_RANGES.map(range => {
                const est = vdotEstimates.find(e => e.distance === range.name);
                return (
                  <div key={range.name} className={`rounded-xl border p-3 ${est ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{range.name}</p>
                    {est ? (
                      <>
                        <p className="text-lg font-bold text-slate-900 tabular-nums mt-1">{est.vdot}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatTime(est.normalizedTime)}</p>
                        <p className="text-[10px] text-slate-400">{new Date(est.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1">Sin datos</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <Callout title="Sin datos suficientes" color="amber">
            No se encontraron carreras en distancias estándar (5K, 10K, Media Maratón, Maratón) para calcular tu VDOT.
          </Callout>
        )}
      </Card>

      {/* VDOT Evolution Timeline */}
      {vdotTimeline.length > 1 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">Evolución del VDOT</Title>
          <Text className="text-slate-500 text-sm mb-4">
            Tu progresión de VDOT a lo largo del tiempo. 
            <span className="font-semibold text-indigo-500 ml-1">Haz clic en la leyenda</span> para filtrar distancias o <span className="font-semibold text-indigo-500">clic en un punto</span> para ir a la actividad en Strava.
          </Text>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vdotTimeline} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={v => {
                    const d = new Date(v);
                    return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
                  }}
                />
                <YAxis
                  domain={['dataMin - 2', 'dataMax + 2']}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  label={{ value: 'VDOT', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                />
                {bestVDOT && (
                  <ReferenceLine
                    y={bestVDOT.vdot}
                    stroke="#94a3b8"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{ value: `Mejor VDOT: ${bestVDOT.vdot}`, position: 'insideTopLeft', fill: '#64748b', fontSize: 10 }}
                  />
                )}
                <RechartsTooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px', cursor: 'pointer', userSelect: 'none' }} 
                  onClick={handleLegendClick}
                  formatter={(value, entry) => {
                    const isHidden = hiddenSeries[value];
                    return (
                      <span style={{ 
                        color: isHidden ? '#cbd5e1' : '#475569', 
                        textDecoration: isHidden ? 'line-through' : 'none', 
                        transition: 'all 0.2s',
                        marginLeft: '4px'
                      }}>
                        {value}
                      </span>
                    );
                  }}
                />
                {DISTANCE_RANGES.map(range => (
                  <Line
                    key={range.name}
                    type="monotone"
                    name={range.name}
                    dataKey={range.name}
                    stroke={range.color}
                    strokeWidth={hiddenSeries[range.name] ? 0 : 2}
                    dot={hiddenSeries[range.name] ? false : { fill: range.color, r: 4, cursor: 'pointer' }}
                    activeDot={hiddenSeries[range.name] ? false : { 
                      r: 6, 
                      fill: range.color,
                      cursor: 'pointer',
                      onClick: (e, payload) => {
                        if (payload && payload.payload) {
                          const actId = payload.payload[`id_${range.name}`];
                          if (actId) window.open(`https://www.strava.com/activities/${actId}`, '_blank', 'noopener,noreferrer');
                        }
                      }
                    }}
                    connectNulls={true}
                    hide={hiddenSeries[range.name]}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Training Paces & Predictions */}
      {bestVDOT && trainingPaces && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Training Paces */}
          <Card className="shadow-lg border-slate-200">
            <Title className="text-slate-800 font-bold mb-1">Ritmos de Entrenamiento</Title>
            <Text className="text-slate-500 text-sm mb-4">Ritmos recomendados según tu VDOT de {bestVDOT.vdot}</Text>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <div>
                  <p className="text-sm font-bold text-emerald-800">Easy / Fácil</p>
                  <p className="text-[10px] text-emerald-600">60–68% VO₂max · Carrera continua</p>
                </div>
                <p className="text-lg font-bold text-emerald-700 tabular-nums">
                  {formatPace(trainingPaces.easy.min)} - {formatPace(trainingPaces.easy.max)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-sky-50 border border-sky-100">
                <div>
                  <p className="text-sm font-bold text-sky-800">Marathon / Maratón</p>
                  <p className="text-[10px] text-sky-600">74% VO₂max · Ritmo específico maratón</p>
                </div>
                <p className="text-lg font-bold text-sky-700 tabular-nums">
                  {formatPace(trainingPaces.marathon.pace)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-100">
                <div>
                  <p className="text-sm font-bold text-amber-800">Tempo / Umbral</p>
                  <p className="text-[10px] text-amber-600">80% VO₂max · Ritmo sostenido 20–40 min</p>
                </div>
                <p className="text-lg font-bold text-amber-700 tabular-nums">
                  {formatPace(trainingPaces.tempo.pace)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50 border border-orange-100">
                <div>
                  <p className="text-sm font-bold text-orange-800">Interval / Intervalos</p>
                  <p className="text-[10px] text-orange-600">97% VO₂max · Repeticiones 3–5 min</p>
                </div>
                <p className="text-lg font-bold text-orange-700 tabular-nums">
                  {formatPace(trainingPaces.interval.pace)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 border border-rose-100">
                <div>
                  <p className="text-sm font-bold text-rose-800">Repetition / Series</p>
                  <p className="text-[10px] text-rose-600">110% VO₂max · Repeticiones 200–400m</p>
                </div>
                <p className="text-lg font-bold text-rose-700 tabular-nums">
                  {formatPace(trainingPaces.repetition.pace)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
            </div>
          </Card>

          {/* Race Predictions */}
          <Card className="shadow-lg border-slate-200">
            <Title className="text-slate-800 font-bold mb-1">Predicciones de Carrera</Title>
            <Text className="text-slate-500 text-sm mb-4">Tiempos equivalentes según VDOT {bestVDOT.vdot}</Text>
            <div className="space-y-3">
              {predictions.map(p => {
                const actual = vdotEstimates.find(e => e.distance === p.distance);
                return (
                  <div key={p.distance} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{p.distance}</p>
                      <p className="text-[10px] text-slate-400 tabular-nums">{formatPace(p.pace / 60)} /km</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-indigo-600 tabular-nums">{formatTime(p.time)}</p>
                      {actual && (
                        <p className="text-[10px] text-slate-400">
                          Actual: {formatTime(actual.normalizedTime)}
                          {actual.normalizedTime < p.time && <Badge size="xs" color="emerald" className="ml-1">Mejor</Badge>}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Formula info */}
      <Card className="shadow-lg border-slate-200">
        <div className="space-y-2">
          <Text className="text-slate-500 text-xs font-semibold">¿Qué muestra esta página?</Text>
          <Text className="text-slate-400 text-xs leading-relaxed">
            <span className="font-medium text-slate-500">① VDOT actual</span> — Tu índice de forma aeróbica (tu <span className="font-semibold text-slate-500">VO₂max funcional</span> en ml/kg/min).
            Se calcula desde tu mejor marca en cada distancia estándar. Cuanto más alto, mejor forma.
          </Text>
          <Text className="text-slate-400 text-xs leading-relaxed">
            <span className="font-medium text-slate-500">② Evolución</span> — Cómo ha cambiado tu VDOT a lo largo del tiempo, útil para ver si estás progresando.
          </Text>
          <Text className="text-slate-400 text-xs leading-relaxed">
            <span className="font-medium text-slate-500">③ Ritmos de entrenamiento</span> — Los ritmos por km recomendados para cada tipo de sesión (fácil, maratón, umbral, intervalos, series) según tu nivel actual.
          </Text>
          <Text className="text-slate-400 text-xs leading-relaxed">
            <span className="font-medium text-slate-500">④ Predicciones</span> — Los tiempos que deberías poder hacer en cada distancia con tu forma actual, según el modelo.
          </Text>
          <Text className="text-slate-400 text-[10px] leading-relaxed mt-2 border-t border-slate-100 pt-2">
            <span className="font-semibold text-slate-500">Metodología:</span> Fórmula Daniels-Gilbert (1979) · <span className="italic">Daniels' Running Formula</span>.
            Válido para esfuerzos de carrera entre ~3.5 y ~230 minutos.
          </Text>
        </div>
      </Card>
    </div>
  );
}

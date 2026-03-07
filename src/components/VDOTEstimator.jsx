import { useMemo, useState } from 'react';
import { Card, Title, Text, Badge, Callout, Select, SelectItem } from '@tremor/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// VDOT lookup table (Daniels' Running Formula approximation)
// Maps VDOT -> predicted times in seconds for standard distances
const VDOT_TABLE = [
  { vdot: 30, d5k: 1854, d10k: 3876, dHM: 8574, dM: 17880 },
  { vdot: 32, d5k: 1746, d10k: 3642, dHM: 8058, dM: 16800 },
  { vdot: 34, d5k: 1650, d10k: 3432, dHM: 7596, dM: 15840 },
  { vdot: 36, d5k: 1560, d10k: 3240, dHM: 7176, dM: 14970 },
  { vdot: 38, d5k: 1482, d10k: 3072, dHM: 6798, dM: 14178 },
  { vdot: 40, d5k: 1410, d10k: 2916, dHM: 6450, dM: 13452 },
  { vdot: 42, d5k: 1344, d10k: 2778, dHM: 6138, dM: 12792 },
  { vdot: 44, d5k: 1284, d10k: 2646, dHM: 5850, dM: 12192 },
  { vdot: 46, d5k: 1224, d10k: 2526, dHM: 5580, dM: 11628 },
  { vdot: 48, d5k: 1170, d10k: 2412, dHM: 5328, dM: 11100 },
  { vdot: 50, d5k: 1122, d10k: 2310, dHM: 5100, dM: 10620 },
  { vdot: 52, d5k: 1074, d10k: 2214, dHM: 4884, dM: 10170 },
  { vdot: 54, d5k: 1032, d10k: 2118, dHM: 4680, dM: 9744 },
  { vdot: 56, d5k: 990, d10k: 2034, dHM: 4488, dM: 9348 },
  { vdot: 58, d5k: 954, d10k: 1956, dHM: 4314, dM: 8982 },
  { vdot: 60, d5k: 918, d10k: 1878, dHM: 4146, dM: 8634 },
  { vdot: 62, d5k: 888, d10k: 1812, dHM: 3996, dM: 8316 },
  { vdot: 64, d5k: 858, d10k: 1746, dHM: 3852, dM: 8016 },
  { vdot: 66, d5k: 828, d10k: 1686, dHM: 3720, dM: 7740 },
  { vdot: 68, d5k: 804, d10k: 1632, dHM: 3600, dM: 7488 },
  { vdot: 70, d5k: 780, d10k: 1578, dHM: 3480, dM: 7236 },
  { vdot: 75, d5k: 726, d10k: 1464, dHM: 3228, dM: 6708 },
  { vdot: 80, d5k: 678, d10k: 1362, dHM: 3000, dM: 6240 },
  { vdot: 85, d5k: 636, d10k: 1272, dHM: 2802, dM: 5820 },
];

// Training paces by VDOT (min/km)
function getTrainingPaces(vdot) {
  return {
    easy: { min: 16.6667 / (vdot * 0.065), max: 16.6667 / (vdot * 0.059) },
    tempo: { pace: 16.6667 / (vdot * 0.072) },
    interval: { pace: 16.6667 / (vdot * 0.079) },
    repetition: { pace: 16.6667 / (vdot * 0.088) },
  };
}

function estimateVDOT(distanceMeters, timeSeconds) {
  const distKm = distanceMeters / 1000;

  // Determine which column to use based on distance
  let distKey;
  if (distKm >= 42 && distKm <= 43) distKey = 'dM';
  else if (distKm >= 21 && distKm <= 21.5) distKey = 'dHM';
  else if (distKm >= 9.9 && distKm <= 10.5) distKey = 'd10k';
  else if (distKm >= 4.9 && distKm <= 5.2) distKey = 'd5k';
  else return null; // Not a standard distance

  // Interpolate VDOT from table
  for (let i = 0; i < VDOT_TABLE.length - 1; i++) {
    const curr = VDOT_TABLE[i];
    const next = VDOT_TABLE[i + 1];

    if (timeSeconds <= curr[distKey] && timeSeconds >= next[distKey]) {
      const ratio = (curr[distKey] - timeSeconds) / (curr[distKey] - next[distKey]);
      return curr.vdot + ratio * (next.vdot - curr.vdot);
    }
  }

  // Outside table range
  if (timeSeconds >= VDOT_TABLE[0][distKey]) return VDOT_TABLE[0].vdot;
  if (timeSeconds <= VDOT_TABLE[VDOT_TABLE.length - 1][distKey]) return VDOT_TABLE[VDOT_TABLE.length - 1].vdot;
  return null;
}

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

function getPredictedTime(vdot, distKey) {
  for (let i = 0; i < VDOT_TABLE.length - 1; i++) {
    const curr = VDOT_TABLE[i];
    const next = VDOT_TABLE[i + 1];
    if (vdot >= curr.vdot && vdot <= next.vdot) {
      const ratio = (vdot - curr.vdot) / (next.vdot - curr.vdot);
      return curr[distKey] - ratio * (curr[distKey] - next[distKey]);
    }
  }
  if (vdot <= VDOT_TABLE[0].vdot) return VDOT_TABLE[0][distKey];
  return VDOT_TABLE[VDOT_TABLE.length - 1][distKey];
}

const DISTANCE_RANGES = [
  { name: '5K', minKm: 4.9, maxKm: 5.2, key: 'd5k', distKm: 5 },
  { name: '10K', minKm: 9.9, maxKm: 10.5, key: 'd10k', distKm: 10 },
  { name: 'Media Maratón', minKm: 21.0, maxKm: 21.5, key: 'dHM', distKm: 21.0975 },
  { name: 'Maratón', minKm: 42.0, maxKm: 43.0, key: 'dM', distKm: 42.195 },
];

export default function VDOTEstimator({ activities }) {
  const [timeWindow, setTimeWindow] = useState('all');

  // Find best efforts at standard distances and estimate VDOT from each
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
          // Best = fastest pace
          const paceA = a.moving_time / (a.distance / 1000);
          const paceB = b.moving_time / (b.distance / 1000);
          return paceA - paceB;
        });

      if (matching.length > 0) {
        const best = matching[0];
        // Normalize time to exact distance
        const actualKm = best.distance / 1000;
        const pacePerKm = best.moving_time / actualKm;
        const normalizedTime = pacePerKm * range.distKm;
        const vdot = estimateVDOT(range.distKm * 1000, normalizedTime);

        if (vdot) {
          estimates.push({
            distance: range.name,
            distKey: range.key,
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

    const results = [];

    activities.forEach(a => {
      const km = a.distance / 1000;
      const matchedRange = DISTANCE_RANGES.find(r => km >= r.minKm && km <= r.maxKm);
      if (!matchedRange) return;

      const pacePerKm = a.moving_time / km;
      const normalizedTime = pacePerKm * matchedRange.distKm;
      const vdot = estimateVDOT(matchedRange.distKm * 1000, normalizedTime);

      if (vdot) {
        results.push({
          date: a.start_date.split('T')[0],
          VDOT: Number(vdot.toFixed(1)),
          distance: matchedRange.name,
          sortDate: new Date(a.start_date).getTime(),
        });
      }
    });

    return results.sort((a, b) => a.sortDate - b.sortDate);
  }, [activities]);

  // Training paces
  const trainingPaces = useMemo(() => {
    if (!bestVDOT) return null;
    return getTrainingPaces(bestVDOT.vdot);
  }, [bestVDOT]);

  // Predicted times
  const predictions = useMemo(() => {
    if (!bestVDOT) return [];
    return DISTANCE_RANGES.map(r => {
      const time = getPredictedTime(bestVDOT.vdot, r.key);
      const pace = time / r.distKm;
      return { distance: r.name, time, pace, distKm: r.distKm };
    });
  }, [bestVDOT]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl">
          <p className="text-xs text-slate-500 mb-1">{d.date}</p>
          <p className="text-sm font-bold text-indigo-600">VDOT: {d.VDOT}</p>
          <p className="text-xs text-slate-500">{d.distance}</p>
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
              Tu VDOT estimado a partir de tus mejores marcas en distancias estándar (5K, 10K, Media, Maratón)
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
            <div className="bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl p-8 text-center min-w-[160px] shadow-lg shadow-indigo-200">
              <p className="text-indigo-100 text-[10px] font-bold uppercase tracking-widest mb-1">Tu VDOT</p>
              <p className="text-5xl font-black text-white tabular-nums">{bestVDOT.vdot}</p>
              <p className="text-indigo-200 text-[11px] mt-2">Basado en {bestVDOT.distance}</p>
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
          <Text className="text-slate-500 text-sm mb-4">Tu progresión de VDOT a lo largo del tiempo</Text>
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
                    stroke="#6366f1"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{ value: `Mejor: ${bestVDOT.vdot}`, position: 'right', fill: '#6366f1', fontSize: 11 }}
                  />
                )}
                <RechartsTooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="VDOT"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ fill: '#6366f1', r: 4 }}
                  activeDot={{ r: 6, fill: '#4f46e5' }}
                />
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
                  <p className="text-[10px] text-emerald-600">Z1-Z2 · Carrera continua</p>
                </div>
                <p className="text-lg font-bold text-emerald-700 tabular-nums">
                  {formatPace(trainingPaces.easy.max)} - {formatPace(trainingPaces.easy.min)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-100">
                <div>
                  <p className="text-sm font-bold text-amber-800">Tempo / Umbral</p>
                  <p className="text-[10px] text-amber-600">Z3 · Ritmo sostenido 20-40 min</p>
                </div>
                <p className="text-lg font-bold text-amber-700 tabular-nums">
                  {formatPace(trainingPaces.tempo.pace)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50 border border-orange-100">
                <div>
                  <p className="text-sm font-bold text-orange-800">Interval / Intervalos</p>
                  <p className="text-[10px] text-orange-600">Z4 · Repeticiones 3-5 min</p>
                </div>
                <p className="text-lg font-bold text-orange-700 tabular-nums">
                  {formatPace(trainingPaces.interval.pace)} <span className="text-xs font-medium">/km</span>
                </p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 border border-rose-100">
                <div>
                  <p className="text-sm font-bold text-rose-800">Repetition / Series</p>
                  <p className="text-[10px] text-rose-600">Z5 · Repeticiones 200-400m</p>
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
    </div>
  );
}

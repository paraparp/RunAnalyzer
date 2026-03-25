import { useMemo } from 'react';
import { Card, Title, Text } from '@tremor/react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';

function getISOWeekKey(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getRiskLevel(score) {
  if (score < 35) return { label: 'Bajo', color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' };
  if (score < 55) return { label: 'Moderado', color: '#f59e0b', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' };
  if (score < 75) return { label: 'Alto', color: '#f97316', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' };
  return { label: 'Muy Alto', color: '#ef4444', bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' };
}

export default function InjuryRisk({ activities }) {
  const { riskScore, factors, historyData, recommendations } = useMemo(() => {
    if (!activities || activities.length === 0) return { riskScore: 0, factors: [], historyData: [], recommendations: [] };

    const now = new Date();
    const sorted = [...activities].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    // --- ACWR (Acute:Chronic Workload Ratio) ---
    const dailyLoad = {};
    sorted.forEach(a => {
      const dateStr = a.start_date.split('T')[0];
      const load = a.suffer_score || (a.moving_time / 60) * 0.5;
      dailyLoad[dateStr] = (dailyLoad[dateStr] || 0) + load;
    });

    // Calculate CTL (42d) and ATL (7d)
    const allDates = [];
    const minDate = new Date(sorted[0].start_date);
    const cursor = new Date(minDate);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= now) {
      allDates.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }

    let ctl = 0, atl = 0;
    const kCTL = Math.exp(-1 / 42);
    const kATL = Math.exp(-1 / 7);
    let latestACWR = 0;

    allDates.forEach(d => {
      const load = dailyLoad[d] || 0;
      ctl = ctl * kCTL + load * (1 - kCTL);
      atl = atl * kATL + load * (1 - kATL);
      if (ctl > 0) latestACWR = atl / ctl;
    });

    // ACWR risk: sweet spot 0.8-1.3, danger >1.5
    let acwrRisk = 0;
    if (latestACWR > 1.5) acwrRisk = 90;
    else if (latestACWR > 1.3) acwrRisk = 60 + (latestACWR - 1.3) * 150;
    else if (latestACWR > 1.0) acwrRisk = 20 + (latestACWR - 1.0) * 133;
    else if (latestACWR < 0.5) acwrRisk = 30; // too little (detraining + sudden load)
    else if (latestACWR < 0.8) acwrRisk = 10;

    // --- Weekly volume progression ---
    const weeklyKm = {};
    sorted.forEach(a => {
      const key = getISOWeekKey(a.start_date);
      weeklyKm[key] = (weeklyKm[key] || 0) + (a.distance || 0) / 1000;
    });
    const weekKeys = Object.keys(weeklyKm).sort();
    const lastWeekKey = weekKeys[weekKeys.length - 1];
    const prevWeekKey = weekKeys.length > 1 ? weekKeys[weekKeys.length - 2] : null;

    const lastWeekKm = weeklyKm[lastWeekKey] || 0;
    const prevWeekKm = prevWeekKey ? weeklyKm[prevWeekKey] || 0 : 0;
    const weeklyChange = prevWeekKm > 0 ? ((lastWeekKm - prevWeekKm) / prevWeekKm) * 100 : 0;

    let volumeRisk = 0;
    if (weeklyChange > 30) volumeRisk = 80;
    else if (weeklyChange > 20) volumeRisk = 50;
    else if (weeklyChange > 10) volumeRisk = 25;
    else if (weeklyChange < -30) volumeRisk = 15; // sudden drop can also be risky on return

    // --- Rest days ---
    const last14 = allDates.slice(-14);
    const last7 = allDates.slice(-7);
    const restDays7 = last7.filter(d => !dailyLoad[d]).length;
    const restDays14 = last14.filter(d => !dailyLoad[d]).length;

    let restRisk = 0;
    if (restDays7 === 0) restRisk = 70; // no rest in a week
    else if (restDays7 === 1) restRisk = 30;
    else if (restDays14 <= 2) restRisk = 40;
    else restRisk = Math.max(0, 20 - restDays7 * 8);

    // --- Monotony (std dev of daily load in last 7 days) ---
    const last7Loads = last7.map(d => dailyLoad[d] || 0);
    const meanLoad7 = last7Loads.reduce((s, v) => s + v, 0) / 7;
    const variance = last7Loads.reduce((s, v) => s + Math.pow(v - meanLoad7, 2), 0) / 7;
    const stdDev = Math.sqrt(variance);
    const monotony = stdDev > 0 ? meanLoad7 / stdDev : 0;

    let monotonyRisk = 0;
    if (monotony > 2.0) monotonyRisk = 60;
    else if (monotony > 1.5) monotonyRisk = 35;
    else if (monotony > 1.0) monotonyRisk = 15;

    // --- Strain ---
    const weeklyLoadTotal = last7Loads.reduce((s, v) => s + v, 0);
    const strain = weeklyLoadTotal * monotony;
    let strainRisk = 0;
    if (strain > 3000) strainRisk = 70;
    else if (strain > 2000) strainRisk = 40;
    else if (strain > 1000) strainRisk = 15;

    // --- Composite score ---
    const weights = { acwr: 0.30, volume: 0.25, rest: 0.20, monotony: 0.10, strain: 0.15 };
    const composite = Math.round(
      acwrRisk * weights.acwr +
      volumeRisk * weights.volume +
      restRisk * weights.rest +
      monotonyRisk * weights.monotony +
      strainRisk * weights.strain
    );
    const finalScore = Math.min(100, Math.max(0, composite));

    const factorsList = [
      { name: 'ACWR', value: Math.round(latestACWR * 100) / 100, risk: Math.round(acwrRisk), weight: '30%', detail: latestACWR > 1.3 ? `Ratio ${latestACWR.toFixed(2)} — carga aguda muy superior a crónica` : `Ratio ${latestACWR.toFixed(2)} — en zona segura` },
      { name: 'Volumen semanal', value: `${weeklyChange > 0 ? '+' : ''}${Math.round(weeklyChange)}%`, risk: Math.round(volumeRisk), weight: '25%', detail: weeklyChange > 10 ? `Incremento de ${Math.round(weeklyChange)}% vs semana anterior (regla: max 10%)` : 'Progresión controlada' },
      { name: 'Descanso', value: `${restDays7}d / 7d`, risk: Math.round(restRisk), weight: '20%', detail: restDays7 <= 1 ? 'Insuficiente descanso esta semana' : `${restDays7} días de descanso esta semana` },
      { name: 'Monotonía', value: monotony.toFixed(1), risk: Math.round(monotonyRisk), weight: '10%', detail: monotony > 1.5 ? 'Distribución de carga poco variada' : 'Buena variación en la carga diaria' },
      { name: 'Strain', value: Math.round(strain), risk: Math.round(strainRisk), weight: '15%', detail: `Carga semanal × monotonía = ${Math.round(strain)}` },
    ];

    // --- Recommendations ---
    const recs = [];
    if (latestACWR > 1.3) recs.push('Reduce la intensidad esta semana. Tu carga aguda supera significativamente la crónica.');
    if (weeklyChange > 10) recs.push(`Has aumentado el volumen un ${Math.round(weeklyChange)}%. Intenta no superar el 10% semanal.`);
    if (restDays7 <= 1) recs.push('Necesitas más días de descanso. Considera al menos 2 días de reposo por semana.');
    if (monotony > 1.5) recs.push('Varía más tus sesiones. Alterna días duros y suaves para reducir la monotonía.');
    if (finalScore < 35) recs.push('Tu riesgo de lesión es bajo. Buen trabajo manteniendo el equilibrio entre carga y descanso.');

    // --- History (weekly risk scores) ---
    const history = [];
    const weeksForHistory = weekKeys.slice(-16);
    weeksForHistory.forEach((weekKey, wIdx) => {
      // Simplified weekly risk based on volume change
      const wKm = weeklyKm[weekKey] || 0;
      const prevKey = wIdx > 0 ? weeksForHistory[wIdx - 1] : null;
      const prevKm = prevKey ? weeklyKm[prevKey] || 0 : wKm;
      const change = prevKm > 0 ? ((wKm - prevKm) / prevKm) * 100 : 0;

      // Simple composite for history
      const volR = change > 30 ? 80 : change > 20 ? 50 : change > 10 ? 25 : 0;
      const simpleScore = Math.min(100, Math.max(0, Math.round(volR * 0.6 + (wKm > 0 ? 10 : 0))));

      const parts = weekKey.split('-W');
      history.push({
        week: `S${parts[1]}`,
        risk: simpleScore,
        km: Math.round(wKm * 10) / 10,
        change: Math.round(change),
      });
    });

    return { riskScore: finalScore, factors: factorsList, historyData: history, recommendations: recs };
  }, [activities]);

  const level = getRiskLevel(riskScore);

  if (!activities || activities.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">No hay datos suficientes para evaluar el riesgo de lesión.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main risk gauge */}
      <div className={`${level.bg} ${level.border} border rounded-2xl p-6 text-center`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Riesgo de Lesión Actual</p>
        <div className="relative inline-flex items-center justify-center">
          <svg width="180" height="100" viewBox="0 0 180 100">
            {/* Background arc */}
            <path d="M 15 90 A 75 75 0 0 1 165 90" fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
            {/* Risk arc */}
            <path
              d="M 15 90 A 75 75 0 0 1 165 90"
              fill="none"
              stroke={level.color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${(riskScore / 100) * 236} 236`}
            />
          </svg>
          <div className="absolute bottom-0">
            <p className="text-4xl font-black tabular-nums" style={{ color: level.color }}>{riskScore}</p>
          </div>
        </div>
        <p className={`text-lg font-bold mt-2 ${level.text}`}>{level.label}</p>
        <p className="text-xs text-slate-500 mt-1">Score compuesto basado en 5 factores de riesgo</p>
      </div>

      {/* Traffic light bar */}
      <div className="relative h-6 rounded-full overflow-hidden bg-slate-100">
        <div className="absolute inset-0 flex">
          <div className="flex-1 bg-emerald-400 opacity-30" />
          <div className="flex-1 bg-amber-400 opacity-30" />
          <div className="flex-1 bg-orange-400 opacity-30" />
          <div className="flex-1 bg-rose-400 opacity-30" />
        </div>
        <div
          className="absolute top-0 bottom-0 w-1 bg-slate-900 rounded"
          style={{ left: `${riskScore}%`, transform: 'translateX(-50%)' }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-3 text-[9px] font-bold text-slate-600">
          <span>Bajo</span>
          <span>Moderado</span>
          <span>Alto</span>
          <span>Muy Alto</span>
        </div>
      </div>

      {/* Factor breakdown */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-4">Desglose de Factores</Title>
        <div className="space-y-3">
          {factors.map(f => {
            const fLevel = getRiskLevel(f.risk);
            return (
              <div key={f.name} className="flex items-center gap-3">
                <div className="w-28 shrink-0">
                  <p className="text-xs font-semibold text-slate-700">{f.name}</p>
                  <p className="text-[10px] text-slate-400">Peso: {f.weight}</p>
                </div>
                <div className="flex-1">
                  <div className="h-5 bg-slate-100 rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${f.risk}%`, backgroundColor: fLevel.color }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">
                      {f.value}
                    </span>
                  </div>
                </div>
                <div className="w-8 text-right">
                  <span className="text-xs font-bold" style={{ color: fLevel.color }}>{f.risk}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 space-y-1">
          {factors.map(f => (
            <p key={f.name} className="text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">{f.name}:</span> {f.detail}
            </p>
          ))}
        </div>
      </Card>

      {/* Risk history */}
      {historyData.length > 2 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">Historial de Riesgo</Title>
          <Text className="text-slate-500 text-sm mb-4">Score de riesgo simplificado por semana (basado en progresión de volumen)</Text>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <RechartsTooltip
                  formatter={(val, name) => {
                    if (name === 'risk') return [`${val}`, 'Riesgo'];
                    if (name === 'km') return [`${val} km`, 'Volumen'];
                    return [val, name];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <ReferenceArea y1={0} y2={35} fill="#10b981" fillOpacity={0.06} />
                <ReferenceArea y1={35} y2={55} fill="#f59e0b" fillOpacity={0.06} />
                <ReferenceArea y1={55} y2={75} fill="#f97316" fillOpacity={0.06} />
                <ReferenceArea y1={75} y2={100} fill="#ef4444" fillOpacity={0.06} />
                <Line type="monotone" dataKey="risk" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card className={`shadow-lg ${level.border} ${level.bg}`}>
          <Title className="text-slate-800 font-bold mb-3">Recomendaciones</Title>
          <ul className="space-y-2">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-0.5 shrink-0">
                  {riskScore < 35 ? '✓' : '⚠'}
                </span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Guide */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Metodología</Title>
        <div className="text-sm text-slate-600 space-y-2">
          <p>El score de riesgo combina 5 factores respaldados por la investigación en ciencias del deporte:</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li><span className="font-semibold">ACWR (30%)</span> — Ratio de carga aguda (7d) vs crónica (42d). Zona segura: 0.8-1.3.</li>
            <li><span className="font-semibold">Volumen semanal (25%)</span> — Cambio de km respecto a la semana anterior. Regla del 10%.</li>
            <li><span className="font-semibold">Descanso (20%)</span> — Días sin actividad en los últimos 7 días. Mínimo 1-2 días.</li>
            <li><span className="font-semibold">Monotonía (10%)</span> — Variabilidad de la carga diaria. Más variación = menos riesgo.</li>
            <li><span className="font-semibold">Strain (15%)</span> — Carga total × monotonía. Valores altos indican sobreentrenamiento.</li>
          </ul>
          <p className="text-xs text-slate-400 mt-2">Este modelo es orientativo y no sustituye el consejo médico profesional.</p>
        </div>
      </Card>
    </div>
  );
}

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text } from '@tremor/react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';
import { 
  ShieldExclamationIcon, 
  ShieldCheckIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

function getISOWeekKey(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getRiskLevel(score, t) {
  if (score < 35) return { label: t('injury.risk_levels.low'), color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' };
  if (score < 55) return { label: t('injury.risk_levels.moderate'), color: '#f59e0b', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' };
  if (score < 75) return { label: t('injury.risk_levels.high'), color: '#f97316', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' };
  return { label: t('injury.risk_levels.very_high'), color: '#ef4444', bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' };
}

export default function InjuryRisk({ activities }) {
  const { t, i18n } = useTranslation();
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
      { name: t('injury.factors.acwr'), value: Math.round(latestACWR * 100) / 100, risk: Math.round(acwrRisk), weight: '30%', detail: latestACWR > 1.3 ? t('fitness.acwr_status.caution_desc') : t('fitness.acwr_status.optimal_desc') },
      { name: t('injury.factors.volume'), value: `${weeklyChange > 0 ? '+' : ''}${Math.round(weeklyChange)}%`, risk: Math.round(volumeRisk), weight: '25%', detail: weeklyChange > 10 ? t('injury.factors.rule_10') + ': ' + Math.round(weeklyChange) + '%' : t('fitness.ramp_labels.safe') },
      { name: t('injury.factors.rest'), value: `${restDays7}d / 7d`, risk: Math.round(restRisk), weight: '20%', detail: restDays7 <= 1 ? t('fitness.status.overloaded_desc') : `${restDays7} ${t('injury.factors.rest').toLowerCase()}` },
      { name: t('injury.factors.monotony'), value: monotony.toFixed(1), risk: Math.round(monotonyRisk), weight: '10%', detail: monotony > 1.5 ? t('fitness.status.loaded_desc') : t('fitness.status.optimal_desc') },
      { name: t('injury.factors.strain'), value: Math.round(strain), risk: Math.round(strainRisk), weight: '15%', detail: `${t('injury.factors.strain')} = ${Math.round(strain)}` },
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
  }, [activities, t]);

  const level = getRiskLevel(riskScore, t);

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
      {/* Main risk gauge */}
      <div className={`bg-white rounded-3xl border border-slate-100 p-8 shadow-xl shadow-slate-200/50 relative overflow-hidden group`}>
        <div className="absolute top-0 right-0 p-8 opacity-5 transition-transform group-hover:scale-110">
           <ShieldExclamationIcon className="w-32 h-32 text-slate-900" />
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-10 relative z-10">
          <div className="relative inline-flex flex-col items-center">
            <svg width="220" height="120" viewBox="0 0 220 120" className="drop-shadow-sm">
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="#f1f5f9" strokeWidth="16" strokeLinecap="round" />
              <path
                d="M 20 110 A 90 90 0 0 1 200 110"
                fill="none"
                stroke={level.color}
                strokeWidth="16"
                strokeLinecap="round"
                strokeDasharray={`${(riskScore / 100) * 282} 282`}
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute bottom-2 text-center">
              <p className="text-6xl font-black tabular-nums tracking-tighter" style={{ color: level.color }}>{riskScore}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 -mt-1">Puntos Riesgo</p>
            </div>
          </div>
          
          <div className="text-center md:text-left flex-1 border-t md:border-t-0 md:border-l border-slate-100 pt-6 md:pt-0 md:pl-10">
            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-2xl mb-3 ${level.bg} ${level.text} border ${level.border} shadow-sm`}>
               <div className={`w-2 h-2 rounded-full animate-pulse`} style={{ backgroundColor: level.color }} />
               <span className="text-xs font-black uppercase tracking-widest">{t('vo2.category')} {level.label}</span>
            </div>
            <h3 className="text-3xl font-black text-slate-900 tracking-tight mb-2">{t('injury.stability_eval')}</h3>
            <p className="text-slate-500 font-medium leading-relaxed max-w-md">
              {t('injury.evaluation_desc')}
            </p>
          </div>
        </div>
      </div>

      {/* Traffic light bar */}
      {/* Traffic light bar */}
      <div className="bg-white rounded-2xl p-2 border border-slate-100 shadow-sm">
        <div className="relative h-10 rounded-xl overflow-hidden bg-slate-100/50">
          <div className="absolute inset-0 flex">
            <div className="flex-1 bg-emerald-400/20 border-r border-white/40" />
            <div className="flex-1 bg-amber-400/20 border-r border-white/40" />
            <div className="flex-1 bg-orange-400/20 border-r border-white/40" />
            <div className="flex-1 bg-rose-400/20" />
          </div>
          <div
            className="absolute top-0 bottom-0 w-2 bg-slate-900 rounded-full shadow-[0_0_15px_rgba(0,0,0,0.3)] border-2 border-white transition-all duration-700 delay-300"
            style={{ left: `${riskScore}%`, transform: 'translateX(-50%)' }}
          />
          <div className="absolute inset-0 flex items-center justify-between px-6 text-[10px] font-black uppercase tracking-widest text-slate-500 pointer-events-none">
            <span>{t('injury.risk_levels.safe')}</span>
            <span>{t('injury.risk_levels.alert')}</span>
            <span>{t('injury.risk_levels.loaded')}</span>
            <span>{t('injury.risk_levels.danger')}</span>
          </div>
        </div>
      </div>

      {/* Factor breakdown */}
      {/* Factor breakdown */}
      <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
        <h3 className="text-slate-900 font-black text-sm uppercase tracking-widest mb-8 flex items-center gap-2">
           <ArrowPathIcon className="w-4 h-4 text-blue-500" />
           {t('injury.factors.title')}
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6">
          {factors.map(f => {
            const fLevel = getRiskLevel(f.risk, t);
            return (
              <div key={f.name} className="group">
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{f.name}</p>
                    <p className="text-xs font-bold text-slate-700">{f.value}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400">{t('injury.factors.impact')} {f.weight}</p>
                    <p className="text-sm font-black" style={{ color: fLevel.color }}>{t('injury.factors.score')} {f.risk}</p>
                  </div>
                </div>
                <div className="h-2 bg-slate-50 rounded-full overflow-hidden border border-slate-100/50">
                  <div
                    className="h-full rounded-full transition-all duration-700 group-hover:brightness-110"
                    style={{ width: `${f.risk}%`, backgroundColor: fLevel.color }}
                  />
                </div>
                <p className="mt-2 text-[10px] font-medium text-slate-400 group-hover:text-slate-600 transition-colors">
                  {f.detail}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk history */}
      {historyData.length > 2 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('injury.history')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('injury.history_desc')}</Text>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={historyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <RechartsTooltip
                  formatter={(val, name) => {
                    if (name === 'risk') return [`${val}`, t('injury.risk_label')];
                    if (name === 'km') return [`${val} km`, t('dashboard.distance')];
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
        <div className={`rounded-3xl border border-slate-100 p-8 shadow-xl shadow-slate-200/50 ${riskScore < 35 ? 'bg-white border-l-[12px] border-l-emerald-500' : 'bg-white border-l-[12px] border-l-amber-500'}`}>
           <div className="flex gap-6 items-start">
             <div className={`p-4 rounded-2xl shrink-0 ${riskScore < 35 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                {riskScore < 35 ? <ShieldCheckIcon className="w-8 h-8" /> : <ExclamationCircleIcon className="w-8 h-8" />}
             </div>
             <div>
                <h3 className="text-slate-900 font-black text-xl uppercase tracking-tight mb-4">{t('injury.roadmap')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 bg-slate-50/50 p-4 rounded-2xl border border-slate-100/50">
                       <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${riskScore < 35 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>{i + 1}</span>
                       <p className="text-sm font-bold text-slate-600 leading-snug">{rec}</p>
                    </div>
                  ))}
                </div>
             </div>
           </div>
        </div>
      )}

      {/* Guide */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('injury.methodology')}</Title>
        <div className="text-sm text-slate-600 space-y-2">
          <p>{t('injury.methodology_desc')}</p>
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

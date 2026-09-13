import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Badge } from '@tremor/react';
import { estimateLTHR, HR_LIMITS } from '../lib/hrZones';

// ─────────────────────────────────────────────────────────────────────────────
// Ajustes › Calibración de FC. Los tres números que toda la app usa: FCmax,
// FC de reposo y LTHR, cada uno con su valor detectado y su override manual.
//
// Vivía dentro de la vista de Zonas, que es una de las muchas consumidoras.
// Tocar aquí mueve el PMC (CTL/ATL/TSB), los umbrales, las zonas de cada lap y
// el prompt del coach, porque `useHrParams` emite `OVERRIDES_EVENT` y todas las
// vistas lo escuchan: es el ajuste más global de la aplicación y por eso vive en
// Ajustes. La RESOLUCIÓN (detectado vs manual) sigue siendo de
// `lib/loadCalibration.js`; esta vista solo la pinta y la edita.
// ─────────────────────────────────────────────────────────────────────────────

const Field = ({ label, badge, badgeColor, value, caption, inputValue, placeholder, onChange, invalid, invalidText, help }) => (
  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
    <div className="flex items-center justify-between mb-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <Badge color={badgeColor} size="xs">{badge}</Badge>
    </div>
    <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
    <p className="text-[10px] text-slate-400 mt-0.5">{caption}</p>
    <input
      type="number"
      placeholder={placeholder}
      value={inputValue}
      onChange={e => onChange(e.target.value)}
      className={`mt-3 w-full px-2.5 py-1.5 text-xs bg-white border rounded-lg focus:outline-none focus:ring-2 tabular-nums text-center font-semibold ${
        invalid
          ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-400'
          : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-300'
      }`}
    />
    {invalid && <p className="text-[9px] text-rose-500 mt-1">{invalidText}</p>}
    <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">{help}</p>
  </div>
);

export default function HrCalibration({ hrParams }) {
  const { t } = useTranslation();
  const {
    hrmax, hrrest, lthr, hrr,
    autoMax, autoRest, lthrResult, recentActivities,
    userMax, setUserMax, userRest, setUserRest, userLTHR, setUserLTHR,
    maxOv, restOv, lthrOv, invalidMax, invalidRest, invalidLTHR,
  } = hrParams;

  const confColor = lthrResult.confidence >= 70 ? 'emerald' : lthrResult.confidence >= 40 ? 'amber' : 'rose';
  const methodText = {
    cs: t('zones.method_cs', { n: lthrResult.n }),
    segment: t('zones.method_segment', { n: lthrResult.n }),
    field: t('zones.method_field', { n: lthrResult.n }),
    race: t('zones.method_race', { n: lthrResult.n }),
    formula: t('zones.method_formula'),
    none: t('zones.method_none'),
  }[lthrResult.method];

  const activitiesWithHR = recentActivities?.filter(a => a.average_heartrate)?.length ?? 0;

  return (
    <Card className="shadow-lg border-slate-200">
      <div className="mb-5">
        <Title className="text-slate-800 font-bold">{t('zones.title')}</Title>
        <Text className="text-slate-500 text-sm mt-0.5">
          {t('zones.subtitle', { count: activitiesWithHR })}
        </Text>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field
          label={t('zones.fc_max')}
          badge={maxOv ? t('zones.manual') : t('zones.auto')}
          badgeColor={maxOv ? 'violet' : 'sky'}
          value={hrmax}
          caption={`${t('zones.bpm')} · ${maxOv ? t('zones.manual').toLowerCase() : t('zones.detected').toLowerCase()}`}
          inputValue={userMax}
          placeholder={`${autoMax.value} (auto)`}
          onChange={setUserMax}
          invalid={invalidMax}
          invalidText={t('zones.out_of_range', { lo: HR_LIMITS.maxLo, hi: HR_LIMITS.maxHi })}
          help={t('zones.hrmax_desc')}
        />

        <Field
          label={t('zones.fc_rest')}
          badge={restOv ? t('zones.manual') : autoRest.source === 'garmin' ? 'Garmin' : t('zones.default_val')}
          badgeColor={restOv ? 'violet' : autoRest.source === 'garmin' ? 'sky' : 'slate'}
          value={hrrest}
          caption={`${t('zones.bpm')} · ${restOv ? t('zones.manual').toLowerCase() : autoRest.source === 'garmin' ? t('zones.detected').toLowerCase() : t('zones.default_val').toLowerCase()}`}
          inputValue={userRest}
          placeholder={`${autoRest.value}`}
          onChange={setUserRest}
          invalid={invalidRest}
          invalidText={t('zones.out_of_range', { lo: HR_LIMITS.restLo, hi: Math.min(HR_LIMITS.restHi, hrmax - 20) })}
          help={t('zones.hrrest_desc')}
        />

        <Field
          label={t('zones.lthr')}
          badge={lthrOv ? t('zones.manual') : `${lthrResult.confidence}% ${t('zones.conf')}`}
          badgeColor={lthrOv ? 'violet' : confColor}
          value={lthr}
          caption={lthrOv ? t('zones.manual') : methodText}
          inputValue={userLTHR}
          placeholder={`${lthrResult.lthr ?? estimateLTHR(hrmax)} (auto)`}
          onChange={setUserLTHR}
          invalid={invalidLTHR}
          invalidText={t('zones.out_of_range', { lo: hrrest + 10, hi: hrmax })}
          help={t('zones.lthr_desc')}
        />
      </div>

      {/* Derivados: lo que se calcula a partir de los tres de arriba */}
      <div className="mt-4 flex gap-2.5 flex-wrap">
        <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">HRR</span>
          <span className="text-sm font-bold text-indigo-700 tabular-nums">{hrr} {t('zones.bpm')}</span>
          <span className="text-[10px] text-indigo-400">({hrmax} − {hrrest})</span>
        </div>
        <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-100 rounded-lg px-3 py-1.5">
          <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">LTHR / FCmax</span>
          <span className="text-sm font-bold text-violet-700 tabular-nums">{((lthr / hrmax) * 100).toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">LTHR / HRR</span>
          <span className="text-sm font-bold text-emerald-700 tabular-nums">
            {hrr > 0 ? (((lthr - hrrest) / hrr) * 100).toFixed(1) : '–'}%
          </span>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
        {t('calibration.scope')}
      </p>
    </Card>
  );
}

// ============================================================================
// areaVerdicts — una conclusión por área, DERIVADA, no generada (§6.3 del plan).
//
// En Carga o en Motor el veredicto lo tenía que sacar el atleta cruzando cuatro
// pestañas. Aquí se resume cada área en unas pocas líneas, y cada línea sale del
// módulo dueño de su número y con SUS cortes: estado de forma por TSB (`formZone`, la escala del PMC), ACWR y
// rampa (`acwrZone`, `rampLevel`), eficiencia (`efficiencyFactorRun`), velocidad
// crítica (`fitCriticalSpeed`), deriva (`decouplingPct` + `decouplingLevel`) y
// reparto polarizado (`zoneMix` + `polarizationStatus`). Si una línea dijera algo
// distinto que la pestaña de la que sale, el error estaría aquí.
//
// Devuelve datos, no texto: `{ id, tone, key, params }`, con `key` de i18n
// (`area_verdict.*`). `tone` es good | neutral | warn | bad.
// Sin dato suficiente para una línea, la línea no sale: mejor callar que rellenar.
// ============================================================================

import { formZone, acwrZone, rampLevel } from './statusStats.js';
import { efficiencyFactorRun } from './efficiencyFactor.js';
import { activityWithinMonths, buildMeanMaxCurve, fitCriticalSpeed, monthsAgoISO } from './criticalSpeed.js';
import { decouplingPct, decouplingLevel } from './decoupling.js';
import { zoneMix, polarizedGroups, polarizationStatus } from './zoneMix.js';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const FORM_TONE = { transition: 'neutral', fresh: 'good', optimal: 'good', loaded: 'neutral', overloaded: 'bad' };
const ACWR_TONE = { underload: 'neutral', optimal: 'good', caution: 'warn', danger: 'bad' };
const DRIFT_TONE = { excellent: 'good', good: 'good', normal: 'neutral', high: 'warn', very_high: 'bad' };

/**
 * Carga: dónde estás (fase por TSB), si la subida es brusca (ACWR) y hacia dónde
 * va la forma (CTL y su rampa). `current` es `pmc.current` del PMC calibrado.
 */
export function loadVerdict(current) {
  if (!current || current.ctl == null) return [];
  const items = [];

  if (current.tsb != null) {
    // Escala del PMC (formZone), que es la vista sobre la que se pinta esto.
    const zone = formZone(current.tsb);
    items.push({
      id: 'phase', tone: FORM_TONE[zone],
      key: `area_verdict.load.form_${zone}`, params: { tsb: Math.round(current.tsb) },
    });
  }

  const zone = acwrZone(current.acwr);
  if (zone) {
    items.push({
      id: 'acwr', tone: ACWR_TONE[zone],
      key: `area_verdict.load.acwr_${zone}`, params: { acwr: round(current.acwr, 2) },
    });
  }

  const ramp = rampLevel(current.ramp);
  if (ramp) {
    items.push({
      id: 'ctl', tone: ramp === 'high' ? 'warn' : 'neutral',
      key: `area_verdict.load.ctl_${current.ramp >= 0 ? 'up' : 'down'}${ramp === 'high' ? '_fast' : ''}`,
      // La rampa va sin signo: el sentido ya lo dice la clave (subiendo / bajando).
      params: { ctl: Math.round(current.ctl), pct: current.pctPeak ?? 0, ramp: round(Math.abs(current.ramp), 1) },
    });
  }
  return items;
}

/**
 * Motor: si el motor aeróbico mejora (eficiencia), si el techo se mueve (velocidad
 * crítica frente al período anterior), si aguanta (deriva) y cómo se reparte la
 * intensidad (80/20), todo dentro del período compartido.
 *
 * @param {Array}  runs    carreras (todo el histórico: la curva anterior lo necesita)
 * @param {object} opts
 * @param {number|null} opts.months  meses del período (null = todo el histórico)
 * @param {number} opts.hrmax
 * @param {Array}  opts.bounds       cortes de Karvonen (null = sin línea de 80/20)
 */
export function engineVerdict(runs, { months, hrmax, bounds } = {}) {
  if (!Array.isArray(runs) || !runs.length) return [];
  const inScope = runs.filter(activityWithinMonths(months));
  const items = [];

  // Eficiencia aeróbica: mediana de la mitad reciente frente a la antigua. Con
  // menos de 6 sesiones comparables no hay tendencia que contar.
  const efs = inScope
    .map((a) => ({ t: new Date(a.start_date).getTime(), ef: efficiencyFactorRun(a, { maxObservedHr: hrmax, gapAdjust: true }) }))
    .filter((x) => x.ef != null)
    .sort((a, b) => a.t - b.t);
  if (efs.length >= 6) {
    const half = Math.floor(efs.length / 2);
    const older = median(efs.slice(0, half).map((x) => x.ef));
    const recent = median(efs.slice(efs.length - half).map((x) => x.ef));
    const delta = (recent / older - 1) * 100;
    const trend = delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat';
    items.push({
      id: 'efficiency', tone: trend === 'up' ? 'good' : trend === 'down' ? 'warn' : 'neutral',
      key: `area_verdict.engine.ef_${trend}`, params: { delta: round(delta, 1), n: efs.length },
    });
  }

  // Velocidad crítica del período frente al período anterior de igual duración.
  const from = monthsAgoISO(months);
  const fit = fitCriticalSpeed(buildMeanMaxCurve(runs, { from }));
  if (fit) {
    const prev = months != null
      ? fitCriticalSpeed(buildMeanMaxCurve(runs, { from: monthsAgoISO(months * 2), to: from }))
      : null;
    const pace = fit.cs_pace_min_km;
    if (prev) {
      const delta = (fit.cs_m_s / prev.cs_m_s - 1) * 100;
      const trend = delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat';
      items.push({
        id: 'cs', tone: trend === 'up' ? 'good' : trend === 'down' ? 'warn' : 'neutral',
        key: `area_verdict.engine.cs_${trend}`, params: { pace, delta: round(delta, 1) },
      });
    } else {
      items.push({ id: 'cs', tone: 'neutral', key: 'area_verdict.engine.cs_now', params: { pace } });
    }
  }

  // Deriva: mediana de las sesiones de 30+ min con parciales. La mediana, no la
  // media: un día de calor no debe decidir el veredicto del período.
  const drifts = inScope
    .filter((a) => (a.moving_time || 0) >= 1800)
    .map((a) => decouplingPct(a.splits_metric))
    .filter((v) => v != null);
  if (drifts.length >= 3) {
    const med = median(drifts);
    const level = decouplingLevel(med);
    items.push({
      id: 'drift', tone: DRIFT_TONE[level],
      key: 'area_verdict.engine.drift', params: { pct: round(med, 1), level, n: drifts.length },
    });
  }

  // Reparto de intensidad del período (Karvonen agrupado en fácil/gris/duro).
  if (bounds?.length) {
    const mix = zoneMix(inScope, bounds);
    if (mix.hasData) {
      const g = polarizedGroups(mix.pct);
      const status = polarizationStatus(g.low, g.mod, g.high);
      items.push({
        id: 'polarization', tone: status === 'ok' ? 'good' : 'warn',
        key: `area_verdict.engine.polar_${status}`,
        params: { low: Math.round(g.low), mod: Math.round(g.mod), high: Math.round(g.high) },
      });
    }
  }
  return items;
}

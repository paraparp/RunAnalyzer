import { describe, it, expect } from 'vitest';
import { computeGap } from './mcp-store.js';
import { computeStreamGap } from '../../src/lib/streamGap.js';

// Un km rompepiernas: 500 m al +4% y 500 m al −4%. El desnivel NETO del km es 0,
// que es todo lo que ven los splits de Strava.
const buildStreams = () => {
  const distance = [0], time = [0], altitude = [100], grade_smooth = [0];
  const push = (gradePct, pace) => {
    distance.push(distance.at(-1) + 10);
    time.push(time.at(-1) + (10 / 1000) * pace);
    altitude.push(altitude.at(-1) + (gradePct / 100) * 10);
    grade_smooth.push(gradePct);
  };
  for (let k = 0; k < 50; k++) push(4, 300);
  for (let k = 0; k < 50; k++) push(-4, 300);
  return {
    distance: { data: distance }, time: { data: time },
    altitude: { data: altitude }, grade_smooth: { data: grade_smooth },
  };
};

const splitsKm = { split: 1, distance: 1000, average_speed: 1000 / 300, elevation_difference: 0 };

describe('computeGap', () => {
  it('prefiere la medida por streams cuando la actividad está enriquecida', () => {
    const a = {
      splits_metric: [splitsKm],
      total_elevation_gain: 20,
      stream_gap: computeStreamGap(buildStreams()),
    };
    const gap = computeGap(a);
    expect(gap.source).toContain('muestra a muestra');
    // Lo que el respaldo no puede ver: el km sube 20 y baja 20, no es llano.
    expect(gap.elevation.gain_m).toBe(20);
    expect(gap.elevation.loss_m).toBe(20);
    expect(gap.gap_pace).not.toBe('5:00');       // más rápido que el ritmo real
    expect(gap.caveat).toBeNull();
  });

  it('cae a los splits —y avisa— mientras no hay streams', () => {
    const gap = computeGap({ splits_metric: [splitsKm], total_elevation_gain: 20 });
    expect(gap.source).toContain('desnivel neto');
    expect(gap.gap_pace).toBe('5:00');           // el neto 0 lo procesa como llano
    expect(gap.caveat).toContain('INFRAESTIMA');
  });

  it('ignora un stream_gap que no llegó a medir nada', () => {
    const a = { splits_metric: [splitsKm], stream_gap: computeStreamGap(null) };
    expect(computeGap(a).source).toContain('desnivel neto');
  });

  it('sin splits ni streams no inventa un número', () => {
    expect(computeGap({})).toBeNull();
  });
});

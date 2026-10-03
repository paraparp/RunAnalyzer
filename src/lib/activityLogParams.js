// Estado de la bitácora (año, deportes, búsqueda, orden, página y rangos) ⇄ query
// string. Vive en la URL para que abrir una actividad y volver atrás devuelva la
// lista tal y como estaba, y para poder compartir una vista filtrada.
// Solo se escriben los valores que difieren del defecto: `/log` limpio = vista
// por defecto.

export const DEFAULT_LOG_STATE = {
  year: 'All',
  sports: null, // null = solo carrera (defecto); [] = ninguno marcado
  q: '',
  sort: 'date',
  dir: 'desc',
  page: 1,
  dist: { min: '', max: '' },
  elev: { min: '', max: '' },
  pace: { min: '', max: '' },
};

// Marca para "ningún deporte marcado": una lista vacía no sobrevive a la URL.
const NO_SPORTS = '-';

const RANGES = [['dist', 'd'], ['elev', 'e'], ['pace', 'p']];

export function readLogState(params) {
  const s = structuredClone(DEFAULT_LOG_STATE);
  if (params.get('year')) s.year = params.get('year');
  if (params.has('sports')) {
    const raw = params.get('sports');
    s.sports = raw === NO_SPORTS || !raw ? [] : raw.split(',');
  }
  s.q = params.get('q') ?? '';
  if (params.get('sort')) s.sort = params.get('sort');
  if (params.get('dir') === 'asc') s.dir = 'asc';
  const page = parseInt(params.get('page'), 10);
  if (page > 1) s.page = page;
  for (const [key, p] of RANGES) {
    s[key] = { min: params.get(`${p}min`) ?? '', max: params.get(`${p}max`) ?? '' };
  }
  return s;
}

export function writeLogState(s) {
  const params = new URLSearchParams();
  if (s.year !== DEFAULT_LOG_STATE.year) params.set('year', s.year);
  if (s.sports !== null) params.set('sports', s.sports.length ? s.sports.join(',') : NO_SPORTS);
  if (s.q) params.set('q', s.q);
  if (s.sort !== DEFAULT_LOG_STATE.sort) params.set('sort', s.sort);
  if (s.dir !== DEFAULT_LOG_STATE.dir) params.set('dir', s.dir);
  if (s.page > 1) params.set('page', String(s.page));
  for (const [key, p] of RANGES) {
    if (s[key].min !== '') params.set(`${p}min`, s[key].min);
    if (s[key].max !== '') params.set(`${p}max`, s[key].max);
  }
  return params;
}

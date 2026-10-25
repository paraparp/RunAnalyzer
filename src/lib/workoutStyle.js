// Color y etiqueta de cada categoría de entreno (lib/workoutProtocol). Lo
// comparten la ficha (WorkoutCard) y la fila de la sección de planes.
export const CATEGORY_STYLE = {
  easy: { label: 'Fácil', bar: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500', wash: 'bg-sky-50 dark:bg-sky-400/10' },
  quality: { label: 'Calidad', bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', wash: 'bg-orange-50 dark:bg-orange-400/10' },
  long: { label: 'Larga', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', wash: 'bg-emerald-50 dark:bg-emerald-400/10' },
  test: { label: 'Test', bar: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500', wash: 'bg-violet-50 dark:bg-violet-400/10' },
  race: { label: 'Carrera', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', wash: 'bg-amber-50 dark:bg-amber-400/10' },
  rest: { label: 'Descanso', bar: 'bg-slate-400', text: 'text-slate-600 dark:text-white/75', dot: 'bg-slate-400', wash: 'bg-slate-100 dark:bg-white/[0.04]' },
};

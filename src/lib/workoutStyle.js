// Color y etiqueta de cada categoría de entreno (lib/workoutProtocol). Lo
// comparten la ficha (WorkoutCard) y la fila de la sección de planes.
export const CATEGORY_STYLE = {
  easy: { label: 'Fácil', bar: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  quality: { label: 'Calidad', bar: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
  long: { label: 'Larga', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  test: { label: 'Test', bar: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  race: { label: 'Carrera', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  rest: { label: 'Descanso', bar: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-300', dot: 'bg-slate-400' },
};

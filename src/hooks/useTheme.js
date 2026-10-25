import { useSyncExternalStore } from 'react';

// Tema de la app: 'light' | 'dark' | 'system'. La preferencia se guarda en
// localStorage (app_theme); index.html la aplica antes del bundle para que no
// haya destello del tema contrario al cargar.
const STORAGE_KEY = 'app_theme';
const THEME_COLORS = { light: '#f6f7f9', dark: '#07090d' };
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

const readPreference = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

let preference = readPreference();
const listeners = new Set();

const resolve = (pref) => (pref === 'system' ? (media?.matches ? 'dark' : 'light') : pref);

const apply = () => {
  if (typeof document === 'undefined') return;
  const isDark = resolve(preference) === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', isDark ? THEME_COLORS.dark : THEME_COLORS.light);
};

const emit = () => {
  apply();
  listeners.forEach((l) => l());
};

media?.addEventListener?.('change', () => {
  if (preference === 'system') emit();
});

// Otra pestaña cambió el tema.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    preference = readPreference();
    emit();
  });
}

apply();

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = () => `${preference}|${resolve(preference)}`;

export function setTheme(next) {
  preference = next === 'light' || next === 'dark' ? next : 'system';
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch { /* sin almacenamiento: el tema dura lo que la sesión */ }
  emit();
}

/**
 * Tema activo. `theme` es la preferencia guardada ('light' | 'dark' | 'system');
 * `isDark` es el resultado ya resuelto contra el sistema operativo.
 */
export default function useTheme() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [theme, resolved] = snap.split('|');
  return { theme, isDark: resolved === 'dark', setTheme };
}

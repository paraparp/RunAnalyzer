import { useSyncExternalStore } from 'react';

/**
 * Estado de instalación de la PWA compartido por toda la app.
 * Chrome dispara `beforeinstallprompt` una sola vez y muy pronto, así que lo
 * capturamos a nivel de módulo (antes de que monte ningún componente).
 */
let deferredPrompt = null;
let installed = typeof window !== 'undefined' && (
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
  window.navigator.standalone === true
);
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // usamos nuestro propio botón en vez de la mini-barra de Chrome
    deferredPrompt = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

// iPadOS se identifica como "Macintosh": se distingue por la pantalla táctil.
const isIOS = typeof navigator !== 'undefined' && (
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
);

let snapshot = { canInstall: false, installed, isIOS };
function getSnapshot() {
  const canInstall = !!deferredPrompt;
  if (snapshot.canInstall !== canInstall || snapshot.installed !== installed) {
    snapshot = { canInstall, installed, isIOS };
  }
  return snapshot;
}
function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Lanza el diálogo nativo de instalación. Devuelve true si el usuario acepta. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const e = deferredPrompt;
  deferredPrompt = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

/** { canInstall, installed, isIOS, promptInstall } */
export default function usePWAInstall() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...s, promptInstall };
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ArrowPathIcon, ArrowDownTrayIcon, SignalSlashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import usePWAInstall from '../hooks/usePWAInstall';
import { isDegraded, onDegradedChange } from '../lib/cloudStorage';

const UPDATE_CHECK_MS = 60 * 60 * 1000; // la app instalada puede pasar días abierta

/**
 * Avisos globales de la PWA: nueva versión disponible y modo sin conexión.
 */
export default function PWAPrompts() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);
  // Si OfflineBanner ya avisa de que no hay nube, no repetimos el aviso aquí.
  const [degraded, setDegraded] = useState(isDegraded);
  useEffect(() => onDegradedChange(setDegraded), []);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, reg) {
      if (!reg) return;
      // Comprueba si hay versión nueva cada hora y al volver a la app.
      const check = () => {
        if (reg.installing || !navigator.onLine) return;
        reg.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Ofrecer instalar solo a usuarios con uso real (recomendación de Chrome):
  // a partir de la 3ª visita y si no lo ha descartado en los últimos 30 días.
  const pwa = usePWAInstall();
  const [showInstall, setShowInstall] = useState(() => {
    try {
      // Una visita por sesión de navegador: las recargas no cuentan.
      let visits = Number(localStorage.getItem('pwa_visits') || 0);
      if (!sessionStorage.getItem('pwa_visit_counted')) {
        sessionStorage.setItem('pwa_visit_counted', '1');
        visits += 1;
        localStorage.setItem('pwa_visits', String(visits));
      }
      const dismissed = Number(localStorage.getItem('pwa_install_dismissed') || 0);
      return visits >= 3 && Date.now() - dismissed > 30 * 864e5;
    } catch { return false; /* sin storage: no insistimos */ }
  });
  const dismissInstall = () => {
    setShowInstall(false);
    try { localStorage.setItem('pwa_install_dismissed', String(Date.now())); } catch { /* noop */ }
  };

  return (
    <div
      className="fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
      // --bottom-nav: alto de la barra inferior del shell en móvil (0 si no hay), ver index.css.
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom) + var(--bottom-nav, 0px))' }}
    >
      {!online && !degraded && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-slate-900/90 dark:bg-white/10 backdrop-blur px-4 py-2 text-xs font-medium text-white shadow-lg">
          <SignalSlashIcon className="w-4 h-4" />
          {t('pwa.offline', 'Sin conexión: ves los últimos datos guardados.')}
        </div>
      )}
      {showInstall && pwa.canInstall && !pwa.installed && !needRefresh && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-teal-200 dark:border-teal-300/20 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm shadow-lg">
          <img src="/pwa-64x64.png" alt="" className="w-8 h-8 rounded-lg" />
          <span className="text-slate-700 dark:text-white/80">
            {t('pwa.install_banner', 'Instala RunAnalyzer: ventana propia y acceso directo.')}
          </span>
          <button
            type="button"
            onClick={async () => { await pwa.promptInstall(); dismissInstall(); }}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {t('pwa.install', 'Instalar')}
          </button>
          <button
            type="button"
            aria-label={t('pwa.dismiss', 'Más tarde')}
            onClick={dismissInstall}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      {needRefresh && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-teal-200 dark:border-teal-300/20 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm shadow-lg">
          <span className="text-slate-700 dark:text-white/80">
            {t('pwa.update_ready', 'Hay una versión nueva de RunAnalyzer.')}
          </span>
          <button
            type="button"
            onClick={() => updateServiceWorker(true)}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            <ArrowPathIcon className="w-4 h-4" />
            {t('pwa.reload', 'Actualizar')}
          </button>
          <button
            type="button"
            aria-label={t('pwa.dismiss', 'Más tarde')}
            onClick={() => setNeedRefresh(false)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

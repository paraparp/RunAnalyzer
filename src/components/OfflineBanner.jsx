import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDegraded, onDegradedChange } from '../lib/cloudStorage';

// Aviso global: se muestra cuando cloudStorage no puede alcanzar Supabase (p.ej.
// HTTP 522 por Disk IO agotado). La app sigue usable con la copia local; este
// banner deja claro que los cambios aún no se están sincronizando en la nube.
export default function OfflineBanner() {
  const { i18n } = useTranslation();
  const [degraded, setDegraded] = useState(isDegraded());

  useEffect(() => onDegradedChange(setDegraded), []);

  if (!degraded) return null;

  const es = (i18n.language || 'es').startsWith('es');
  const msg = es
    ? 'Sin conexión con la nube — trabajando con tus datos locales. Los cambios se sincronizarán cuando el servicio se restablezca.'
    : 'No cloud connection — working from your local data. Changes will sync once the service is back.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white shadow-md"
    >
      <span aria-hidden="true">⚠️</span>
      <span>{msg}</span>
    </div>
  );
}

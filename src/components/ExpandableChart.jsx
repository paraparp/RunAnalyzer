import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline';

/**
 * Envuelve el área de un gráfico Recharts y permite ampliarlo a casi pantalla
 * completa en un modal. El hijo debe usar `<ResponsiveContainer height="100%">`:
 * aquí se le da la altura (inline con `className`/`style`, en el modal todo el
 * hueco disponible).
 *
 * Mientras el modal está abierto el gráfico inline se desmonta: así no hay ids
 * de gradiente SVG duplicados ni dos `syncId` peleándose por el cursor.
 *
 * @param {string} title     Título que se muestra en la cabecera del modal.
 * @param {string} [subtitle]
 * @param {React.ReactNode} [toolbar]  Controles (granularidad, vista…) que se
 *   repiten en el modal para poder cambiarlos sin cerrarlo.
 * @param {React.ReactNode} [footer]   Leyenda o nota bajo el gráfico ampliado.
 * @param {'overlay'|'none'} [trigger] 'overlay' pinta el botón sobre la esquina
 *   del gráfico; 'none' si el padre pone su propio <ExpandButton>.
 * @param {boolean} [open] / [onOpenChange]  Modo controlado (para ExpandButton).
 * @param {React.ReactNode} [expandedContent]  Contenido alternativo para el
 *   modal (p. ej. una versión del gráfico con zoom y más anotaciones).
 */
export default function ExpandableChart({
  title, subtitle, toolbar, footer, className = '', style,
  trigger = 'overlay', open: openProp, onOpenChange, expandedContent, children,
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  // En modo controlado el padre suele pasar un callback nuevo en cada render;
  // con un ref el efecto no re-registra el listener por eso.
  const setOpenRef = useRef(setOpen);
  useEffect(() => { setOpenRef.current = setOpen; });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpenRef.current(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className={`group/chart relative ${className}`} style={style} onDoubleClick={() => setOpen(true)}>
      {open ? null : children}
      {trigger === 'overlay' && !open && (
        <ExpandButton
          onClick={() => setOpen(true)}
          className="absolute top-0 right-0 z-20 sm:opacity-0 sm:group-hover/chart:opacity-100 focus-visible:opacity-100"
        />
      )}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex bg-slate-900/60 backdrop-blur-sm p-2 sm:p-6 animate-[fadeIn_120ms_ease-out]"
          onClick={() => setOpen(false)}
          // Los eventos React burbujean a través del portal: sin esto el doble
          // clic en el fondo volvería a abrir el modal desde el contenedor.
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="flex flex-col w-full h-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h2>
                {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
              </div>
              {toolbar}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 transition-colors"
                aria-label="Cerrar"
                title="Cerrar (Esc)"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3 sm:p-6">{expandedContent ?? children}</div>
            {footer && <div className="px-4 sm:px-6 pb-4">{footer}</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Botón "ampliar" para colocar en la cabecera de una tarjeta. */
export function ExpandButton({ onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`p-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 border border-slate-200/70 dark:border-slate-700 transition-all ${className}`}
      aria-label="Ampliar gráfico"
      title="Ampliar gráfico (doble clic)"
    >
      <ArrowsPointingOutIcon className="w-4 h-4" />
    </button>
  );
}

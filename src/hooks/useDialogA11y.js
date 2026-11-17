import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportamiento de diálogo para un panel superpuesto (menú móvil, chat):
 * al abrir mete el foco dentro, Tab no se escapa del panel, Escape lo cierra y al
 * cerrar el foco vuelve a donde estaba.
 *
 * El contenedor necesita `tabIndex={-1}` para poder recibir el foco inicial.
 *
 * Escape se cede a lo que haya abierto DENTRO del panel y lo gestione por su
 * cuenta (un popover, la pantalla completa del chat): esos elementos se marcan
 * con `data-esc-owner`, y mientras exista uno este hook no cierra el panel.
 */
export default function useDialogA11y(ref, open, onClose) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    const previous = document.activeElement;
    if (!el.contains(previous)) el.focus({ preventScroll: true });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (el.querySelector('[data-esc-owner]')) return;
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open, ref]);
}

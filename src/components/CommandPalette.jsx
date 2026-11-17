import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

// Sin tildes y en minúsculas: "bitacora" encuentra "Bitácora".
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MAX_ACTIVITIES = 8;

/**
 * Buscador global (Ctrl/⌘+K): salta a cualquier vista, lanza una acción o abre
 * una sesión por nombre o fecha. Con 25 vistas repartidas en categorías, es el
 * atajo para no recorrer el menú.
 *
 * Se monta solo mientras está abierto, así que su estado nace limpio cada vez.
 *
 * @param {object} props
 * @param {Array<{id, icon, itemIds}>} props.categories - Categorías del menú.
 * @param {Array<object>} props.activities - Todas las actividades (se buscan al escribir).
 * @param {Array<{id, label, Icon, run}>} props.actions - Acciones rápidas.
 * @param {(viewId: string) => void} props.onNavigate
 * @param {(activityId: number|string) => void} props.onOpenActivity
 * @param {() => void} props.onClose
 */
export default function CommandPalette({ categories, activities, actions = [], onNavigate, onOpenActivity, onClose }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const previousFocus = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  // Al cerrar, el foco vuelve a donde estaba.
  useEffect(() => {
    const previous = previousFocus.current;
    return () => { if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true }); };
  }, []);

  const views = useMemo(() => categories.flatMap((cat) => cat.itemIds.map((id) => {
    const label = t(`nav.${id}`);
    const catLabel = t(`nav.categories.${cat.id}`);
    return {
      key: `view:${id}`,
      Icon: cat.icon,
      label,
      // Una categoría de un solo ítem se llama casi igual que él: no se repite.
      hint: cat.itemIds.length > 1 ? catLabel : null,
      haystack: norm(`${label} ${catLabel} ${id}`),
      run: () => onNavigate(id),
    };
  })), [categories, t, onNavigate]);

  const indexedActivities = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
    const fmtLong = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });
    return [...(activities ?? [])]
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
      .map((a) => {
        const d = new Date(a.start_date_local || a.start_date);
        const valid = !Number.isNaN(d.getTime());
        const date = valid ? fmt.format(d) : '';
        const km = a.distance > 0 ? `${(a.distance / 1000).toFixed(1)} km` : '';
        return {
          id: a.id,
          label: a.name || t('nav.activity'),
          hint: [date, km].filter(Boolean).join(' · '),
          haystack: norm(`${a.name} ${date} ${valid ? fmtLong.format(d) : ''} ${String(a.start_date_local || a.start_date).slice(0, 10)} ${a.sport_type || a.type || ''}`),
        };
      });
  }, [activities, i18n.language, t]);

  const sections = useMemo(() => {
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const match = (haystack) => tokens.every((tok) => haystack.includes(tok));
    const out = [];
    const viewHits = views.filter((v) => match(v.haystack));
    if (viewHits.length) out.push({ id: 'views', title: t('palette.views'), items: viewHits });
    const actionHits = actions
      .map((a) => ({ key: `action:${a.id}`, Icon: a.Icon, label: a.label, hint: null, run: a.run, haystack: norm(a.label) }))
      .filter((a) => match(a.haystack));
    if (actionHits.length) out.push({ id: 'actions', title: t('palette.actions'), items: actionHits });
    // Las sesiones solo al escribir: sin consulta serían una lista arbitraria.
    if (tokens.length) {
      const hits = [];
      for (const a of indexedActivities) {
        if (!match(a.haystack)) continue;
        hits.push({ key: `activity:${a.id}`, Icon: null, label: a.label, hint: a.hint, run: () => onOpenActivity(a.id) });
        if (hits.length >= MAX_ACTIVITIES) break;
      }
      if (hits.length) out.push({ id: 'activities', title: t('palette.sessions'), items: hits });
    }
    return out;
  }, [query, views, actions, indexedActivities, onOpenActivity, t]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, query]);

  const choose = (item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(flat.length ? (activeIdx + 1) % flat.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(flat.length ? (activeIdx - 1 + flat.length) % flat.length : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // El único control enfocable es el campo: Tab no debe sacar el foco del diálogo.
      e.preventDefault();
    }
  };

  let cursor = -1;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]">
      <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="relative w-full max-w-xl overflow-hidden rounded-md border border-slate-900/10 dark:border-white/10 bg-white dark:bg-[#0c0e12] shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-slate-900/10 dark:border-white/10">
          <MagnifyingGlassIcon className="w-4 h-4 shrink-0 text-slate-400 dark:text-white/40" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={flat[activeIdx] ? `cp-${flat[activeIdx].key}` : undefined}
            aria-label={t('palette.title')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 h-12 border-0 bg-transparent dark:bg-transparent p-0 text-sm text-slate-950 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-0"
          />
          <kbd className="hidden sm:inline text-label font-semibold text-slate-400 dark:text-white/40">Esc</kbd>
        </div>

        <div ref={listRef} id="command-palette-list" role="listbox" aria-label={t('palette.title')} className="max-h-[55vh] overflow-y-auto p-2">
          {flat.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-white/55">{t('palette.empty')}</p>
          )}
          {sections.map((section) => (
            <div key={section.id} role="group" aria-label={section.title} className="mb-1 last:mb-0">
              <p aria-hidden="true" className="px-2.5 pt-2 pb-1 text-label font-bold uppercase text-slate-500 dark:text-white/45">{section.title}</p>
              {section.items.map((item) => {
                cursor += 1;
                const idx = cursor;
                const isActive = idx === activeIdx;
                const Icon = item.Icon;
                return (
                  <div
                    key={item.key}
                    id={`cp-${item.key}`}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => { if (!isActive) setActive(idx); }}
                    onClick={() => choose(item)}
                    className={`flex items-center gap-2.5 h-9 px-2.5 rounded-md text-[13px] cursor-pointer ${isActive
                      ? 'bg-slate-900/[0.06] dark:bg-white/[0.08] text-slate-950 dark:text-white'
                      : 'text-slate-600 dark:text-white/70'}`}
                  >
                    {Icon
                      ? <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-accent' : ''}`} aria-hidden="true" />
                      : <span aria-hidden="true" className="w-4 shrink-0 flex justify-center"><span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-accent' : 'bg-slate-300 dark:bg-white/25'}`} /></span>}
                    <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 text-xs text-slate-500 dark:text-white/45 tabular-nums">{item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

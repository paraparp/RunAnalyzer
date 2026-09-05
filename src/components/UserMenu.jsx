import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightStartOnRectangleIcon,
  SparklesIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlobeAltIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import ModelSelector from './ModelSelector';
import VersionBadge from './VersionBadge';
import useAIModel from '../hooks/useAIModel';
import { parseModelValue, PROVIDER_LABELS } from '../services/ai';

/**
 * Menú de usuario desplegable con información de perfil, selector de modelo de IA,
 * selector de idioma y botón de cerrar sesión.
 *
 * @param {object} props
 * @param {object} props.user - Objeto con datos del usuario (name, email, picture).
 * @param {function} props.handleLogout - Callback para cerrar sesión.
 * @param {function} [props.changeLanguage] - Callback para alternar idioma.
 * @param {string} [props.placement] - 'topbar' (despliega hacia abajo a la derecha) o 'sidebar' (despliega hacia arriba).
 */
export default function UserMenu({
  user,
  handleLogout,
  changeLanguage,
  placement = 'topbar',
  className = '',
}) {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const [selectedModel] = useAIModel();

  // Cerrar al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Formato del modelo activo para preview rápido
  const { provider, model } = parseModelValue(selectedModel);
  const providerName = PROVIDER_LABELS[provider] || provider;
  const cleanModelName = model
    .replace(/^gemini-/, '')
    .replace(/^openai\//, '')
    .replace(/^nvidia\//, '')
    .replace(/:free$/, '')
    .replace(/-/g, ' ');

  const isSidebar = placement === 'sidebar';

  return (
    <div className={`relative ${className}`} ref={menuRef}>
      {/* Botón disparador */}
      {isSidebar ? (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`w-full flex items-center gap-3 p-2 rounded-xl transition-all text-left ${
            isOpen
              ? 'bg-blue-50/80 dark:bg-blue-950/40 ring-2 ring-blue-500/30'
              : 'hover:bg-slate-100/90 dark:hover:bg-slate-800/60'
          }`}
          aria-expanded={isOpen}
          aria-label={t('user_menu.title', 'Perfil y configuración de usuario')}
        >
          <div className="relative shrink-0">
            <img
              src={user?.picture}
              alt={user?.name || 'Usuario'}
              className="w-9 h-9 rounded-full ring-2 ring-blue-400/40 shadow-sm object-cover"
            />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-slate-900"
              title="Strava Conectado"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate">
              {user?.name || 'Corredor'}
            </p>
            <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              <SparklesIcon className="w-3 h-3 text-blue-500 shrink-0" />
              <span className="truncate font-medium capitalize">{cleanModelName}</span>
            </div>
          </div>
          <div className="text-slate-400 shrink-0">
            {isOpen ? (
              <ChevronDownIcon className="w-4 h-4" />
            ) : (
              <ChevronUpIcon className="w-4 h-4" />
            )}
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`relative group rounded-full p-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            isOpen ? 'ring-2 ring-blue-500 ring-offset-2 scale-105' : 'hover:scale-105'
          }`}
          aria-expanded={isOpen}
          aria-label={t('user_menu.title', 'Perfil de usuario y configuración de IA')}
        >
          <img
            src={user?.picture}
            alt={user?.name || 'Usuario'}
            className="w-8 h-8 rounded-full ring-2 ring-blue-100 group-hover:ring-blue-400 object-cover shadow-sm transition-all"
          />
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-slate-900"
            title="Conectado"
          />
        </button>
      )}

      {/* Popover desplegable */}
      {isOpen && (
        <div
          className={`absolute z-50 animate-in fade-in zoom-in-95 duration-150 ${
            isSidebar
              ? 'bottom-full left-0 mb-3 w-[275px] sm:w-[310px]'
              : 'right-0 top-full mt-2 w-[320px] sm:w-[360px]'
          }`}
          style={{ maxWidth: 'calc(100vw - 24px)' }}
        >
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/90 rounded-2xl shadow-2xl p-4 text-slate-800 dark:text-slate-100 space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar">
            {/* Cabecera del usuario */}
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="relative shrink-0">
                <img
                  src={user?.picture}
                  alt={user?.name || 'Usuario'}
                  className="w-11 h-11 rounded-full ring-2 ring-blue-500/30 object-cover shadow"
                />
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {user?.name}
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200/80 dark:border-orange-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#fc4c02]" />
                    Strava
                  </span>
                  <span className="text-[10px] text-slate-400">·</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {t('user_menu.active', 'Activo')}
                  </span>
                </div>
              </div>
            </div>

            {/* Selector de Modelo IA Mejorado */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                    <SparklesIcon className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-tight">
                      {t('user_menu.ai_model', 'Modelo de Inteligencia Artificial')}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                {t(
                  'user_menu.ai_model_desc',
                  'Controla las respuestas del Coach, Predictor, Chat y Análisis.'
                )}
              </p>

              {/* Componente del Selector con diseño interactivo premium */}
              <div className="pt-1">
                <ModelSelector mode="menu" onSelect={() => {}} />
              </div>
            </div>

            {/* Idioma y Versión */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
              {changeLanguage && (
                <button
                  type="button"
                  onClick={changeLanguage}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <GlobeAltIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>{i18n.language?.startsWith('en') ? 'English' : 'Español'}</span>
                  <span className="text-[10px] uppercase font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/50 px-1.5 py-0.5 rounded">
                    {i18n.language?.startsWith('en') ? 'EN' : 'ES'}
                  </span>
                </button>
              )}

              <div className="ml-auto">
                <VersionBadge />
              </div>
            </div>

            {/* Cerrar Sesión */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50/70 hover:bg-rose-100/80 dark:bg-rose-950/30 dark:hover:bg-rose-950/60 border border-rose-100 dark:border-rose-900/40 transition-colors shadow-sm"
              >
                <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
                <span>{t('topbar.logout', 'Cerrar sesión')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

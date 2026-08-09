import { buildInfo, versionLabel } from '../lib/buildInfo';

/**
 * Marca de versión discreta. Cada commit genera una versión nueva (el número de
 * build es el conteo de commits), así que esto identifica exactamente qué código
 * está viendo el usuario. Al pasar el ratón muestra commit y fecha.
 */
export default function VersionBadge({ className = '' }) {
  const date = buildInfo.commitDate ? new Date(buildInfo.commitDate) : null;

  const tooltip = [
    buildInfo.subject,
    date ? date.toLocaleString() : null,
    buildInfo.dirty ? 'build con cambios sin commitear' : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      title={tooltip || undefined}
      className={`select-none text-[9.5px] font-medium tracking-tight tabular-nums text-slate-300 hover:text-slate-500 dark:text-slate-700 dark:hover:text-slate-500 transition-colors cursor-default ${className}`}
    >
      {versionLabel}
    </div>
  );
}

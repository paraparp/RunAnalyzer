/**
 * Info de build inyectada por Vite (`define` en vite.config.js) a partir de git.
 * El fallback cubre entornos donde el define no se aplica (p.ej. tooling suelto).
 */
const FALLBACK = { version: 'dev', build: null, sha: 'local', dirty: false, commitDate: null, subject: '', builtAt: null };

let info;
try {
  info = __BUILD_INFO__;
} catch {
  info = FALLBACK;
}

export const buildInfo = info || FALLBACK;

/** Etiqueta corta: `v0.0.98 · 2139ab2` */
export const versionLabel = `v${buildInfo.version} · ${buildInfo.sha}${buildInfo.dirty ? '+' : ''}`;

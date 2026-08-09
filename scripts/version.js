import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

/**
 * Deriva la versión de la app del propio historial de git: cada commit es una
 * versión nueva (el número de commits es el "patch"). No hay nada que bumpear
 * a mano ni ficheros que se ensucien en cada commit.
 *
 * En entornos de CI con clone superficial (Vercel usa depth limitado) el conteo
 * de commits no es fiable: en ese caso se omite el número de build y se muestra
 * sólo el hash, que sí es exacto.
 */
export function getBuildInfo() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const [major = '0', minor = '0'] = String(pkg.version || '0.0.0').split('.');

  const isShallow = git('rev-parse', '--is-shallow-repository') === 'true';
  const count = isShallow ? '' : git('rev-list', '--count', 'HEAD');

  const sha = (git('rev-parse', '--short=7', 'HEAD') || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
  const commitDate = git('log', '-1', '--format=%cI') || new Date().toISOString();
  const subject = git('log', '-1', '--format=%s') || process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] || '';
  const dirty = Boolean(git('status', '--porcelain'));

  const version = count ? `${major}.${minor}.${count}` : `${major}.${minor}`;

  return {
    version,
    build: count ? Number(count) : null,
    sha: sha || 'unknown',
    dirty,
    commitDate,
    subject,
    builtAt: new Date().toISOString(),
  };
}

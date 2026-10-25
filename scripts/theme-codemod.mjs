// Codemod del modo oscuro (docs/MODO_OSCURO_CLARO.md, punto 3).
// Añade a cada clase clara fija su variante `dark:` con el lenguaje de la landing.
// Solo toca clases completas sin prefijo de variante; si la cadena de clases ya
// tiene un `dark:` del mismo tipo (bg, text, border…), la deja como está.
//
// Uso: node scripts/theme-codemod.mjs [--dry] [--normalize] [ficheros...]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// La landing es siempre oscura; el resto ya tiene variantes ajustadas a mano.
const SKIP = new Set([
  'LandingPage.jsx', 'StravaCallback.jsx', 'RouteGallery.jsx', // pósteres con paleta propia
  'TodayView.jsx', 'TodayVisuals.jsx', 'TodayPlannedSession.jsx', 'CoachAI.jsx', 'UserMenu.jsx', 'TimeScope.jsx',
]);
const HUES = 'amber|emerald|green|rose|red|orange|sky|indigo|violet|purple|yellow|cyan|teal|lime|pink|fuchsia';

// [regex de la clase (sin anclas), sustitución, grupo que impide duplicar]
const RULES = [
  // Superficies
  ['bg-white', 'bg-white dark:bg-white/[0.03]', 'dark:bg-'],
  // Alfa baja: veladura sobre un fondo de color, se deja. Alfa alta: panel flotante.
  ['bg-white/[6-9]\\d', '$& dark:bg-[#0c0e12]/95', 'dark:bg-'],
  ['bg-(?:slate|gray)-(?:50|100)(?:/\\d+)?', '$& dark:bg-white/[0.04]', 'dark:bg-'],
  ['bg-(?:slate|gray)-200(?:/\\d+)?', '$& dark:bg-white/10', 'dark:bg-'],
  ['hover:bg-white', '$& dark:hover:bg-white/[0.05]', 'dark:hover:bg-'],
  ['hover:bg-(?:slate|gray)-(?:50|100|200)(?:/\\d+)?', '$& dark:hover:bg-white/[0.05]', 'dark:hover:bg-'],

  // Bordes
  ['border-(?:slate|gray)-(?:50|100|200|300)(?:/\\d+)?', '$& dark:border-white/10', 'dark:border-'],
  ['divide-(?:slate|gray)-(?:50|100|200)(?:/\\d+)?', '$& dark:divide-white/10', 'dark:divide-'],
  ['ring-(?:slate|gray)-(?:100|200)(?:/\\d+)?', '$& dark:ring-white/10', 'dark:ring-'],

  // Tinta
  ['text-(?:slate|gray)-(?:800|900|950)', '$& dark:text-white', 'dark:text-'],
  ['text-(?:slate|gray)-(?:600|700)', '$& dark:text-white/75', 'dark:text-'],
  ['text-(?:slate|gray)-500', '$& dark:text-white/55', 'dark:text-'],
  ['text-(?:slate|gray)-(?:300|400)', '$& dark:text-white/40', 'dark:text-'],
  ['hover:text-(?:slate|gray)-(?:600|700|800|900)', '$& dark:hover:text-white', 'dark:hover:text-'],

  // Acento: del azul señal al teal de la landing
  ['text-blue-(?:600|700)', 'text-teal-700 dark:text-teal-300', 'dark:text-'],
  ['hover:text-blue-(?:700|800)', 'hover:text-teal-800 dark:hover:text-teal-200', 'dark:hover:text-'],
  ['bg-blue-600', 'bg-slate-950 text-white dark:bg-white dark:text-slate-950', 'dark:bg-'],
  ['hover:bg-blue-700', 'hover:bg-slate-800 dark:hover:bg-white/90', 'dark:hover:bg-'],
  ['bg-blue-50(?:/\\d+)?', 'bg-teal-50 dark:bg-teal-400/10', 'dark:bg-'],
  ['border-blue-(?:100|200)(?:/\\d+)?', 'border-teal-200 dark:border-teal-300/25', 'dark:border-'],

  // Avisos y estados: lavados de color y su tinta
  [`bg-(?:${HUES})-(?:50|100)(?:/\\d+)?`, (m) => `${m} dark:bg-${hue(m)}-400/10`, 'dark:bg-'],
  [`border-(?:${HUES})-(?:100|200)(?:/\\d+)?`, (m) => `${m} dark:border-${hue(m)}-300/25`, 'dark:border-'],
  [`text-(?:${HUES})-(?:800|900|950)`, (m) => `${m} dark:text-${hue(m)}-200`, 'dark:text-'],
  [`text-(?:${HUES})-(?:600|700)`, (m) => `${m} dark:text-${hue(m)}-300`, 'dark:text-'],
];

// Variantes oscuras antiguas en pizarra (azuladas) → neutros blancos de la landing.
// Se aplica con --normalize a todos los ficheros, también a los ajustados a mano.
const NORMALIZE = [
  [/dark:bg-slate-900(?:\/\d+)?(?![\w/-])/g, 'dark:bg-white/[0.03]'],
  [/dark:bg-slate-800(?:\/\d+)?(?![\w/-])/g, 'dark:bg-white/[0.06]'],
  [/dark:bg-slate-700(?:\/\d+)?(?![\w/-])/g, 'dark:bg-white/10'],
  [/dark:bg-slate-(?:500|600)(?:\/\d+)?(?![\w/-])/g, 'dark:bg-white/20'],
  [/dark:hover:bg-slate-(?:700|800|900)(?:\/\d+)?(?![\w/-])/g, 'dark:hover:bg-white/[0.08]'],
  [/dark:(hover:)?border-slate-(?:700|800|900)(?:\/\d+)?(?![\w/-])/g, 'dark:$1border-white/10'],
  [/dark:(hover:)?border-slate-600(?:\/\d+)?(?![\w/-])/g, 'dark:$1border-white/20'],
  [/dark:ring-slate-(?:800|900)(?:\/\d+)?(?![\w/-])/g, 'dark:ring-white/10'],
  [/dark:divide-slate-800(?:\/\d+)?(?![\w/-])/g, 'dark:divide-white/10'],
  [/dark:text-slate-(?:50|100|200)(?![\w/-])/g, 'dark:text-white'],
  [/dark:text-slate-300(?![\w/-])/g, 'dark:text-white/75'],
  [/dark:text-slate-400(?![\w/-])/g, 'dark:text-white/55'],
  [/dark:text-slate-500(?![\w/-])/g, 'dark:text-white/45'],
  [/dark:text-slate-600(?![\w/-])/g, 'dark:text-white/40'],
  [/dark:hover:text-slate-(?:100|200|300)(?![\w/-])/g, 'dark:hover:text-white'],
];

function normalize(src) {
  let changes = 0;
  let out = src;
  for (const [re, rep] of NORMALIZE) {
    out = out.replace(re, (...m) => {
      changes++;
      return rep.replace('$1', m[1] || '');
    });
  }
  return { out, changes };
}

function hue(cls) {
  return cls.split('-')[1];
}

const compiled = RULES.map(([src, rep, guard]) => ({
  re: new RegExp(`(?<![\\w:/\\[-])${src}(?![\\w/\\[-])`, 'g'),
  rep,
  guard,
}));

// Cadena de clases que contiene la posición: del delimitador anterior al siguiente,
// sin salir de la línea.
function segment(text, i, len) {
  const isDelim = (c) => c === '"' || c === "'" || c === '`' || c === '\n' || c === '{' || c === '}';
  let a = i;
  while (a > 0 && !isDelim(text[a - 1])) a--;
  let b = i + len;
  while (b < text.length && !isDelim(text[b])) b++;
  return text.slice(a, b);
}

// Solo dentro de atributos de clase o cadenas que parecen listas de clases de Tailwind.
function looksLikeClassString(seg) {
  return /(^|\s)(flex|grid|p[xytrbl]?-|m[xytrbl]?-|text-|bg-|border|rounded|font-|w-|h-|gap-|items-|inline|block|hidden|shadow|ring)/.test(seg);
}

function transform(src) {
  let out = src;
  let changes = 0;
  for (const { re, rep, guard } of compiled) {
    let result = '';
    let last = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(out))) {
      const seg = segment(out, m.index, m[0].length);
      result += out.slice(last, m.index);
      last = m.index + m[0].length;
      if (seg.includes(guard) || !looksLikeClassString(seg)) {
        result += m[0];
        continue;
      }
      result += typeof rep === 'function' ? rep(m[0]) : rep.replace('$&', m[0]);
      changes++;
    }
    out = result + out.slice(last);
  }
  return { out, changes };
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const onlyNormalize = args.includes('--normalize');
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  const dir = 'src/components';
  files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx') && (onlyNormalize || !SKIP.has(f)))
    .map((f) => join(dir, f));
  if (onlyNormalize) files.push('src/App.jsx', 'src/lib/aiInsights.js', 'src/lib/vitalSeries.js', 'src/lib/workoutStyle.js', 'src/lib/shoePhotos.js');
}

let total = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const { out, changes } = onlyNormalize ? normalize(src) : transform(src);
  if (!changes) continue;
  total += changes;
  console.log(`${String(changes).padStart(4)}  ${f}`);
  if (!dry) writeFileSync(f, out);
}
console.log(`${total} clases${dry ? ' (simulación)' : ''}`);

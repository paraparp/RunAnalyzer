import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon, CheckCircleIcon, ChatBubbleLeftRightIcon, ExclamationTriangleIcon,
  ServerStackIcon, ShieldCheckIcon, TrashIcon, UsersIcon, XCircleIcon,
} from '@heroicons/react/24/outline';
import { authHeaders } from '../services/ai';

// ─────────────────────────────────────────────────────────────────────────────
// Panel de administración. Tres pestañas:
//   · Usuarios    — quién hay, cuándo entró, cuánto ocupan sus datos, su rol y
//                   un sync manual por si el cron se ha saltado a alguien.
//   · Sugerencias — el buzón que el MCP llena desde las conversaciones del agente
//                   (api/_lib/mcp-feedback.js). Aquí se triagea: vista, resuelta,
//                   descartada o borrada. Era lo único que no tenía dónde leerse.
//   · Sistema     — qué integraciones están configuradas en el servidor.
//
// Todo lo sirve /api/admin, que revalida el rol en cada request: este componente
// no decide nada sobre permisos, solo pinta lo que el servidor le deja ver.
// ─────────────────────────────────────────────────────────────────────────────

const api = async (path, options = {}) => {
  const headers = await authHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(`/api/admin${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
};

const post = (action, payload) =>
  api('', { method: 'POST', body: JSON.stringify({ action, ...payload }) });

const fmtBytes = (n) => {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  const days = Math.floor((Date.now() - date.getTime()) / 864e5);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} d`;
  return date.toLocaleDateString();
};

const STATUS_STYLE = {
  open:     'bg-amber-50 text-amber-700 ring-amber-200',
  ack:      'bg-blue-50 text-blue-700 ring-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  wontfix:  'bg-slate-100 text-slate-500 ring-slate-200',
};
const SEVERITY_STYLE = {
  high:   'bg-rose-50 text-rose-700 ring-rose-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low:    'bg-slate-100 text-slate-500 ring-slate-200',
};
const NEXT_STATUS_LABEL = { ack: 'Marcar vista', resolved: 'Resolver', wontfix: 'Descartar' };

const Pill = ({ children, className = '' }) => (
  <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ${className}`}>{children}</span>
);

const Stat = ({ label, value }) => (
  <div className="bg-white rounded-2xl ring-1 ring-slate-200 px-4 py-3">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-xl font-bold text-slate-900 mt-0.5">{value}</div>
  </div>
);

const ErrorBanner = ({ message }) => (
  <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 ring-1 ring-rose-200 rounded-xl px-3 py-2.5">
    <ExclamationTriangleIcon className="w-4 h-4 shrink-0" /> {message}
  </div>
);

// ── Usuarios ────────────────────────────────────────────────────────────────
const UsersTab = ({ data, reload }) => {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const act = async (id, fn) => {
    setBusy(id); setError(null);
    try { await fn(); await reload(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Usuarios" value={data.totals.users} />
        <Stat label="Admins" value={data.totals.admins} />
        <Stat label="Con datos" value={data.totals.with_data} />
        <Stat label="Activos 7d" value={data.totals.active_7d} />
        <Stat label="Activos 30d" value={data.totals.active_30d} />
        <Stat label="Almacenado" value={fmtBytes(data.totals.bytes)} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="text-left font-semibold px-4 py-3">Usuario</th>
              <th className="text-left font-semibold px-4 py-3">Último acceso</th>
              <th className="text-left font-semibold px-4 py-3">Alta</th>
              <th className="text-right font-semibold px-4 py-3">Datos</th>
              <th className="text-right font-semibold px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map(u => (
              <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {u.picture
                      ? <img src={u.picture} alt="" className="w-7 h-7 rounded-full shrink-0" />
                      : <div className="w-7 h-7 rounded-full bg-slate-200 shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                        {u.name || u.email}
                        {u.is_admin && <Pill className="bg-blue-50 text-blue-700 ring-blue-200">admin</Pill>}
                      </div>
                      <div className="text-xs text-slate-400 truncate">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{fmtDate(u.last_sign_in_at)}</td>
                <td className="px-4 py-3 text-slate-600">{fmtDate(u.created_at)}</td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {fmtBytes(u.bytes)}
                  <span className="text-xs text-slate-400"> · {u.keys} claves</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      disabled={busy === u.id}
                      onClick={() => act(u.id, () => post('sync_user', { user_id: u.id }))}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg ring-1 ring-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {busy === u.id ? 'Sincronizando…' : 'Sync'}
                    </button>
                    <button
                      disabled={busy === u.id}
                      onClick={() => act(u.id, () => post('set_admin', { user_id: u.id, admin: !u.is_admin }))}
                      className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ring-1 disabled:opacity-50 ${u.is_admin
                        ? 'ring-rose-200 text-rose-600 hover:bg-rose-50'
                        : 'ring-blue-200 text-blue-600 hover:bg-blue-50'}`}
                    >
                      {u.is_admin ? 'Revocar' : 'Hacer admin'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Sugerencias del MCP ─────────────────────────────────────────────────────
const IssuesTab = ({ data, reload, usersById }) => {
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const act = async (id, fn) => {
    setBusy(id); setError(null);
    try { await fn(); await reload(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const shown = useMemo(
    () => (data?.issues ?? []).filter(e => filter === 'all' || e.status === filter),
    [data, filter],
  );

  if (!data) return null;
  const filters = [
    ['open', 'Abiertas', data.totals.open],
    ['ack', 'Vistas', data.totals.ack],
    ['resolved', 'Resueltas', data.totals.resolved],
    ['wontfix', 'Descartadas', data.totals.wontfix],
    ['all', 'Todas', data.totals.total],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {filters.map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ring-1 transition ${filter === id
              ? 'bg-blue-600 text-white ring-blue-600'
              : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
          >
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      {shown.length === 0 && (
        <div className="bg-white rounded-2xl ring-1 ring-slate-200 px-4 py-10 text-center text-sm text-slate-400">
          Nada por aquí. El agente escribe en este buzón cuando encuentra algo raro en los datos o en las tools.
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map(e => (
          <div key={`${e.user_id}:${e.id}`} className="bg-white rounded-2xl ring-1 ring-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{e.title}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <Pill className={STATUS_STYLE[e.status] ?? STATUS_STYLE.wontfix}>{e.status}</Pill>
                  <Pill className={SEVERITY_STYLE[e.severity] ?? SEVERITY_STYLE.low}>{e.severity}</Pill>
                  <Pill className="bg-slate-100 text-slate-500 ring-slate-200">{e.category}</Pill>
                  {e.tool && <Pill className="bg-violet-50 text-violet-700 ring-violet-200">{e.tool}</Pill>}
                  {e.occurrences > 1 && <Pill className="bg-rose-50 text-rose-700 ring-rose-200">×{e.occurrences}</Pill>}
                </div>
              </div>
              <div className="text-right text-xs text-slate-400 shrink-0">
                <div>{fmtDate(e.last_seen_at ?? e.created_at)}</div>
                <div className="truncate max-w-[160px]">{usersById.get(e.user_id)?.email ?? String(e.user_id).slice(0, 8)}</div>
              </div>
            </div>

            {e.detail && <p className="text-sm text-slate-600 mt-3 whitespace-pre-wrap leading-relaxed">{e.detail}</p>}
            {e.note && <p className="text-xs text-slate-500 mt-2 italic">Nota: {e.note}</p>}

            <div className="flex flex-wrap gap-2 mt-3">
              {['ack', 'resolved', 'wontfix'].filter(s => s !== e.status).map(s => (
                <button
                  key={s}
                  disabled={busy === e.id}
                  onClick={() => act(e.id, () => post('update_issue', { user_id: e.user_id, issue_id: e.id, status: s }))}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg ring-1 ring-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {NEXT_STATUS_LABEL[s]}
                </button>
              ))}
              <button
                disabled={busy === e.id}
                onClick={() => act(e.id, () => post('delete_issue', { user_id: e.user_id, issue_id: e.id }))}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg ring-1 ring-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <TrashIcon className="w-3.5 h-3.5" /> Borrar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Sistema ─────────────────────────────────────────────────────────────────
const Flag = ({ label, on }) => (
  <div className="flex items-center gap-2 text-sm">
    {on
      ? <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0" />
      : <XCircleIcon className="w-4 h-4 text-slate-300 shrink-0" />}
    <span className={on ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
  </div>
);

const SystemTab = ({ data }) => {
  if (!data) return null;
  const groups = [
    ['Supabase', [['URL', data.supabase.url], ['Service role key', data.supabase.service_role]]],
    ['Strava', [['Client ID', data.strava.client_id], ['Client secret', data.strava.client_secret]]],
    ['MCP / Cron', [['JWT secret', data.mcp.jwt_secret], ['Cron secret', data.cron.secret]]],
    ['IA', Object.entries(data.ai)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {groups.map(([title, flags]) => (
          <div key={title} className="bg-white rounded-2xl ring-1 ring-slate-200 p-4 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
            {flags.map(([label, on]) => <Flag key={label} label={label} on={on} />)}
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-4 text-sm text-slate-600">
        <span className="font-semibold text-slate-900">Runtime</span>
        <span className="text-slate-400"> · </span>
        Node {data.runtime.node} · {data.runtime.env}{data.runtime.region ? ` · ${data.runtime.region}` : ''}
      </div>
      <p className="text-xs text-slate-400">
        Solo se indica si cada variable está definida; sus valores no salen nunca del servidor.
      </p>
    </div>
  );
};

// ── Panel ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'users',  label: 'Usuarios',    icon: UsersIcon },
  { id: 'issues', label: 'Sugerencias', icon: ChatBubbleLeftRightIcon },
  { id: 'system', label: 'Sistema',     icon: ServerStackIcon },
];

export default function AdminPanel() {
  const [tab, setTab] = useState('users');
  const [overview, setOverview] = useState(null);
  const [issuesData, setIssuesData] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, i, h] = await Promise.all([
        api('?action=overview'),
        api('?action=issues'),
        api('?action=health'),
      ]);
      setOverview(o); setIssuesData(i); setHealthData(h);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const usersById = useMemo(
    () => new Map((overview?.users ?? []).map(u => [u.id, u])),
    [overview],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 ring-1 ring-blue-100 flex items-center justify-center">
            <ShieldCheckIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Administración</h2>
            <p className="text-sm text-slate-500">Usuarios, buzón del agente y estado del servidor.</p>
          </div>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          disabled={loading}
          className="text-xs font-semibold px-3 py-2 rounded-xl ring-1 ring-slate-200 text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refrescar
        </button>
      </div>

      <div className="flex gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`text-sm font-semibold px-3.5 py-2 rounded-xl inline-flex items-center gap-2 transition ${tab === id
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            <Icon className="w-4 h-4" /> {label}
            {id === 'issues' && issuesData?.totals.open > 0 && (
              <span className={`text-[11px] px-1.5 rounded-md ${tab === id ? 'bg-white/20' : 'bg-amber-100 text-amber-700'}`}>
                {issuesData.totals.open}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && !overview ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-10 justify-center">
          <ArrowPathIcon className="w-5 h-5 animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          {tab === 'users' && <UsersTab data={overview} reload={load} />}
          {tab === 'issues' && <IssuesTab data={issuesData} reload={load} usersById={usersById} />}
          {tab === 'system' && <SystemTab data={healthData} />}
        </>
      )}
    </div>
  );
}

-- ============================================================================
-- RunAnalyzer · Esquema Supabase
-- Ejecuta este script en el SQL Editor de tu proyecto (Database → SQL Editor).
-- ============================================================================

-- Almacén clave/valor por usuario. Es el reemplazo 1:1 de localStorage:
--   key   = la antigua clave de localStorage (p.ej. 'stravaData', 'garmin_cardiac_data')
--   value = el mismo string JSON que se guardaba en localStorage
-- La app carga el blob entero en memoria y lo procesa en cliente, igual que antes.
create table if not exists public.user_storage (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Row Level Security: cada usuario sólo ve y modifica sus propias filas.
alter table public.user_storage enable row level security;

drop policy if exists "user_storage_select_own" on public.user_storage;
create policy "user_storage_select_own"
  on public.user_storage for select
  using (auth.uid() = user_id);

drop policy if exists "user_storage_insert_own" on public.user_storage;
create policy "user_storage_insert_own"
  on public.user_storage for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_storage_update_own" on public.user_storage;
create policy "user_storage_update_own"
  on public.user_storage for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_storage_delete_own" on public.user_storage;
create policy "user_storage_delete_own"
  on public.user_storage for delete
  using (auth.uid() = user_id);

-- ============================================================================
-- OAuth: authorization codes ya canjeados (single-use del servidor MCP).
-- Los codes son JWT sin estado; esta tabla registra su `jti` al canjearlos para
-- impedir el replay dentro de su ventana de validez. Solo se accede con la
-- SERVICE ROLE key (salta RLS); habilitamos RLS sin políticas para bloquear anon.
-- ============================================================================
create table if not exists public.oauth_used_codes (
  jti        text        primary key,
  expires_at timestamptz not null,
  used_at    timestamptz not null default now()
);
alter table public.oauth_used_codes enable row level security;

-- Limpieza opcional de jtis ya expirados (ejecutar por cron/pg_cron si se desea):
--   delete from public.oauth_used_codes where expires_at < now();

-- Mantener updated_at al día en cada upsert.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_storage_touch on public.user_storage;
create trigger trg_user_storage_touch
  before update on public.user_storage
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Administradores.
--
-- El rol NO vive en el cliente: ni el email ni el flag salen del bundle JS.
-- Dos tablas:
--   · app_admins       — quién es admin (una fila por usuario ya registrado).
--   · admin_seed_emails— lista blanca de emails que se promueven al registrarse.
--
-- Seguridad:
--   · app_admins tiene RLS y SOLO una política de SELECT de la PROPIA fila: un
--     usuario puede comprobar si él es admin, no puede ver ni tocar el resto.
--     Sin políticas de insert/update/delete nadie escribe desde el cliente;
--     solo la SERVICE ROLE key (servidor) puede.
--   · admin_seed_emails tiene RLS SIN NINGUNA política: es invisible para anon
--     y authenticated. Solo la lee el trigger (security definer) y el servidor.
-- El gating del UI es cosmético; la frontera real son las policies y
-- `ensureAdmin()` en api/_lib/admin.js, que revalida en cada request.
-- ============================================================================
create table if not exists public.app_admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
  on public.app_admins for select
  using (auth.uid() = user_id);

create table if not exists public.admin_seed_emails (
  email      text        primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_seed_emails enable row level security;  -- sin políticas: cerrada al cliente

insert into public.admin_seed_emails (email) values ('paraparp@gmail.com')
  on conflict (email) do nothing;

-- Promoción automática: si un email de la lista blanca se registra (o ya estaba
-- registrado, por el backfill de más abajo), entra en app_admins.
create or replace function public.promote_seed_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.admin_seed_emails s where lower(s.email) = lower(new.email)) then
    insert into public.app_admins (user_id, email) values (new.id, new.email)
      on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- El trigger va sobre auth.users, un esquema que pertenece a supabase_auth_admin.
-- Según el proyecto puede no dejarse crear desde el SQL Editor; como todo el
-- script corre en una transacción, un error aquí revertiría también las tablas.
-- Por eso se captura: si no se puede, se avisa y el resto queda instalado (la
-- promoción se hace entonces a mano con el insert del backfill de más abajo).
do $$
begin
  execute 'drop trigger if exists trg_promote_seed_admin on auth.users';
  execute 'create trigger trg_promote_seed_admin
             after insert on auth.users
             for each row execute function public.promote_seed_admin()';
exception
  when insufficient_privilege or undefined_table then
    raise notice 'No se pudo crear el trigger sobre auth.users (%). Los admins nuevos habra que promoverlos a mano.', sqlerrm;
end;
$$;

-- Backfill para los emails de la lista que YA tienen cuenta.
insert into public.app_admins (user_id, email)
select u.id, u.email
  from auth.users u
  join public.admin_seed_emails s on lower(s.email) = lower(u.email)
  on conflict (user_id) do nothing;

-- El cliente pregunta "¿soy admin?" por RPC. Es SECURITY DEFINER pero solo
-- responde por auth.uid(): no acepta parámetros, así que no se puede sondear a
-- terceros con ella.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── Agregados para el panel de admin ────────────────────────────────────────
-- Se calculan en SQL para no mover los blobs (stravaData pesa megas) por la red.
-- Solo ejecutables por service_role: el panel entra por /api/admin, que ya ha
-- revalidado el rol; desde el cliente (anon/authenticated) están revocadas.
create or replace function public.admin_user_stats()
returns table (user_id uuid, keys integer, bytes bigint, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.user_id, count(*)::integer, sum(coalesce(octet_length(s.value), 0))::bigint, max(s.updated_at)
    from public.user_storage s
   group by s.user_id;
$$;
revoke all on function public.admin_user_stats() from public, anon, authenticated;
grant execute on function public.admin_user_stats() to service_role;

create or replace function public.admin_user_keys(target uuid)
returns table (key text, bytes bigint, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.key, coalesce(octet_length(s.value), 0)::bigint, s.updated_at
    from public.user_storage s
   where s.user_id = target
   order by 2 desc;
$$;
revoke all on function public.admin_user_keys(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_keys(uuid) to service_role;

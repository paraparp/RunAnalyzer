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

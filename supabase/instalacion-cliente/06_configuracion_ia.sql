-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 06: Configuración de la IA (llave en Vault y modelo)
-- Origen: supabase/migrations/20261008100000_sc_configuracion_ia.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- Vault viene instalado en todos los proyectos de Supabase; esto solo lo asegura.
create extension if not exists supabase_vault with schema vault;

-- Configuración de la IA desde la app: llave de Anthropic y modelo.
--
-- La llave se guarda cifrada en Supabase Vault y NUNCA vuelve al navegador:
-- la app solo puede escribirla o borrarla; las Edge Functions la leen con la
-- llave de servicio. De la llave solo se expone si está configurada y sus
-- últimos 4 caracteres.
--
-- El proyecto de Supabase es compartido con otras aplicaciones, así que cambiar
-- la configuración queda restringido a los administradores de SusConsultores.

-- ---------------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------------
create table if not exists public.sc_administradores (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.sc_administradores is
  'Usuarios que pueden cambiar la configuración de la IA (llave y modelo).';
alter table public.sc_administradores enable row level security;
drop policy if exists sc_administradores_lectura on public.sc_administradores;
create policy sc_administradores_lectura on public.sc_administradores
  for select to authenticated using (true);

-- Administradores iniciales: quienes ya usan la app (crearon informes).
insert into public.sc_administradores (user_id)
select distinct creado_por from public.sc_informes where creado_por is not null
on conflict do nothing;

create or replace function public.sc_es_administrador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.sc_administradores where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Configuración (una sola fila)
-- ---------------------------------------------------------------------------
create table if not exists public.sc_configuracion (
  id                     smallint primary key default 1 check (id = 1),
  modelo                 text not null default 'claude-sonnet-5',
  clave_final            text,
  clave_actualizada_at   timestamptz,
  clave_actualizada_por  uuid references auth.users(id) on delete set null,
  updated_at             timestamptz not null default now(),
  actualizado_por        uuid references auth.users(id) on delete set null
);
comment on table public.sc_configuracion is
  'Configuración de la IA. La llave vive en Vault (secreto sc_anthropic_api_key); aquí solo sus últimos 4 caracteres.';
insert into public.sc_configuracion (id) values (1) on conflict do nothing;

alter table public.sc_configuracion enable row level security;
drop policy if exists sc_configuracion_lectura on public.sc_configuracion;
create policy sc_configuracion_lectura on public.sc_configuracion
  for select to authenticated using (true);
-- Sin políticas de escritura: solo se cambia con las funciones de abajo.

-- ---------------------------------------------------------------------------
-- Escritura (solo administradores)
-- ---------------------------------------------------------------------------
create or replace function public.sc_guardar_modelo_ia(p_modelo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sc_es_administrador() then
    raise exception 'Solo un administrador de SusConsultores puede cambiar el modelo.';
  end if;
  if p_modelo is null or p_modelo !~ '^claude-[a-z0-9][a-z0-9.\-]{2,60}$' then
    raise exception 'Identificador de modelo no válido: %', p_modelo;
  end if;
  update public.sc_configuracion
     set modelo = p_modelo, updated_at = now(), actualizado_por = auth.uid()
   where id = 1;
end;
$$;

create or replace function public.sc_guardar_clave_ia(p_clave text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
  v_clave text := btrim(coalesce(p_clave, ''));
begin
  if not public.sc_es_administrador() then
    raise exception 'Solo un administrador de SusConsultores puede cambiar la llave.';
  end if;
  if v_clave !~ '^sk-ant-[A-Za-z0-9_\-]{20,}$' then
    raise exception 'La llave no tiene el formato de Anthropic (empieza por sk-ant-).';
  end if;

  select id into v_id from vault.secrets where name = 'sc_anthropic_api_key';
  if v_id is null then
    perform vault.create_secret(v_clave, 'sc_anthropic_api_key', 'Llave de Anthropic de SusConsultores (estados financieros)');
  else
    perform vault.update_secret(v_id, v_clave);
  end if;

  update public.sc_configuracion
     set clave_final = right(v_clave, 4),
         clave_actualizada_at = now(),
         clave_actualizada_por = auth.uid(),
         updated_at = now(),
         actualizado_por = auth.uid()
   where id = 1;
end;
$$;

create or replace function public.sc_borrar_clave_ia()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not public.sc_es_administrador() then
    raise exception 'Solo un administrador de SusConsultores puede quitar la llave.';
  end if;
  delete from vault.secrets where name = 'sc_anthropic_api_key';
  update public.sc_configuracion
     set clave_final = null, clave_actualizada_at = now(), clave_actualizada_por = auth.uid(),
         updated_at = now(), actualizado_por = auth.uid()
   where id = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lectura de la llave: SOLO la llave de servicio (Edge Functions)
-- ---------------------------------------------------------------------------
create or replace function public.sc_config_ia_servidor()
returns table (modelo text, clave text)
language sql
stable
security definer
set search_path = public, vault
as $$
  select c.modelo,
         (select decrypted_secret from vault.decrypted_secrets where name = 'sc_anthropic_api_key' limit 1)
    from public.sc_configuracion c
   where c.id = 1;
$$;

revoke all on function public.sc_config_ia_servidor() from public, anon, authenticated;
grant execute on function public.sc_config_ia_servidor() to service_role;

revoke all on function public.sc_guardar_clave_ia(text) from public, anon;
revoke all on function public.sc_borrar_clave_ia() from public, anon;
revoke all on function public.sc_guardar_modelo_ia(text) from public, anon;
grant execute on function public.sc_guardar_clave_ia(text) to authenticated;
grant execute on function public.sc_borrar_clave_ia() to authenticated;
grant execute on function public.sc_guardar_modelo_ia(text) to authenticated;
grant execute on function public.sc_es_administrador() to authenticated;


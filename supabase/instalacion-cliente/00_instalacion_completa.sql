-- ============================================================================
-- SusConsultores · Estados Financieros — INSTALACIÓN COMPLETA (pasos 01 a 06)
-- Pegar en Supabase > SQL Editor > New query y ejecutar (Run).
-- Va en una sola transacción: si algo falla, no queda nada a medias.
-- Después: 07_primer_administrador.sql y 99_verificar.sql.
-- ============================================================================

begin;

-- >>> 01_tablas_base.sql
-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 01: Tablas base, catálogo vacío y seguridad (RLS)
-- Origen: supabase/migrations/20260922120000_sc_init.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- SusConsultores — Automatización de Estados Financieros
-- Prefijo sc_ para convivir con las demás apps del proyecto.

create table if not exists public.sc_empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  nit         text,
  created_at  timestamptz not null default now()
);
comment on table public.sc_empresas is 'Empresas cliente de SusConsultores para las que se emite el informe.';

-- Catálogo institucional (RF-029): rubros presentables y su número de nota.
create table if not exists public.sc_rubros (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  estado        text not null check (estado in ('ESF','ER')),
  seccion       text not null,
  nombre        text not null,
  nota_numero   int,
  orden         int  not null default 0,
  naturaleza    text not null default 'deudora' check (naturaleza in ('deudora','acreedora')),
  activo        boolean not null default true,
  origen        text not null default 'semilla_provisional',
  created_at    timestamptz not null default now()
);
comment on table public.sc_rubros is 'Rubros del formato institucional. origen=semilla_provisional marca las filas sembradas por el equipo de desarrollo: deben reemplazarse por el catalogo real de SusConsultores (pregunta abierta P1 del documento de requerimientos).';
comment on column public.sc_rubros.naturaleza is 'Usada solo para el signo de presentacion. Por confirmar con el cliente.';

-- Reglas determinísticas de mapeo por prefijo PUC. Se evalúan antes del modelo.
create table if not exists public.sc_reglas_mapeo (
  id            uuid primary key default gen_random_uuid(),
  prefijo       text not null,
  rubro_codigo  text not null references public.sc_rubros(codigo) on update cascade,
  prioridad     int not null default 0,
  activo        boolean not null default true,
  origen        text not null default 'semilla_provisional',
  created_at    timestamptz not null default now(),
  unique (prefijo, rubro_codigo)
);
comment on table public.sc_reglas_mapeo is 'Mapeo deterministico por prefijo del codigo PUC. Gana el prefijo mas largo.';

create table if not exists public.sc_informes (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid references public.sc_empresas(id) on delete set null,
  nombre_archivo    text not null,
  hoja_origen       text,
  periodo_actual    int  not null,
  periodo_anterior  int,
  estado            text not null default 'borrador' check (estado in ('borrador','en_revision','aprobado')),
  mapeo_columnas    jsonb,
  creado_por        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  aprobado_por      uuid references auth.users(id) on delete set null,
  aprobado_at       timestamptz
);
comment on table public.sc_informes is 'Una ejecucion del proceso. El archivo fuente NO se almacena: solo sus filas normalizadas (decision de privacidad, RNF-12 — por confirmar con el cliente).';

create table if not exists public.sc_cuentas (
  id              uuid primary key default gen_random_uuid(),
  informe_id      uuid not null references public.sc_informes(id) on delete cascade,
  fila_origen     int,
  codigo          text not null,
  nombre          text not null,
  nivel           text not null check (nivel in ('grupo','cuenta','subcuenta','auxiliar','subauxiliar')),
  es_hoja         boolean not null default true,
  saldo_actual    numeric(18,2) not null default 0,
  saldo_anterior  numeric(18,2),
  created_at      timestamptz not null default now()
);
comment on column public.sc_cuentas.es_hoja is 'true = nivel mas profundo de su rama. Solo las hojas alimentan las notas, para no sumar dos veces el saldo de una cuenta y el de su subcuenta.';
create index if not exists sc_cuentas_informe_idx on public.sc_cuentas(informe_id);

create table if not exists public.sc_clasificaciones (
  id            uuid primary key default gen_random_uuid(),
  informe_id    uuid not null references public.sc_informes(id) on delete cascade,
  cuenta_id     uuid not null unique references public.sc_cuentas(id) on delete cascade,
  rubro_codigo  text references public.sc_rubros(codigo) on update cascade,
  confianza     numeric(4,3),
  origen        text not null check (origen in ('regla','memoria','ia','manual')),
  estado        text not null default 'propuesta' check (estado in ('propuesta','confirmada','sin_clasificar','excluida')),
  razon         text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);
comment on column public.sc_clasificaciones.estado is 'excluida = el contador decidio que esta cuenta no se presenta. Sigue contando para la validacion de integridad de importes.';
create index if not exists sc_clasificaciones_informe_idx on public.sc_clasificaciones(informe_id);

-- Memoria de correcciones por empresa: lo confirmado no se vuelve a consultar.
create table if not exists public.sc_mapeos_confirmados (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.sc_empresas(id) on delete cascade,
  codigo         text not null,
  nombre_norm    text not null,
  rubro_codigo   text not null references public.sc_rubros(codigo) on update cascade,
  confirmado_por uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (empresa_id, codigo, nombre_norm)
);

create table if not exists public.sc_validaciones (
  id          uuid primary key default gen_random_uuid(),
  informe_id  uuid not null references public.sc_informes(id) on delete cascade,
  codigo      text not null,
  titulo      text not null,
  ok          boolean not null,
  bloqueante  boolean not null default false,
  detalle     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists sc_validaciones_informe_idx on public.sc_validaciones(informe_id);

create table if not exists public.sc_auditoria (
  id          uuid primary key default gen_random_uuid(),
  informe_id  uuid references public.sc_informes(id) on delete cascade,
  usuario_id  uuid references auth.users(id) on delete set null,
  accion      text not null,
  detalle     jsonb,
  created_at  timestamptz not null default now()
);
comment on table public.sc_auditoria is 'Quien proceso, que corrigio y quien aprobo (RNF-09).';

-- RLS: acceso solo a usuarios autenticados (oficina única, RNF-07).
do $$
declare t text;
begin
  foreach t in array array[
    'sc_empresas','sc_rubros','sc_reglas_mapeo','sc_informes','sc_cuentas',
    'sc_clasificaciones','sc_mapeos_confirmados','sc_validaciones','sc_auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_authenticated_all') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
    end if;
  end loop;
end $$;


-- >>> 02_catalogo_semilla.sql
-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 02: Catálogo semilla de rubros y reglas PUC
-- Origen: supabase/migrations/20260922120100_sc_catalogo_semilla.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- Catálogo institucional SEMILLA — provisional, sobre la estructura del PUC.
-- Debe reemplazarse por el catálogo real de SusConsultores (pregunta P1).
-- "Ingresos operacionales" queda en la nota 13, la única referencia de
-- numeración que dio el cliente.
insert into public.sc_rubros (codigo, estado, seccion, nombre, nota_numero, orden, naturaleza) values
  ('EFECTIVO',        'ESF','activo_corriente',     'Efectivo y equivalentes al efectivo',              1,  10, 'deudora'),
  ('INVERSIONES',     'ESF','activo_corriente',     'Inversiones',                                      2,  20, 'deudora'),
  ('DEUDORES',        'ESF','activo_corriente',     'Deudores comerciales y otras cuentas por cobrar',  3,  30, 'deudora'),
  ('INVENTARIOS',     'ESF','activo_corriente',     'Inventarios',                                      4,  40, 'deudora'),
  ('OTROS_ACT_CTE',   'ESF','activo_corriente',     'Otros activos corrientes',                         5,  50, 'deudora'),
  ('PPE',             'ESF','activo_no_corriente',  'Propiedades, planta y equipo',                     6,  60, 'deudora'),
  ('INTANGIBLES',     'ESF','activo_no_corriente',  'Activos intangibles y otros no corrientes',        7,  70, 'deudora'),
  ('OBLIG_FIN',       'ESF','pasivo_corriente',     'Obligaciones financieras',                         8,  80, 'acreedora'),
  ('PROVEEDORES_CXP', 'ESF','pasivo_corriente',     'Proveedores y cuentas por pagar',                  9,  90, 'acreedora'),
  ('IMPUESTOS',       'ESF','pasivo_corriente',     'Impuestos, gravamenes y tasas',                   10, 100, 'acreedora'),
  ('OTROS_PASIVOS',   'ESF','pasivo_corriente',     'Beneficios a empleados y otros pasivos',          11, 110, 'acreedora'),
  ('PATRIMONIO',      'ESF','patrimonio',           'Patrimonio',                                      12, 120, 'acreedora'),
  ('INGRESOS_OPER',   'ER', 'ingresos',             'Ingresos operacionales',                          13, 130, 'acreedora'),
  ('COSTO_VENTAS',    'ER', 'costos',               'Costo de ventas',                                 14, 140, 'deudora'),
  ('GASTOS_ADMIN',    'ER', 'gastos',               'Gastos de administracion',                        15, 150, 'deudora'),
  ('GASTOS_VENTAS',   'ER', 'gastos',               'Gastos de ventas',                                16, 160, 'deudora'),
  ('OTROS_INGRESOS',  'ER', 'otros_ingresos',       'Otros ingresos',                                  17, 170, 'acreedora'),
  ('OTROS_GASTOS',    'ER', 'otros_gastos',         'Otros gastos',                                    18, 180, 'deudora'),
  ('IMPUESTO_RENTA',  'ER', 'impuesto',             'Impuesto de renta y complementarios',             19, 190, 'deudora')
on conflict (codigo) do nothing;

insert into public.sc_reglas_mapeo (prefijo, rubro_codigo, prioridad) values
  ('11','EFECTIVO',10), ('12','INVERSIONES',10), ('13','DEUDORES',10),
  ('14','INVENTARIOS',10), ('15','PPE',10), ('16','INTANGIBLES',10),
  ('17','OTROS_ACT_CTE',10), ('18','OTROS_ACT_CTE',10), ('19','OTROS_ACT_CTE',10),
  ('21','OBLIG_FIN',10), ('22','PROVEEDORES_CXP',10), ('23','PROVEEDORES_CXP',10),
  ('24','IMPUESTOS',10), ('25','OTROS_PASIVOS',10), ('26','OTROS_PASIVOS',10),
  ('27','OTROS_PASIVOS',10), ('28','OTROS_PASIVOS',10), ('29','OTROS_PASIVOS',10),
  ('31','PATRIMONIO',10), ('32','PATRIMONIO',10), ('33','PATRIMONIO',10),
  ('34','PATRIMONIO',10), ('35','PATRIMONIO',10), ('36','PATRIMONIO',10),
  ('37','PATRIMONIO',10), ('38','PATRIMONIO',10),
  ('41','INGRESOS_OPER',10), ('42','OTROS_INGRESOS',10),
  ('51','GASTOS_ADMIN',10), ('52','GASTOS_VENTAS',10),
  ('53','OTROS_GASTOS',10), ('54','IMPUESTO_RENTA',10),
  ('6','COSTO_VENTAS',5), ('7','COSTO_VENTAS',5)
on conflict (prefijo, rubro_codigo) do nothing;


-- >>> 03_extraccion_completa.sql
-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 03: Extracción completa (jerarquía, terceros, notas del archivo)
-- Origen: supabase/migrations/20260923090000_sc_extraccion_completa.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- Extracción completa: dos hojas de balance (año actual y anterior) + hoja de notas.
-- Se conserva toda la jerarquía (padres, hojas y terceros) y la trazabilidad a celda.

alter table public.sc_cuentas alter column saldo_actual drop not null;
alter table public.sc_cuentas alter column saldo_actual drop default;

alter table public.sc_cuentas add column if not exists clave          text;
alter table public.sc_cuentas add column if not exists codigo_padre   text;
alter table public.sc_cuentas add column if not exists nit            text;
alter table public.sc_cuentas add column if not exists fila_anterior  int;
alter table public.sc_cuentas add column if not exists celda_actual   text;
alter table public.sc_cuentas add column if not exists celda_anterior text;
alter table public.sc_cuentas add column if not exists saldo_inicial  numeric(18,2);

alter table public.sc_cuentas drop constraint if exists sc_cuentas_nivel_check;
alter table public.sc_cuentas add constraint sc_cuentas_nivel_check
  check (nivel in ('grupo','cuenta','subcuenta','auxiliar','subauxiliar','tercero'));

comment on column public.sc_cuentas.saldo_actual is 'Saldo de cierre del año actual, tal como viene en su hoja. null = la cuenta no existe ese año.';
comment on column public.sc_cuentas.saldo_anterior is 'Saldo de cierre del año anterior, leído de la hoja del año anterior. null = no existe ese año.';
comment on column public.sc_cuentas.saldo_inicial is 'Columna de saldo inicial de la hoja del año actual. Solo se usa para validar continuidad.';
comment on column public.sc_cuentas.nivel is 'tercero = detalle por NIT bajo una cuenta. Se conserva para trazabilidad; no alimenta notas.';

alter table public.sc_informes add column if not exists hoja_anterior       text;
alter table public.sc_informes add column if not exists hoja_notas          text;
alter table public.sc_informes add column if not exists identificacion      jsonb;
alter table public.sc_informes add column if not exists reporte_extraccion  jsonb;
comment on column public.sc_informes.identificacion is 'Cómo se identificaron las tres hojas: método (automatico | ia | manual), evidencia y candidatas.';

create table if not exists public.sc_notas_archivo (
  id           uuid primary key default gen_random_uuid(),
  informe_id   uuid not null references public.sc_informes(id) on delete cascade,
  orden        int  not null,
  numero       text,
  titulo       text not null,
  seccion      text,
  fila_inicio  int,
  fila_fin     int,
  created_at   timestamptz not null default now()
);
comment on table public.sc_notas_archivo is 'Notas extraídas de la hoja de notas del Excel. numero es texto y puede repetirse o faltar: así viene en el archivo del cliente.';
create index if not exists sc_notas_archivo_informe_idx on public.sc_notas_archivo(informe_id);

create table if not exists public.sc_notas_archivo_lineas (
  id              uuid primary key default gen_random_uuid(),
  nota_id         uuid not null references public.sc_notas_archivo(id) on delete cascade,
  informe_id      uuid not null references public.sc_informes(id) on delete cascade,
  orden           int  not null,
  fila_origen     int,
  etiqueta        text,
  sangria         int  not null default 0,
  tipo            text not null check (tipo in ('encabezado','detalle','subtotal','total','texto')),
  valor_actual    numeric(18,2),
  valor_anterior  numeric(18,2),
  celda_actual    text,
  celda_anterior  text
);
create index if not exists sc_notas_archivo_lineas_nota_idx on public.sc_notas_archivo_lineas(nota_id);

do $$
declare t text;
begin
  foreach t in array array['sc_notas_archivo','sc_notas_archivo_lineas'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_authenticated_all') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
    end if;
  end loop;
end $$;


-- >>> 04_notas_por_hoja.sql
-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 04: Hoja de origen de cada nota
-- Origen: supabase/migrations/20260925090000_sc_notas_hoja.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- Las notas pueden venir en varias hojas: cada nota guarda la suya.
alter table public.sc_notas_archivo add column if not exists hoja text;
comment on column public.sc_notas_archivo.hoja is 'Hoja del Excel de donde salió la nota.';


-- >>> 05_encabezado_informe.sql
-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 05: Encabezado del informe y firmantes por empresa
-- Origen: supabase/migrations/20261008090000_sc_encabezado.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- Encabezado del informe final: datos corporativos leídos del archivo (razón social,
-- NIT, fecha de corte) más los firmantes, que se recuerdan por empresa.

alter table public.sc_empresas add column if not exists ciudad              text;
alter table public.sc_empresas add column if not exists representante_legal text;
alter table public.sc_empresas add column if not exists contador            text;
alter table public.sc_empresas add column if not exists tarjeta_contador    text;
alter table public.sc_empresas add column if not exists revisor_fiscal      text;
alter table public.sc_empresas add column if not exists tarjeta_revisor     text;

create index if not exists sc_empresas_nit_idx on public.sc_empresas (nit);

alter table public.sc_informes add column if not exists encabezado jsonb;
comment on column public.sc_informes.encabezado is
  'Encabezado con el que se emite el informe: razón social, NIT, ciudad, fechas de corte, moneda y firmantes. Se prellena desde el archivo y lo ajusta el contador.';


-- >>> 06_configuracion_ia.sql
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


commit;

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

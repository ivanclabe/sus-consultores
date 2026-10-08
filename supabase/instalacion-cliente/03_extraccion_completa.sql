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


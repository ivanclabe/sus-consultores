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


-- ============================================================================
-- SusConsultores · Estados Financieros — instalación en un proyecto Supabase nuevo
-- Paso 04: Hoja de origen de cada nota
-- Origen: supabase/migrations/20260925090000_sc_notas_hoja.sql
-- Se puede ejecutar más de una vez: no borra datos.
-- ============================================================================

-- Las notas pueden venir en varias hojas: cada nota guarda la suya.
alter table public.sc_notas_archivo add column if not exists hoja text;
comment on column public.sc_notas_archivo.hoja is 'Hoja del Excel de donde salió la nota.';


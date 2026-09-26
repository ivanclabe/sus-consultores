-- Las notas pueden venir en varias hojas: cada nota guarda la suya.
alter table public.sc_notas_archivo add column if not exists hoja text;
comment on column public.sc_notas_archivo.hoja is 'Hoja del Excel de donde salió la nota.';

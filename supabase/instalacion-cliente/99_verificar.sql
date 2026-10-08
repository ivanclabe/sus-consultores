-- ============================================================================
-- SusConsultores · Estados Financieros — verificación de la instalación
-- Debe devolver todas las filas con resultado = 'OK'.
-- ============================================================================

with chequeos(orden, chequeo, ok, detalle) as (
  select 1, 'Tablas de la app (13)',
         count(*) = 13, count(*)::text || ' de 13'
    from information_schema.tables
   where table_schema = 'public' and table_name in (
     'sc_empresas','sc_rubros','sc_reglas_mapeo','sc_informes','sc_cuentas','sc_clasificaciones',
     'sc_mapeos_confirmados','sc_validaciones','sc_auditoria','sc_notas_archivo','sc_notas_archivo_lineas',
     'sc_administradores','sc_configuracion')
  union all
  select 2, 'RLS activo en todas las tablas sc_',
         bool_and(c.relrowsecurity), count(*) filter (where not c.relrowsecurity)::text || ' sin RLS'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'sc\_%'
  union all
  select 3, 'Catálogo de rubros sembrado', count(*) >= 19, count(*)::text || ' rubros' from public.sc_rubros
  union all
  select 4, 'Reglas de mapeo PUC sembradas', count(*) >= 30, count(*)::text || ' reglas' from public.sc_reglas_mapeo
  union all
  select 5, 'Columnas de encabezado', count(*) = 7, count(*)::text || ' de 7'
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'sc_empresas' and column_name in ('ciudad','representante_legal','contador','tarjeta_contador','revisor_fiscal','tarjeta_revisor'))
       or (table_name = 'sc_informes' and column_name = 'encabezado'))
  union all
  select 6, 'Fila de configuración de IA', count(*) = 1, coalesce(max(modelo), 'sin fila') from public.sc_configuracion
  union all
  select 7, 'Funciones de configuración', count(*) = 5, count(*)::text || ' de 5'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in
     ('sc_es_administrador','sc_guardar_modelo_ia','sc_guardar_clave_ia','sc_borrar_clave_ia','sc_config_ia_servidor')
  union all
  select 8, 'La llave solo la lee el servidor',
         not has_function_privilege('authenticated', 'public.sc_config_ia_servidor()', 'execute')
         and has_function_privilege('service_role', 'public.sc_config_ia_servidor()', 'execute'),
         'authenticated sin acceso; service_role con acceso'
  union all
  select 9, 'Vault disponible', count(*) = 1, coalesce(max(extversion), 'no instalado')
    from pg_extension where extname = 'supabase_vault'
  union all
  select 10, 'Al menos un administrador (paso 07)', count(*) > 0, count(*)::text || ' administrador(es)'
    from public.sc_administradores
)
select orden, chequeo, case when ok then 'OK' else 'REVISAR' end as resultado, detalle
  from chequeos order by orden;

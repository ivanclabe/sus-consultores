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


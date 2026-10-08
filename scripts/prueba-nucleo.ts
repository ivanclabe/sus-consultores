/**
 * Prueba del núcleo determinístico: extracción → cálculos → validaciones.
 *
 * Genera un libro sintético con la forma exacta del que entrega SusConsultores
 * (exportación de Siigo) para CUALQUIER año, y lo corre dos veces —con Y y con
 * Y+1— para demostrar que ningún año está fijo en el código.
 *
 * Trampas incluidas a propósito:
 *  - varias hojas de balance de años distintos (se debe elegir la más reciente)
 *  - "Procesado en: <año siguiente>" en el título (no es el año del balance)
 *  - encabezados truncados por Siigo: SUBCUENT, SUBAUXIL
 *  - códigos fragmentados en columnas (11 | 20 | 05 = 112005), con grupo 25 +
 *    cuenta 25 (que un análisis fila por fila confunde con "anidado")
 *  - detalle por tercero (NIT) bajo las cuentas, y fila de TOTALES al final
 *  - una cuenta que solo existe el año anterior y otra que solo existe este año
 *  - hoja de notas que empieza en B2, años como fechas, encabezado de años
 *    repetido a mitad de hoja, números de nota repetidos y notas sin número
 *
 *   npx esbuild scripts/prueba-nucleo.ts --bundle --platform=node --format=cjs \
 *     --outfile=/tmp/prueba.cjs && node /tmp/prueba.cjs
 */
import * as XLSX from 'xlsx'
import { leerLibro, parseNumero } from '../src/lib/excel'
import { analizarLibro, clasificarLibro, hojasDe, type Destino } from '../src/lib/clasificarHojas'
import { procesarLibro } from '../src/lib/procesarLibro'
import { extraerNotas } from '../src/lib/parseNotas'
import { buscarLinea, construirEstados } from '../src/lib/calculos'
import { ejecutarValidaciones } from '../src/lib/validaciones'
import { encabezadoInicial, extraerDatosCorporativos, normalizarNit, presentarRazonSocial } from '../src/lib/empresaArchivo'
import type { CuentaClasificada, Rubro } from '../src/lib/types'

let fallos = 0
let total = 0
function chequear(nombre: string, real: unknown, esperado: unknown) {
  total++
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`${ok ? '  ok ' : 'FALLA'}  ${nombre}${ok ? '' : `\n         → ${JSON.stringify(real)}\n         ≠ ${JSON.stringify(esperado)}`}`)
}
const cerca = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) < 0.01

// ---------------------------------------------------------------------------
// Libro sintético
// ---------------------------------------------------------------------------

interface Hoja { frags: string[]; nombre: string; y?: number; y1?: number; terceros?: { nit: string; nombre: string; y?: number; y1?: number }[] }

/** Saldos del año actual (y) y del anterior (y1). Débito +, crédito −. */
const HOJAS: Hoja[] = [
  { frags: ['11', '20', '05'], nombre: 'BANCOLOMBIA CTA AHORRO', y: 1611872.97, y1: 143996.4,
    terceros: [{ nit: '890903938', nombre: 'BANCOLOMBIA S.A.', y: 1611872.97, y1: 143996.4 }] },
  { frags: ['11', '20', '06'], nombre: 'CTA CORRIENTE', y: 15795.29, y1: 27920.48 },
  // Cuenta cerrada: sigue apareciendo este año, con cierre en cero.
  { frags: ['11', '10', '05'], nombre: 'MONEDA NACIONAL', y: 0, y1: 20088025.45 },
  // Solo existe el año anterior (cuenta de resultado sin movimiento este año):
  { frags: ['42', '10', '05'], nombre: 'INTERESES', y1: -500000 },
  { frags: ['13', '05', '05'], nombre: 'NACIONALES', y: 0, y1: 16905678,
    terceros: [
      { nit: '900674842', nombre: 'PEOPLE RESEARCH SAS', y: 0, y1: 9772000 },
      { nit: '900836543', nombre: 'FEEDBACK PROVOKERS SAS', y: 0, y1: 7133678 },
    ] },
  // Solo existe este año, y llega hasta subauxiliar:
  { frags: ['13', '80', '10', '01', '01'], nombre: 'PRESTAMO SOCIO', y: 5914910.6 },
  // Grupo 25 + cuenta 25: la trampa del estilo "anidado".
  { frags: ['25', '25', '05'], nombre: 'VACACIONES', y: -2390156, y1: -7524962 },
  { frags: ['25', '10', '10'], nombre: 'LEY 50 DE 1990', y: -1000000, y1: -800000 },
  { frags: ['31', '05', '05'], nombre: 'CAPITAL SUSCRITO', y: -5000000, y1: -5000000 },
  { frags: ['37', '05', '05'], nombre: 'UTILIDADES ACUMULADAS', y: -110307117.62, y1: -129399093.62 },
  { frags: ['41', '55', '05'], nombre: 'ASESORAMIENTO EMPRESARIAL', y: -360451030.35, y1: -353514283.94 },
  { frags: ['51', '05', '06'], nombre: 'SUELDOS', y: 471605725.11, y1: 459572719.23 },
]

const NOMBRES: Record<string, string> = {
  '1': 'ACTIVO', '11': 'DISPONIBLE', '1110': 'BANCOS', '111005': 'MONEDA NACIONAL', '1120': 'CUENTAS DE AHORROS',
  '13': 'DEUDORES', '1305': 'CLIENTES', '1380': 'DEUDORES VARIOS', '138010': 'PRESTAMOS', '13801001': 'SOCIOS',
  '2': 'PASIVO', '25': 'OBLIGACIONES LABORALES', '2525': 'VACACIONES CONSOLIDADAS', '2510': 'CESANTIAS CONSOLIDADAS',
  '3': 'PATRIMONIO', '31': 'CAPITAL SOCIAL', '3105': 'CAPITAL SUSCRITO Y PAGADO', '37': 'RESULTADOS DE EJERCICIOS ANTERIORES',
  '3705': 'UTILIDADES ACUMULADAS', '4': 'INGRESOS', '41': 'OPERACIONALES', '4155': 'ACTIVIDADES EMPRESARIALES',
  '42': 'NO OPERACIONALES', '4210': 'FINANCIEROS',
  '5': 'GASTOS', '51': 'OPERACIONALES DE ADMINISTRACION', '5105': 'GASTOS DE PERSONAL',
}

const serial = (anio: number) => (Date.UTC(anio, 11, 31) - Date.UTC(1899, 11, 30)) / 86400000
const pad = (s: string) => s.padEnd(8, ' ')

function hojaBalance(
  anio: number,
  campo: 'y' | 'y1',
  aperturas: 'y1' | null,
  filtro: (h: Hoja) => boolean = () => true,
): XLSX.WorkSheet {
  // Nodos: clase (1 dígito), luego cada prefijo de fragmentos.
  const nodos = new Map<string, { frags: string[]; valor: number; apertura: number; hoja?: Hoja }>()
  for (const h of HOJAS.filter(filtro)) {
    const v = h[campo]
    if (v === undefined) continue
    const ap = aperturas ? h[aperturas] ?? 0 : 0
    const cadenas = [[h.frags[0][0]], ...h.frags.map((_, k) => h.frags.slice(0, k + 1))]
    for (const fr of cadenas) {
      const codigo = fr.join('')
      const n = nodos.get(codigo) ?? { frags: fr, valor: 0, apertura: 0 }
      n.valor += v
      n.apertura += ap
      if (fr.length === h.frags.length && fr === cadenas[cadenas.length - 1]) n.hoja = h
      nodos.set(codigo, n)
    }
  }
  const filas: (string | number | XLSX.CellObject)[][] = [
    ['Siigo - EMPRESA DEMO SAS', '', '', '', '', '', '', '', '', '', '', '', '', '', '', `DIC/31/${anio}`],
    ['BALANCE DE PRUEBA  TERCEROS'],
    [`De :  ENE  1/${anio}   A :  DIC 31/${anio}`],
    ['NIT   900888897    -5'],
    [`Procesado en: ${anio + 1}/03/15`],
    [],
    ['GRUPO    ', 'CUENTA   ', 'SUBCUENT ', 'AUXILIAR ', 'SUBAUXIL ', 'NIT           ', 'SUCURSAL ', 'DIG. VERIFICACION ',
      'CENTRO C ', '', 'DESCRIPCION            ', 'ULT. MOV.  ', 'SALDO ANTERIOR      ', 'DEBITOS             ',
      'CREDITOS            ', 'NUEVO SALDO        '],
  ]
  const fecha: XLSX.CellObject = { t: 'n', v: serial(anio), z: 'yyyy/mm/dd' }
  for (const codigo of [...nodos.keys()].sort()) {
    const n = nodos.get(codigo)!
    const niveles = n.frags.length === 1 && n.frags[0].length === 1 ? [n.frags[0]] : n.frags
    const fila: (string | number | XLSX.CellObject)[] = Array(16).fill('')
    niveles.forEach((f, i) => (fila[i] = pad(f)))
    for (let i = niveles.length; i < 5; i++) fila[i] = pad('')
    fila[10] = n.hoja?.nombre ?? NOMBRES[codigo] ?? codigo
    fila[11] = fecha
    fila[12] = aperturas && /^[12]/.test(codigo) ? Math.round(n.apertura * 100) / 100 : 0
    fila[15] = Math.round(n.valor * 100) / 100
    filas.push(fila)
    for (const t of n.hoja?.terceros ?? []) {
      const v = t[campo]
      if (v === undefined) continue
      const ft: (string | number | XLSX.CellObject)[] = Array(16).fill('')
      ft[5] = t.nit; ft[6] = '000'; ft[7] = '4'; ft[10] = t.nombre; ft[11] = fecha
      ft[12] = aperturas ? t[aperturas] ?? 0 : 0
      ft[15] = v
      filas.push(ft)
    }
  }
  const tot: (string | number)[] = Array(16).fill('')
  tot[10] = 'T O T A L E S   ===>'
  // Como en Siigo: la suma de las clases (0 cuando la hoja trae todo el balance).
  tot[15] = Math.round([...nodos.entries()].filter(([c]) => c.length === 1).reduce((s, [, n]) => s + n.valor, 0) * 100) / 100
  filas.push(tot)
  return XLSX.utils.aoa_to_sheet(filas)
}

function hojaNotas(anio: number): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const put = (a: string, c: XLSX.CellObject) => (ws[a] = c)
  const s = (a: string, v: string) => put(a, { t: 's', v })
  const n = (a: string, v: number) => put(a, { t: 'n', v })
  const d = (a: string, y: number) => put(a, { t: 'n', v: serial(y), z: 'm/d/yy' })

  s('B3', 'NOTAS A LOS ESTADOS FINANCIEROS'); s('B4', 'EMPRESA DEMO SAS')
  d('D8', anio); d('E8', anio - 1); d('F8', anio - 3); s('H8', 'VARIACIÓN')
  s('B10', 'NOTA 4 - EFECTIVO Y EQUIVALENTE A EFECTIVO')
  s('C12', 'Bancolombia'); n('D12', 1611872.97); n('E12', 143996.4); n('F12', 999)
  s('C13', 'Davivienda'); n('D13', 15795.29); n('E13', 27920.48)
  s('C14', 'Moneda Nacional'); n('E14', 20088025.45)
  s('C15', 'Total Efectivo y Equivalente a Efectivo'); n('D15', 1627668.26); n('E15', 20259942.33)
  d('D17', anio); d('E17', anio - 1)
  s('B18', 'NOTA  4 - INVENTARIOS')
  s('B20', 'Mercancías no fabricadas'); n('F20', 0)
  s('B22', 'RESULTADOS DEL PERIODO')
  s('B24', 'NOTA 12 - INGRESOS DE ACTIVIDADES ORDINARIAS')
  s('B25', 'Servicios')
  s('C26', 'Asesoramiento Empresarial'); n('D26', 360451030.35); n('E26', 353514283.94)
  s('C27', 'Total Ingresos'); n('D27', 360451030.35); n('E27', 353514283.94)
  s('B29', 'NOTA   – PROPIEDAD PLANTA Y EQUIPO')
  s('C30', 'Subtotal Propiedad Planta y Equipo'); n('D30', 0); n('E30', 0)
  n('D31', 12345)
  ws['!ref'] = 'B2:H31'
  return ws
}

/** Formato de notas de otra empresa: número suelto + título, años como texto. */
function hojaNotasFormatoB(anio: number): XLSX.WorkSheet {
  const enc = (fila: number, mesDia = '31/12') => [
    [`B${fila}`, 'NOTAS'], [`C${fila}`, 'CONCEPTO'],
    [`D${fila}`, `SALDO NIIF ${mesDia}/${anio}`], [`E${fila}`, `SALDO NIIF 31/12/${anio - 1}`], [`F${fila}`, `SALDO NIIF 31/12/${anio - 2}`],
  ] as [string, string][]
  const celdas: [string, string | number][] = [
    ['B4', 'OTRA EMPRESA SAS'], ['B6', 'NOTAS A LOS ESTADOS FINANCIEROS'],
    ...enc(10),
    ['B11', 4], ['C11', 'EFECTIVO Y EQUIVALENTES DE EFECTIVO'],
    ['C12', 'Cuenta de Ahorro'],
    ['C13', 'Bancolombia'], ['D13', 192031215.5], ['E13', 98220355.58], ['F13', 58776198.09],
    ['C14', 'Caja'], ['D14', 500000], ['E14', 500000], ['F14', 500000],
    ['C15', 'Total Efectivo y Equivalente a Efectivo'], ['D15', 192531215.5], ['E15', 98720355.58], ['F15', 59276198.09],
    ...enc(17, '30/06'),
    ['B18', '7'], ['C18', 'INVENTARIOS'],
    ['C19', 'Total Inventario'], ['D19', 0], ['E19', 0], ['F19', 51201446.81],
    ['B21', 'TOTAL  ACTIVOS'], ['D21', 192531215.5], ['E21', 98720355.58],
  ]
  const ws: XLSX.WorkSheet = {}
  for (const [a, v] of celdas) ws[a] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v }
  ws['!ref'] = 'B2:F21'
  return ws
}

interface Opciones {
  sinAnterior?: boolean
  duplicarActual?: boolean
  sinNotas?: boolean
  errorDeCelda?: boolean
  /** Una hoja con forma de estado financiero pero sin ningún período. */
  hojaAmbigua?: boolean
  /** El año actual repartido en dos hojas: activos / pasivos y patrimonio. */
  dividirActual?: boolean
  /** Las notas repartidas en dos hojas. */
  notasEnDosHojas?: boolean
}

function libro(anio: number, o: Opciones = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const viejo = hojaBalance(anio - 4, 'y1', null)
  XLSX.utils.book_append_sheet(wb, viejo, `BALANCE ${String(anio - 4).slice(2)}`)
  // Estado ya armado y comparativo, como el ESF del cliente: no pertenece a un solo año.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['EMPRESA DEMO SAS'], ['Estado de Situación Financiera'], [],
    ['DESCRIPCION', 'Nota', `31 de diciembre de ${anio}`, `31 de diciembre de ${anio - 1}`], ['ACTIVO', '', 1, 2],
  ]), 'ESF')
  if (o.hojaAmbigua) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Estado de Resultados'], [], ['Concepto', 'Valor'], ['Ingresos', 1000], ['Gastos', 400],
    ]), 'Sheet3')
  }
  if (!o.sinAnterior) XLSX.utils.book_append_sheet(wb, hojaBalance(anio - 1, 'y1', null), `BALANCE ${String(anio - 1).slice(2)}`)
  if (o.dividirActual) {
    const esActivo = (h: Hoja) => h.frags[0].startsWith('1')
    XLSX.utils.book_append_sheet(wb, hojaBalance(anio, 'y', 'y1', esActivo), 'ACTIVOS')
    XLSX.utils.book_append_sheet(wb, hojaBalance(anio, 'y', 'y1', (h) => !esActivo(h)), 'PASIVOS Y PATRIMONIO')
  } else {
    const actual = hojaBalance(anio, 'y', 'y1')
    if (o.errorDeCelda) actual['P9'] = { t: 'e', v: 0x17, w: '#REF!' }
    XLSX.utils.book_append_sheet(wb, actual, `BALANCE${String(anio).slice(2)}`)
  }
  if (o.duplicarActual) XLSX.utils.book_append_sheet(wb, hojaBalance(anio, 'y', 'y1'), 'BALANCE COPIA')
  if (!o.sinNotas) XLSX.utils.book_append_sheet(wb, hojaNotas(anio), 'NOTAS')
  if (o.notasEnDosHojas) XLSX.utils.book_append_sheet(wb, hojaNotasFormatoB(anio), 'NOTAS ADICIONALES')
  // Ida y vuelta por el formato real de archivo, como hace el navegador.
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return leerLibro(buf)
}

// ---------------------------------------------------------------------------
// Catálogo de prueba (misma lógica de la semilla, sin depender de la BD)
// ---------------------------------------------------------------------------

const R = (codigo: string, estado: 'ESF' | 'ER', seccion: string, nombre: string, nota: number, orden: number,
           nat: 'deudora' | 'acreedora'): Rubro =>
  ({ id: codigo, codigo, estado, seccion, nombre, nota_numero: nota, orden, naturaleza: nat, activo: true, origen: 'test' })
const RUBROS: Rubro[] = [
  R('EFECTIVO', 'ESF', 'activo_corriente', 'Efectivo y equivalentes al efectivo', 1, 10, 'deudora'),
  R('DEUDORES', 'ESF', 'activo_corriente', 'Deudores comerciales', 3, 30, 'deudora'),
  R('OTROS_PASIVOS', 'ESF', 'pasivo_corriente', 'Beneficios a empleados', 11, 110, 'acreedora'),
  R('PATRIMONIO', 'ESF', 'patrimonio', 'Patrimonio', 12, 120, 'acreedora'),
  R('INGRESOS_OPER', 'ER', 'ingresos', 'Ingresos operacionales', 13, 130, 'acreedora'),
  R('OTROS_INGRESOS', 'ER', 'otros_ingresos', 'Otros ingresos', 17, 170, 'acreedora'),
  R('GASTOS_ADMIN', 'ER', 'gastos', 'Gastos de administración', 15, 150, 'deudora'),
]
const REGLAS: [string, string][] = [['11', 'EFECTIVO'], ['13', 'DEUDORES'], ['25', 'OTROS_PASIVOS'],
  ['31', 'PATRIMONIO'], ['37', 'PATRIMONIO'], ['41', 'INGRESOS_OPER'], ['42', 'OTROS_INGRESOS'], ['51', 'GASTOS_ADMIN']]
const rubroDe = (c: string) => REGLAS.filter(([p]) => c.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

function flujoCompleto(Y: number) {
  console.log(`\n══ Libro ${Y - 1}/${Y} ══`)
  const wb = libro(Y)
  const perfiles = analizarLibro(wb)
  const c = clasificarLibro(perfiles)
  const nombres = (d: Destino) => hojasDe(c, d).map((h) => h.nombre)
  const yy = (a: number) => String(a).slice(2)

  chequear('analiza todas las hojas del libro', c.hojas.length, perfiles.length)
  chequear('período actual leído del contenido', c.anioActual, Y)
  chequear('período anterior: el inmediatamente previo', c.anioAnterior, Y - 1)
  chequear('tab del año actual', nombres('actual'), [`BALANCE${yy(Y)}`])
  chequear('tab del año anterior', nombres('anterior'), [`BALANCE ${yy(Y - 1)}`])
  chequear('tab de notas', nombres('notas'), ['NOTAS'])
  chequear('un balance de otro año no entra en ningún tab', nombres('ignorada').includes(`BALANCE ${yy(Y - 4)}`), true)
  chequear('…y dice por qué', c.hojas.find((h) => h.nombre === `BALANCE ${yy(Y - 4)}`)?.motivo.includes(String(Y - 4)), true)
  chequear('ignora "Procesado en" al leer el año', perfiles.find((p) => p.nombre === `BALANCE${yy(Y)}`)?.anio, Y)
  chequear('un estado armado comparativo no se asigna a un solo período',
    [perfiles.find((p) => p.nombre === 'ESF')?.tipo, c.hojas.find((h) => h.nombre === 'ESF')?.destino], ['estado', 'ignorada'])
  chequear('ninguna validación de clasificación falla', c.validaciones.filter((x) => !x.ok).map((x) => x.codigo), [])

  const r = procesarLibro(wb, c)
  const cuenta = (codigo: string) => r.cuentas.find((c) => c.codigo === codigo && c.nivel !== 'tercero')

  chequear('cada período se extrae solo de sus hojas',
    [r.actual!.hojas.map((h) => h.hoja), r.anterior!.hojas.map((h) => h.hoja)], [[`BALANCE${yy(Y)}`], [`BALANCE ${yy(Y - 1)}`]])
  chequear('reconoce SUBCUENT y SUBAUXIL como niveles', Object.keys(r.actual!.union.mapeo.colNiveles), ['grupo', 'cuenta', 'subcuenta', 'auxiliar', 'subauxiliar'])
  chequear('decide el estilo de código para toda la hoja', r.actual!.union.estiloCodigo, 'fragmentado')
  chequear('grupo 25 + cuenta 25 da el código 2525 (no 25)', cuenta('2525')?.nombre, 'VACACIONES CONSOLIDADAS')
  chequear('conserva todos los niveles, de grupo a subauxiliar',
    ['grupo', 'cuenta', 'subcuenta', 'auxiliar', 'subauxiliar'].map((n) => r.cuentas.some((c) => c.nivel === n)), [true, true, true, true, true])
  chequear('conserva los padres, no solo las hojas', [cuenta('1')?.esHoja, cuenta('11')?.esHoja, cuenta('112005')?.esHoja], [false, false, true])
  chequear('código del subauxiliar', cuenta('1380100101')?.nivel, 'subauxiliar')
  chequear('conserva el detalle por tercero', r.cuentas.filter((c) => c.nivel === 'tercero').map((c) => c.nit),
    ['890903938', '900674842', '900836543'])
  chequear('los terceros no alimentan las notas', r.cuentas.filter((c) => c.nivel === 'tercero').every((c) => !c.esHoja), true)
  chequear('saldo del año actual, numérico', cuenta('112005')?.actual, 1611872.97)
  chequear('saldo del año anterior, leído de la otra hoja', cuenta('112005')?.anterior, 143996.4)
  chequear('cuenta cerrada: cero este año, saldo el anterior', [cuenta('111005')?.actual, cuenta('111005')?.anterior], [0, 20088025.45])
  chequear('cuenta que solo existe el año anterior: actual faltante, no cero', [cuenta('421005')?.actual, cuenta('421005')?.anterior], [null, -500000])
  chequear('cuenta que solo existe este año: anterior faltante', [cuenta('1380100101')?.actual, cuenta('1380100101')?.anterior], [5914910.6, null])
  chequear('negativos intactos', cuenta('252505')?.actual, -2390156)
  chequear('ceros intactos (no faltantes)', cuenta('130505')?.actual, 0)
  chequear('ULT. MOV. tal como lo muestra el Excel', cuenta('112005')?.ultimoMovimiento, `${Y}/12/31`)
  chequear('SALDO ANTERIOR de la hoja del año actual', cuenta('112005')?.saldoInicial, 143996.4)
  chequear('detecta las columnas ULT. MOV., SALDO ANTERIOR y NUEVO SALDO',
    [r.actual!.union.mapeo.colUltMov, r.actual!.union.mapeo.colSaldoInicial, r.actual!.union.mapeo.colSaldo]
      .map((i) => r.actual!.union.encabezados[i!]), ['ULT. MOV.', 'SALDO ANTERIOR', 'NUEVO SALDO'])
  chequear('trazabilidad a la celda de origen', cuenta('112005')?.celdaActual?.startsWith(`BALANCE${String(Y).slice(2)}!P`), true)

  const v = (c: string) => r.validaciones.find((x) => x.codigo === c)
  for (const k of ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'E-02', 'E-03', 'E-04', 'E-05', 'E-06', 'E-07', 'E-08', 'E-09', 'E-10', 'E-11']) {
    chequear(`${k} ${v(k)?.titulo}`, v(k)?.ok, true)
  }
  chequear('E-12 avisa números de nota repetidos y notas sin número', v('E-12')?.ok, false)
  chequear('la fila de TOTALES queda registrada, no descartada en silencio',
    r.descartes.filter((d) => d.motivo.startsWith('Fila de totales')).length, 2)

  const notas = r.notas!
  chequear('extrae todas las notas', notas.notas.map((n) => n.numero), ['4', '4', '12', null])
  chequear('columnas de año leídas de fechas', [notas.porHoja[0].columnasAnios[Y], notas.porHoja[0].columnasAnios[Y - 1]], ['D', 'E'])
  const n1 = notas.notas[0]
  chequear('nota con detalle y total', n1.lineas.map((l) => [l.etiqueta, l.tipo, l.actual, l.anterior]), [
    ['Bancolombia', 'detalle', 1611872.97, 143996.4],
    ['Davivienda', 'detalle', 15795.29, 27920.48],
    ['Moneda Nacional', 'detalle', null, 20088025.45],
    ['Total Efectivo y Equivalente a Efectivo', 'total', 1627668.26, 20259942.33],
  ])
  chequear('el encabezado de años repetido no se lee como valores', notas.notas[1].lineas.some((l) => l.actual === serial(Y)), false)
  chequear('título de sección asignado a la nota siguiente', notas.notas[2].seccion, 'RESULTADOS DEL PERIODO')
  chequear('encabezados internos de la nota', notas.notas[2].lineas[0].tipo, 'encabezado')
  chequear('subtotales', notas.notas[3].lineas[0].tipo, 'subtotal')
  chequear('línea con valor y sin descripción se conserva', notas.notas[3].lineas[1].actual, 12345)
  chequear('filas reales de Excel (la hoja empieza en B2)', n1.lineas[0].fila, 12)

  // Pasos 2 y 3: solo cuentas hoja, clasificadas por prefijo.
  const clasificadas: CuentaClasificada[] = r.cuentas.filter((c) => c.esHoja).map((c, i) => ({
    id: `c${i}`, informe_id: 'x', fila_origen: c.filaActual, codigo: c.codigo, nombre: c.nombre,
    nivel: c.nivel, es_hoja: true, saldo_actual: c.actual, saldo_anterior: c.anterior,
    clasificacion: { id: `k${i}`, informe_id: 'x', cuenta_id: `c${i}`, rubro_codigo: rubroDe(c.codigo),
      confianza: 1, origen: 'regla', estado: 'confirmada', razon: null },
  }))
  const { notas: ns, esf, er } = construirEstados(clasificadas, RUBROS)
  const val = ejecutarValidaciones(clasificadas, RUBROS, ns, esf, er)
  chequear('Paso 3: TOTAL ACTIVO del año actual', cerca(buscarLinea(esf, 'TOTAL ACTIVO')?.actual, 7542578.86), true)
  chequear('Paso 3: TOTAL ACTIVO del año anterior', cerca(buscarLinea(esf, 'TOTAL ACTIVO')?.anterior, 37165620.33), true)
  chequear('Paso 3: ninguna validación bloqueante falla', val.filter((x) => x.bloqueante && !x.ok).map((x) => x.codigo), [])
  chequear('Paso 3: ecuación patrimonial (V-06)', val.find((x) => x.codigo === 'V-06')?.ok, true)
  chequear('Paso 3: el balance cuadra a la vista (activo = pasivo + patrimonio)',
    [cerca(buscarLinea(esf, 'TOTAL PASIVO Y PATRIMONIO')?.actual, buscarLinea(esf, 'TOTAL ACTIVO')!.actual),
     cerca(buscarLinea(esf, 'TOTAL PASIVO Y PATRIMONIO')?.anterior, buscarLinea(esf, 'TOTAL ACTIVO')!.anterior!)], [true, true])
  chequear('Paso 3: el resultado del periodo va dentro del patrimonio', esf.some((l) => l.etiqueta === 'Resultado del periodo'), true)
}

function notasFormatoB(Y: number) {
  console.log(`\n══ Notas en el formato de otra empresa (${Y}) ══`)
  const wb0 = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb0, hojaNotasFormatoB(Y), 'NOTAS')
  const wb = leerLibro(XLSX.write(wb0, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
  const perfil = analizarLibro(wb)[0]
  chequear('reconoce la hoja como notas sin la palabra "NOTA" en los encabezados', [perfil.tipo, perfil.encabezadosNota], ['notas', 2])
  const r = extraerNotas(wb, 'NOTAS', Y, Y - 1)
  chequear('número y título en celdas separadas', r.notas.map((n) => [n.numero, n.titulo]),
    [['4', 'EFECTIVO Y EQUIVALENTES DE EFECTIVO'], ['7', 'INVENTARIOS']])
  chequear('años leídos de texto ("SALDO NIIF 31/12/…")', [r.columnasAnios[Y], r.columnasAnios[Y - 1]], ['D', 'E'])
  chequear('valores de los dos años', r.notas[0].lineas.find((l) => l.etiqueta === 'Bancolombia')?.actual, 192031215.5)
  chequear('corte a mitad de año ("30/06/…") sigue siendo el mismo año',
    r.notas[1].lineas.find((l) => l.tipo === 'total')?.anterior, 0)
  chequear('el año antepasado no se confunde con el anterior', r.notas[0].lineas.find((l) => l.etiqueta === 'Caja')?.anterior, 500000)
}

function casosDeClasificacion(Y: number) {
  console.log(`\n══ Clasificación: ambigüedades y ajustes (${Y}) ══`)
  const armar = (o: Opciones) => {
    const wb = libro(Y, o)
    return { wb, p: analizarLibro(wb) }
  }
  const falla = (c: { validaciones: { codigo: string; ok: boolean }[] }, k: string) =>
    c.validaciones.find((x) => x.codigo === k)?.ok === false

  // Hoja ambigua: no se asigna en silencio.
  const a = armar({ hojaAmbigua: true })
  const ca = clasificarLibro(a.p)
  const sheet3 = ca.hojas.find((h) => h.nombre === 'Sheet3')!
  chequear('hoja sin período: queda en revisión, no en un tab', sheet3.destino, 'revision')
  chequear('…con un mensaje que la nombra', sheet3.motivo.includes('No fue posible determinar a qué período pertenece la hoja «Sheet3»'), true)
  chequear('…y bloquea (C-06)', falla(ca, 'C-06'), true)
  const caResuelta = clasificarLibro(a.p, { destinos: { Sheet3: 'ignorada' } })
  chequear('al resolverla a mano, la clasificación queda completa', caResuelta.validaciones.every((x) => x.ok), true)

  // Dos balances del mismo año: no elige al azar.
  const b = armar({ duplicarActual: true })
  const cb = clasificarLibro(b.p)
  chequear('dos balances del mismo año: ambos a revisión',
    cb.hojas.filter((h) => h.destino === 'revision').map((h) => h.nombre), [`BALANCE${String(Y).slice(2)}`, 'BALANCE COPIA'])
  const cbUna = clasificarLibro(b.p, { destinos: { 'BALANCE COPIA': 'ignorada', [`BALANCE${String(Y).slice(2)}`]: 'actual' } })
  chequear('…dejando uno, la clasificación queda completa', cbUna.validaciones.every((x) => x.ok), true)
  const cbAmbas = clasificarLibro(b.p, { destinos: { 'BALANCE COPIA': 'actual', [`BALANCE${String(Y).slice(2)}`]: 'actual' } })
  const rbAmbas = procesarLibro(b.wb, cbAmbas)
  const e14 = rbAmbas.validaciones.find((x) => x.codigo === 'E-14')
  chequear('…usando las dos copias idénticas: no hay conflicto, se toman una vez',
    [e14?.ok, rbAmbas.actual!.duplicadas > 0], [true, true])

  // Un período repartido en dos hojas se une por cuenta.
  const d = armar({ dividirActual: true })
  const cd = clasificarLibro(d.p)
  chequear('período en dos hojas: el usuario confirma que se complementan',
    cd.hojas.filter((h) => h.destino === 'revision').map((h) => h.nombre), ['ACTIVOS', 'PASIVOS Y PATRIMONIO'])
  const cdOk = clasificarLibro(d.p, { destinos: { ACTIVOS: 'actual', 'PASIVOS Y PATRIMONIO': 'actual' } })
  const rd = procesarLibro(d.wb, cdOk)
  chequear('…se extraen las dos y se unen', rd.actual!.hojas.map((h) => h.hoja), ['ACTIVOS', 'PASIVOS Y PATRIMONIO'])
  chequear('…sin conflictos ni validaciones bloqueantes', rd.validaciones.filter((x) => x.bloqueante && !x.ok).map((x) => x.codigo), [])
  chequear('…cada hoja cuadra con su propia fila de totales', rd.validaciones.find((x) => x.codigo === 'E-08')?.ok, true)
  const unida = procesarLibro(libro(Y), clasificarLibro(analizarLibro(libro(Y))))
  const saldos = (x: typeof rd) => x.cuentas.filter((k) => k.esHoja).map((k) => [k.codigo, k.actual, k.anterior]).sort()
  chequear('…y dan exactamente las mismas cuentas que el balance en una sola hoja', JSON.stringify(saldos(rd)), JSON.stringify(saldos(unida)))

  // Varias hojas de notas van al mismo tab y se procesan en orden.
  const n = armar({ notasEnDosHojas: true })
  const cn = clasificarLibro(n.p)
  chequear('varias hojas de notas: todas en el tab de notas', hojasDe(cn, 'notas').map((h) => h.nombre), ['NOTAS', 'NOTAS ADICIONALES'])
  const rn = procesarLibro(n.wb, cn)
  chequear('…se extraen todas, conservando de qué hoja viene cada nota',
    rn.notas!.notas.map((x) => x.hoja), ['NOTAS', 'NOTAS', 'NOTAS', 'NOTAS', 'NOTAS ADICIONALES', 'NOTAS ADICIONALES'])
  chequear('…con sus columnas de año por hoja', rn.notas!.porHoja.map((h) => h.columnasAnios[Y]), ['D', 'D'])

  // Asignación incompatible: un balance de otro año puesto en el año actual.
  const base = armar({})
  const viejo = `BALANCE ${String(Y - 4).slice(2)}`
  const ci = clasificarLibro(base.p, { destinos: { [viejo]: 'actual' } })
  chequear('hoja asignada a un período que no le corresponde: bloquea (C-07)', falla(ci, 'C-07'), true)
  chequear('…explicando el choque', ci.validaciones.find((x) => x.codigo === 'C-07')?.detalle.includes(`es de ${Y - 4}`), true)

  // Elegir otro período anterior mueve las hojas solas.
  const cp = clasificarLibro(base.p, { anioActual: Y, anioAnterior: Y - 4 })
  chequear('cambiar el período anterior reasigna los tabs', hojasDe(cp, 'anterior').map((h) => h.nombre), [viejo])
  chequear('…y avisa que no son consecutivos', cp.avisos.some((x) => x.includes('no son años consecutivos')), true)
}

function casosDeError(Y: number) {
  console.log(`\n══ Errores (${Y}) ══`)
  const probar = (o: Opciones) => {
    const wb = libro(Y, o)
    const c = clasificarLibro(analizarLibro(wb))
    return { c, r: procesarLibro(wb, c) }
  }
  const detalle = (c: { validaciones: { codigo: string; detalle: string; ok: boolean }[] }, k: string) =>
    c.validaciones.find((x) => x.codigo === k)

  const a = probar({ sinAnterior: true })
  chequear('sin balance del año anterior: C-02 bloquea con el año que falta',
    [detalle(a.c, 'C-02')?.ok, detalle(a.c, 'C-02')?.detalle.includes(`No se encontró el balance de comprobación de ${Y - 1}`)], [false, true])

  const c = probar({ sinNotas: true })
  chequear('sin hoja de notas: C-05 no bloquea', detalle(c.c, 'C-05')?.ok, true)
  chequear('…la clasificación queda completa', c.c.validaciones.some((x) => x.bloqueante && !x.ok), false)
  chequear('…y el flujo avanza con las cuentas de los dos años',
    [c.r.validaciones.some((x) => x.bloqueante && !x.ok), c.r.cuentas.length > 0, c.r.notas], [false, true, null])

  const d = probar({ errorDeCelda: true })
  chequear('celda con #REF! en el balance: bloquea con la celda',
    [d.r.validaciones.find((x) => x.codigo === 'E-03')?.ok, d.r.validaciones.find((x) => x.codigo === 'E-03')?.detalle.includes('!P9')],
    [false, true])
}

console.log('\n══ Números ══')
for (const [entrada, esperado] of [
  ['$ 1.500.000', 1500000], ['1.500.000', 1500000], ['1,500,000', 1500000], ['-500.000', -500000],
  ['1.234.567,89', 1234567.89], ['1,234,567.89', 1234567.89], ['(1,234.56)', -1234.56], ['500.000-', -500000],
  ['$ -500', -500], ['0.500', 0.5], ['12,75', 12.75], ['0', 0], ['', null], ['n/a', null],
] as [string, number | null][]) {
  chequear(`parseNumero(${JSON.stringify(entrada)})`, parseNumero(entrada), esperado)
}

function datosCorporativos(Y: number) {
  console.log(`\n══ Datos corporativos (${Y}) ══`)
  for (const [entrada, esperado] of [
    ['NIT   900507954    -3', '900.507.954-3'], ['NIT. 900,888.897-5', '900.888.897-5'],
    ['NIT 901.466.842-3', '901.466.842-3'], ['NIT : 900888897    -5', '900.888.897-5'], ['NIT', null],
  ] as [string, string | null][]) {
    chequear(`normalizarNit(${JSON.stringify(entrada)})`, normalizarNit(entrada), esperado)
  }
  chequear('sufijo societario presentable', presentarRazonSocial('EMPRESA DEMO SAS'), 'EMPRESA DEMO S.A.S.')

  const wb = libro(Y)
  const c = clasificarLibro(analizarLibro(wb))
  const n = (d: Destino) => hojasDe(c, d).map((h) => h.nombre)
  const d = extraerDatosCorporativos(wb, { actual: n('actual'), anterior: n('anterior'), resto: n('notas') })
  chequear('razón social desde la cabecera de Siigo del balance actual', [d.razonSocial?.valor, d.razonSocial?.hoja], ['EMPRESA DEMO S.A.S.', `BALANCE${String(Y).slice(2)}`])
  chequear('NIT del balance', d.nit?.valor, '900.888.897-5')
  chequear('fecha de corte de cada período', [d.corteActual?.valor, d.corteAnterior?.valor], [`31 de diciembre de ${Y}`, `31 de diciembre de ${Y - 1}`])
  const e = encabezadoInicial(d, c.anioActual, c.anioAnterior, { ciudad: 'Medellín', razonSocial: 'OTRA' })
  chequear('el archivo manda sobre lo guardado; lo que no trae se completa con lo guardado', [e.razonSocial, e.ciudad], ['EMPRESA DEMO S.A.S.', 'Medellín'])

  // Una hoja copiada de otro cliente se reporta.
  const otro = libro(Y)
  XLSX.utils.book_append_sheet(otro, XLSX.utils.aoa_to_sheet([['OTRO CLIENTE LTDA'], ['NIT 800.111.222-1'], ['Notas']]), 'NOTAS VIEJAS')
  const d2 = extraerDatosCorporativos(otro, { actual: n('actual'), anterior: n('anterior'), resto: [] })
  chequear('hoja de otra empresa: se reporta', d2.otrasEmpresas.map((x) => x.hoja), ['NOTAS VIEJAS'])
}

const Y = 2025
datosCorporativos(Y)
flujoCompleto(Y)
flujoCompleto(Y + 1)
notasFormatoB(Y)
notasFormatoB(Y + 1)
casosDeClasificacion(Y)
casosDeClasificacion(Y + 1)
casosDeError(Y + 1)

console.log(fallos === 0 ? `\nTodo correcto: ${total} comprobaciones.\n` : `\n${fallos} de ${total} comprobaciones fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)

/**
 * Plantilla institucional en Excel. ExcelJS se carga solo al exportar.
 *
 * Hojas: Portada · Situación financiera · Resultados · Notas · Control.
 * Cada estado lleva el encabezado de la empresa leído del archivo de origen,
 * columnas de variación, firmas y la página configurada para imprimir en carta.
 */
import type { Workbook, Worksheet, Style, Borders } from 'exceljs'
import {
  fechaHoy,
  firmantes,
  nombreArchivo,
  textoCorte,
  textoPeriodoResultados,
  type DocumentoFinanciero,
  type FilaPresentacion,
} from './documento'
import type { ResultadoValidacion } from './types'

const C = {
  marino: 'FF1F3864',
  acento: 'FF2E75B6',
  claro: 'FFDCE6F1',
  gris: 'FFF2F4F7',
  borde: 'FFBFC9D9',
  texto: 'FF1B2028',
  suave: 'FF667085',
  blanco: 'FFFFFFFF',
}
const FUENTE = 'Calibri'
const NUM = '#,##0;(#,##0);"–"'
const PCT = '0.0%;(0.0%);"–"'
/** Más de 999 % no es una variación que se lea: "n.s." (no significativa), igual que en el PDF. */
const pctValor = (p: number | null): number | string | null => (p !== null && Math.abs(p) >= 10 ? 'n.s.' : p)
const COLS = 6 // Concepto · Nota · Actual · Anterior · Variación · %

const relleno = (argb: string): Style['fill'] => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const linea = (style: 'thin' | 'medium' | 'double' | 'hair', argb = C.marino) => ({ style, color: { argb } })

function anchoColumnas(ws: Worksheet, anchos: number[]) {
  anchos.forEach((w, i) => (ws.getColumn(i + 1).width = w))
}

function configurarPagina(ws: Worksheet, d: DocumentoFinanciero, filaTitulos?: number) {
  ws.pageSetup = {
    paperSize: 1 as never, // carta
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    ...(filaTitulos ? { printTitlesRow: `${filaTitulos}:${filaTitulos}` } : {}),
  }
  const empresa = (d.encabezado.razonSocial || '').replace(/&/g, '&&')
  ws.headerFooter = {
    oddFooter: `&L&8&K667085${empresa}${d.encabezado.nit ? ` · NIT ${d.encabezado.nit}` : ''}&R&8&K667085Página &P de &N`,
  }
  ws.views = [{ showGridLines: false, ...(filaTitulos ? { state: 'frozen', ySplit: filaTitulos } : {}) }]
}

/** Bloque de encabezado: empresa, NIT, título, corte y moneda. Devuelve la siguiente fila libre. */
function encabezado(ws: Worksheet, d: DocumentoFinanciero, titulo: string, subtitulo: string, columnas = COLS): number {
  const lineas: [string, Partial<Style['font']>, number][] = [
    [d.encabezado.razonSocial || 'Razón social', { size: 14, bold: true, color: { argb: C.marino } }, 22],
    [d.encabezado.nit ? `NIT ${d.encabezado.nit}` : '', { size: 10, color: { argb: C.suave } }, 16],
    [titulo.toUpperCase(), { size: 12, bold: true, color: { argb: C.texto } }, 20],
    [subtitulo, { size: 10, color: { argb: C.texto } }, 16],
    [d.encabezado.moneda, { size: 9, italic: true, color: { argb: C.suave } }, 15],
  ]
  lineas.forEach(([t, f, h], i) => {
    const r = i + 1
    ws.mergeCells(r, 1, r, columnas)
    const c = ws.getCell(r, 1)
    c.value = t
    c.font = { name: FUENTE, ...f }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(r).height = h
  })
  // Filete bajo el encabezado.
  for (let col = 1; col <= columnas; col++) ws.getCell(5, col).border = { bottom: linea('medium') }
  return 7
}

function cabeceraTabla(ws: Worksheet, r: number, d: DocumentoFinanciero, primera = 'Concepto') {
  const titulos = [primera, 'Nota', String(d.periodoActual), d.periodoAnterior ? String(d.periodoAnterior) : '', 'Variación', '%']
  titulos.forEach((t, i) => {
    const c = ws.getCell(r, i + 1)
    c.value = t
    c.font = { name: FUENTE, bold: true, size: 10, color: { argb: C.blanco } }
    c.fill = relleno(C.marino)
    c.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', indent: i === 0 ? 1 : 0 }
  })
  ws.getRow(r).height = 22
}

function escribirFila(ws: Worksheet, r: number, f: FilaPresentacion) {
  const row = ws.getRow(r)
  if (f.tipo === 'espacio') {
    row.height = 8
    return
  }
  const valores = [f.etiqueta, f.nota ?? '', f.actual, f.anterior, f.variacion, pctValor(f.porcentaje)]
  valores.forEach((v, i) => {
    const c = row.getCell(i + 1)
    c.value = v === null ? null : v
    c.font = { name: FUENTE, size: 10, color: { argb: C.texto } }
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : i === 1 ? 'center' : 'right' }
    if (i >= 2 && i <= 4) c.numFmt = NUM
    if (i === 5) c.numFmt = PCT
  })
  const todas = (fn: (c: ReturnType<typeof row.getCell>, i: number) => void) =>
    Array.from({ length: COLS }, (_, i) => fn(row.getCell(i + 1), i))
  const a = row.getCell(1)
  switch (f.tipo) {
    case 'seccion':
      todas((c) => {
        c.fill = relleno(C.claro)
        c.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.marino } }
      })
      a.alignment = { indent: 1, vertical: 'middle' }
      row.height = 18
      break
    case 'titulo':
      a.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.texto } }
      a.alignment = { indent: 1, vertical: 'middle' }
      break
    case 'rubro':
      a.alignment = { indent: 3, vertical: 'middle' }
      row.getCell(2).font = { name: FUENTE, size: 9, color: { argb: C.acento } }
      break
    case 'subtotal':
      todas((c, i) => {
        c.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.texto } }
        if (i >= 2) c.border = { top: linea('thin', C.borde) }
      })
      a.alignment = { indent: 1, vertical: 'middle' }
      break
    case 'total':
      todas((c, i) => {
        c.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.marino } }
        c.fill = relleno(C.gris)
        if (i >= 2) c.border = { top: linea('thin'), bottom: linea('thin') } as Partial<Borders>
      })
      a.alignment = { indent: 1, vertical: 'middle' }
      row.height = 18
      break
    case 'gran_total':
      todas((c, i) => {
        c.font = { name: FUENTE, size: 10.5, bold: true, color: { argb: C.blanco } }
        c.fill = relleno(C.marino)
        if (i >= 2) c.border = { bottom: linea('double', C.marino) }
      })
      a.alignment = { indent: 1, vertical: 'middle' }
      row.height = 20
      break
  }
}

function firmas(ws: Worksheet, desde: number, d: DocumentoFinanciero): number {
  const fs = firmantes(d.encabezado)
  // Tres bloques sobre seis columnas: A-B, C-D, E-F.
  const rangos: [number, number][] = fs.length === 3 ? [[1, 1], [3, 4], [5, 6]] : [[1, 1], [4, 6]]
  const r = desde + 3
  fs.forEach((f, i) => {
    const [c1, c2] = rangos[i]
    for (const [k, texto, fuente] of [
      [0, f.nombre || ' ', { bold: true, size: 10 }],
      [1, f.cargo, { size: 9, color: { argb: C.suave } }],
      [2, f.detalle, { size: 9, color: { argb: C.suave } }],
    ] as [number, string, Partial<Style['font']>][]) {
      if (c2 > c1) ws.mergeCells(r + k, c1, r + k, c2)
      const c = ws.getCell(r + k, c1)
      c.value = texto
      c.font = { name: FUENTE, ...fuente }
      c.alignment = { horizontal: 'center' }
    }
    for (let col = c1; col <= c2; col++) ws.getCell(r, col).border = { top: linea('thin', C.texto) }
  })
  return r + 4
}

function notaAlPie(ws: Worksheet, r: number, texto: string) {
  ws.mergeCells(r, 1, r, COLS)
  const c = ws.getCell(r, 1)
  c.value = texto
  c.font = { name: FUENTE, size: 8.5, italic: true, color: { argb: C.suave } }
  c.alignment = { horizontal: 'left', wrapText: true }
}

function hojaEstado(wb: Workbook, d: DocumentoFinanciero, nombre: string, titulo: string, subtitulo: string, filas: FilaPresentacion[]) {
  const ws = wb.addWorksheet(nombre, { properties: { tabColor: { argb: C.marino } } })
  anchoColumnas(ws, [50, 7, 17, 17, 16, 9])
  let r = encabezado(ws, d, titulo, subtitulo)
  cabeceraTabla(ws, r, d)
  configurarPagina(ws, d, r)
  r++
  for (const f of filas) escribirFila(ws, r++, f)
  r++
  notaAlPie(ws, r, 'Las notas adjuntas son parte integral de estos estados financieros.')
  firmas(ws, r, d)
  if (!d.periodoAnterior) [4, 5, 6].forEach((c) => (ws.getColumn(c).hidden = true))
}

function hojaNotas(wb: Workbook, d: DocumentoFinanciero) {
  const ws = wb.addWorksheet('Notas', { properties: { tabColor: { argb: C.acento } } })
  anchoColumnas(ws, [14, 44, 17, 17, 16, 9])
  let r = encabezado(ws, d, 'Notas a los estados financieros', textoCorte(d))
  configurarPagina(ws, d)
  for (const n of d.notas) {
    ws.mergeCells(r, 1, r, COLS)
    const t = ws.getCell(r, 1)
    t.value = `Nota ${n.numero}. ${n.titulo}`
    t.font = { name: FUENTE, size: 11, bold: true, color: { argb: C.marino } }
    t.border = { bottom: linea('medium', C.acento) }
    ws.getRow(r).height = 20
    r++
    ;['Código', 'Cuenta', String(d.periodoActual), d.periodoAnterior ? String(d.periodoAnterior) : '', 'Variación', '%'].forEach((h, i) => {
      const c = ws.getCell(r, i + 1)
      c.value = h
      c.font = { name: FUENTE, size: 9, bold: true, color: { argb: C.suave } }
      c.fill = relleno(C.gris)
      c.alignment = { horizontal: i < 2 ? 'left' : 'right' }
    })
    r++
    for (const l of n.lineas) {
      const vals = [l.codigo, l.nombre, l.actual, l.anterior, l.variacion, pctValor(l.porcentaje)]
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1)
        c.value = v
        c.font = { name: FUENTE, size: 9.5, color: { argb: C.texto } }
        if (i >= 2 && i <= 4) c.numFmt = NUM
        if (i === 5) c.numFmt = PCT
        c.alignment = { horizontal: i < 2 ? 'left' : 'right', vertical: 'middle' }
        c.border = { bottom: linea('hair', C.borde) }
      })
      r++
    }
    const tot = ['', `Total nota ${n.numero}`, n.totalActual, n.totalAnterior, n.variacion, pctValor(n.porcentaje)]
    tot.forEach((v, i) => {
      const c = ws.getCell(r, i + 1)
      c.value = v
      c.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.marino } }
      if (i >= 2 && i <= 4) c.numFmt = NUM
      if (i === 5) c.numFmt = PCT
      c.alignment = { horizontal: i < 2 ? 'left' : 'right' }
      if (i >= 2) c.border = { top: linea('thin'), bottom: linea('double') }
    })
    r += 2
  }
  if (!d.periodoAnterior) [4, 5, 6].forEach((c) => (ws.getColumn(c).hidden = true))
}

function hojaPortada(wb: Workbook, d: DocumentoFinanciero) {
  const ws = wb.addWorksheet('Portada', { properties: { tabColor: { argb: C.acento } } })
  anchoColumnas(ws, [4, 30, 30, 30, 4])
  ws.views = [{ showGridLines: false }]
  ws.pageSetup = { paperSize: 1 as never, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true }
  for (let r = 1; r <= 40; r++) ws.getRow(r).height = 18
  // Franja superior.
  for (let r = 2; r <= 3; r++) for (let c = 1; c <= 5; c++) ws.getCell(r, c).fill = relleno(C.marino)
  const bloque = (r: number, texto: string, font: Partial<Style['font']>, alto = 18) => {
    ws.mergeCells(r, 2, r, 4)
    const c = ws.getCell(r, 2)
    c.value = texto
    c.font = { name: FUENTE, ...font }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    ws.getRow(r).height = alto
  }
  bloque(8, d.encabezado.razonSocial || 'Razón social', { size: 22, bold: true, color: { argb: C.marino } }, 34)
  bloque(9, d.encabezado.nit ? `NIT ${d.encabezado.nit}` : '', { size: 12, color: { argb: C.suave } })
  if (d.encabezado.ciudad) bloque(10, d.encabezado.ciudad, { size: 11, color: { argb: C.suave } })
  for (let c = 2; c <= 4; c++) ws.getCell(12, c).border = { bottom: linea('medium', C.acento) }
  bloque(14, 'ESTADOS FINANCIEROS', { size: 18, bold: true, color: { argb: C.texto } }, 28)
  bloque(15, textoCorte(d), { size: 12, color: { argb: C.texto } })
  bloque(16, d.encabezado.moneda, { size: 10, italic: true, color: { argb: C.suave } })

  bloque(20, 'Contenido', { size: 11, bold: true, color: { argb: C.marino } })
  const indice: [string, string][] = [
    ['Estado de situación financiera', 'Situación financiera'],
    ['Estado de resultados', 'Resultados'],
    [`Notas a los estados financieros (${d.notas.length})`, 'Notas'],
  ]
  indice.forEach(([t, hoja], i) => {
    const r = 21 + i
    ws.mergeCells(r, 2, r, 4)
    const c = ws.getCell(r, 2)
    c.value = { text: `${i + 1}.  ${t}`, hyperlink: `#'${hoja}'!A1` }
    c.font = { name: FUENTE, size: 11, color: { argb: C.acento }, underline: false }
    c.alignment = { horizontal: 'center' }
  })

  const pie = [
    d.aprobadoAt ? `Informe aprobado el ${fechaHoy(new Date(d.aprobadoAt))}` : 'Informe en revisión (no aprobado)',
    `Generado el ${fechaHoy(d.generadoAt)}`,
  ]
  pie.forEach((t, i) => bloque(30 + i, t, { size: 9, color: { argb: C.suave } }, 15))
  for (let r = 37; r <= 38; r++) for (let c = 1; c <= 5; c++) ws.getCell(r, c).fill = relleno(C.claro)
}

function hojaControl(wb: Workbook, d: DocumentoFinanciero, validaciones: ResultadoValidacion[], origen: string) {
  const ws = wb.addWorksheet('Control', { properties: { tabColor: { argb: 'FF98A2B3' } } })
  anchoColumnas(ws, [10, 46, 12, 70])
  ws.views = [{ showGridLines: false }]
  const t = ws.getCell(1, 1)
  t.value = 'Control de calidad del informe (uso interno — no forma parte de los estados financieros)'
  t.font = { name: FUENTE, size: 11, bold: true, color: { argb: C.marino } }
  ws.getCell(2, 1).value = `Archivo de origen: ${origen} · Generado el ${fechaHoy(d.generadoAt)} · ${d.cuadra ? 'El balance cuadra' : 'EL BALANCE NO CUADRA'}`
  ws.getCell(2, 1).font = { name: FUENTE, size: 9, color: { argb: C.suave } }
  ;['Código', 'Validación', 'Resultado', 'Detalle'].forEach((h, i) => {
    const c = ws.getCell(4, i + 1)
    c.value = h
    c.font = { name: FUENTE, bold: true, size: 10, color: { argb: C.blanco } }
    c.fill = relleno(C.marino)
  })
  validaciones.forEach((v, i) => {
    const r = 5 + i
    const estado = v.ok ? 'OK' : v.bloqueante ? 'BLOQUEA' : 'REVISAR'
    const color = v.ok ? 'FF1A7F4B' : v.bloqueante ? 'FFB3261E' : 'FF9A6700'
    ;[v.codigo, v.titulo, estado, v.detalle].forEach((val, k) => {
      const c = ws.getCell(r, k + 1)
      c.value = val
      c.font = { name: FUENTE, size: 9.5, color: { argb: k === 2 ? color : C.texto }, bold: k === 2 }
      c.alignment = { wrapText: true, vertical: 'top' }
      c.border = { bottom: linea('hair', C.borde) }
    })
  })
}

/** Arma el libro y devuelve sus bytes (sin descargar). */
export async function libroExcel(
  d: DocumentoFinanciero,
  validaciones: ResultadoValidacion[],
  archivoOrigen: string,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = d.encabezado.contador || 'SusConsultores'
  wb.company = d.encabezado.razonSocial
  wb.title = `Estados financieros ${d.periodoActual}`
  wb.created = d.generadoAt

  hojaPortada(wb, d)
  hojaEstado(wb, d, 'Situación financiera', 'Estado de situación financiera', textoCorte(d), d.esf)
  hojaEstado(wb, d, 'Resultados', 'Estado de resultados', textoPeriodoResultados(d), d.er)
  hojaNotas(wb, d)
  hojaControl(wb, d, validaciones, archivoOrigen)

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

export async function exportarExcel(
  d: DocumentoFinanciero,
  validaciones: ResultadoValidacion[],
  archivoOrigen: string,
): Promise<void> {
  const buf = await libroExcel(d, validaciones, archivoOrigen)
  descargar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo(d, 'xlsx'))
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

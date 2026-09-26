/**
 * Acceso a celdas del libro con coordenadas REALES de Excel.
 *
 * Se lee celda por celda (no con sheet_to_json) porque sheet_to_json indexa
 * desde el inicio del rango usado: en una hoja que empieza en B2, su "fila 0"
 * es la fila 2 de Excel. Eso rompía la trazabilidad a celda.
 */
import * as XLSX from 'xlsx'

export interface Hoja {
  nombre: string
  ws: XLSX.WorkSheet
  /** Índice 0-based de la última fila y columna con contenido. */
  ultimaFila: number
  ultimaColumna: number
}

export function leerLibro(buf: ArrayBuffer): XLSX.WorkBook {
  // cellNF conserva el formato numérico: es lo que distingue una fecha
  // (31/12/2025 guardada como 46022) de un saldo de 46.022 pesos.
  return XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false })
}

export function abrirHoja(wb: XLSX.WorkBook, nombre: string): Hoja {
  const ws = wb.Sheets[nombre]
  const rango = ws?.['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null
  return {
    nombre,
    ws,
    ultimaFila: rango?.e.r ?? -1,
    ultimaColumna: rango?.e.c ?? -1,
  }
}

export const celda = (h: Hoja, r: number, c: number): XLSX.CellObject | undefined =>
  h.ws[XLSX.utils.encode_cell({ r, c })]

/** "D8" a partir de índices 0-based. */
export const ref = (r: number, c: number): string => XLSX.utils.encode_cell({ r, c })

export const normalizar = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Texto visible de una celda, sin espacios de relleno. */
export function texto(c: XLSX.CellObject | undefined): string {
  if (!c || c.v === undefined || c.v === null) return ''
  if (c.t === 's') return String(c.v).trim()
  return String(c.w ?? c.v).trim()
}

export const esError = (c: XLSX.CellObject | undefined): boolean => c?.t === 'e'

export const vacia = (c: XLSX.CellObject | undefined): boolean =>
  !c || c.v === undefined || c.v === null || (c.t === 's' && String(c.v).trim() === '')

/**
 * Número tolerante a los formatos que llegan como texto:
 * "$ 1.500.000", "1.500.000", "1,500,000", "1.234.567,89", "(1,234.56)",
 * "-500.000", "500.000-". Devuelve null si no hay número.
 */
export function parseNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim()
  if (!s) return null

  const primerDigito = s.search(/\d/)
  if (primerDigito < 0) return null
  const ultimoDigito = s.length - 1 - [...s].reverse().findIndex((ch) => /\d/.test(ch))
  // Signo en cualquiera de sus formas: "-500", "$ -500", "500-", "(500)".
  const negativo =
    /^\s*\(.*\)\s*$/.test(s) ||
    s.slice(0, primerDigito).includes('-') ||
    s.slice(ultimoDigito + 1).includes('-')
  s = s.replace(/[^\d.,]/g, '')

  const comas = (s.match(/,/g) ?? []).length
  const puntos = (s.match(/\./g) ?? []).length

  if (comas > 0 && puntos > 0) {
    // El separador que aparece de último es el decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (comas > 1) {
    s = s.replace(/,/g, '')
  } else if (puntos > 1) {
    s = s.replace(/\./g, '')
  } else if (comas === 1 || puntos === 1) {
    const sep = comas === 1 ? ',' : '.'
    const [entera, decimales] = s.split(sep)
    // "1.500" y "1,500" son miles; "0.500", "1,5" y "12.75" son decimales.
    const esMiles = decimales.length === 3 && entera !== '' && !/^0+$/.test(entera)
    s = esMiles ? entera + decimales : `${entera || '0'}.${decimales}`
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/** Valor numérico de una celda. Las celdas de texto pasan por parseNumero. */
export function numeroDeCelda(c: XLSX.CellObject | undefined): number | null {
  if (!c || c.v === undefined || c.v === null) return null
  if (c.t === 'n') return Number.isFinite(c.v as number) ? (c.v as number) : null
  if (c.t === 's') return parseNumero(c.v)
  return null
}

const ANIO = /\b(19[5-9]\d|20\d{2})\b/g

export const aniosEnTexto = (s: string): number[] =>
  [...s.matchAll(ANIO)].map((m) => Number(m[1]))

const esFormatoFecha = (c: XLSX.CellObject): boolean =>
  typeof c.z === 'string' && XLSX.SSF.is_date(c.z)

/**
 * Año que representa una celda usada como encabezado de columna:
 * una fecha (31/12/2025), un número de año (2025) o un texto corto
 * ("31 de diciembre de 2025", "Año 2025").
 */
export function anioDeCelda(c: XLSX.CellObject | undefined, permitirEntero = true): number | null {
  if (!c || c.v === undefined || c.v === null) return null
  if (c.t === 'n') {
    const v = c.v as number
    if (esFormatoFecha(c)) {
      const d = XLSX.SSF.parse_date_code(v)
      return d && d.y >= 1950 && d.y <= 2099 ? d.y : null
    }
    if (permitirEntero && Number.isInteger(v) && v >= 1950 && v <= 2099) return v
    return null
  }
  if (c.t === 's') {
    const s = String(c.v).trim()
    if (s.length > 40) return null
    const anios = aniosEnTexto(s)
    return anios.length === 1 ? anios[0] : null
  }
  return null
}

export const esNumerica = (c: XLSX.CellObject | undefined): boolean =>
  numeroDeCelda(c) !== null && !(c?.t === 's' && /[a-z]{3,}/i.test(String(c.v)))

/** "NOTA 4 - EFECTIVO", "Nota 12.", "NOTA   – PROPIEDAD…" */
export const esEncabezadoNota = (s: string): boolean => /^nota\b/i.test(s.trim())

export const tieneLetras = (s: string): boolean => /[a-záéíóúñ]{2,}/i.test(s)

/**
 * Encabezado de nota en cualquiera de los dos formatos vistos en archivos reales:
 *   A) una celda con "NOTA 4 - EFECTIVO Y EQUIVALENTES"
 *   B) el número solo en su celda y el título en la siguiente: 4 | EFECTIVO Y …
 * En el formato B la fila no puede traer ningún otro número: sería una línea de detalle.
 */
export function encabezadoNotaDeFila(h: Hoja, r: number): { numero: string | null; titulo: string } | null {
  const celdas: XLSX.CellObject[] = []
  for (let c = 0; c <= h.ultimaColumna; c++) {
    const x = celda(h, r, c)
    if (!vacia(x)) celdas.push(x!)
  }
  if (celdas.length === 0) return null

  const textos = celdas.filter((x) => x.t === 's' && tieneLetras(String(x.v)))
  const primerTexto = textos[0] ? texto(textos[0]).replace(/\s+/g, ' ') : null

  if (primerTexto && esEncabezadoNota(primerTexto)) {
    const m = primerTexto.match(/^nota\b\s*(?:n[°ºo]\.?\s*)?(\d+[a-z]?)?\s*[-–—.:]*\s*(.*)$/i)
    const numero = m?.[1] ?? null
    let titulo = (m?.[2] ?? '').trim()
    if (!titulo && textos[1]) titulo = texto(textos[1])
    return { numero, titulo: titulo || primerTexto }
  }

  const primera = celdas[0]
  const numeroSuelto =
    primera.t === 'n'
      ? Number.isInteger(primera.v) && (primera.v as number) >= 1 && (primera.v as number) <= 999
        ? String(primera.v)
        : null
      : primera.t === 's' && /^\d{1,3}[a-z]?[.)]?$/i.test(String(primera.v).trim())
        ? String(primera.v).trim().replace(/[.)]$/, '')
        : null
  const otrosNumeros = celdas.slice(1).some((x) => numeroDeCelda(x) !== null && !(x.t === 's' && tieneLetras(String(x.v))))
  if (numeroSuelto && primerTexto && !otrosNumeros) return { numero: numeroSuelto, titulo: primerTexto }
  return null
}

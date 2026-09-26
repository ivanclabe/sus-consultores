/**
 * Extracción de la hoja de notas.
 *
 * A diferencia de los balances, aquí no hay jerarquía de cuentas: cada nota es
 * un bloque libre con detalle, subtotales, totales y a veces texto. Se conserva
 * todo, en el orden del archivo, con sus valores de los dos años.
 *
 * Las columnas de cada año se leen de las filas de encabezado de años (que en
 * el archivo del cliente vienen como fechas, 31/12/2025, y pueden repetirse a
 * mitad de la hoja). No se asume ninguna posición fija.
 */
import type * as XLSX from 'xlsx'
import {
  abrirHoja,
  anioDeCelda,
  celda,
  encabezadoNotaDeFila,
  esError,
  numeroDeCelda,
  ref,
  texto,
  tieneLetras,
  vacia,
  type Hoja,
} from './excel'
import type { Descarte } from './parseBalance'

export type TipoLinea = 'encabezado' | 'detalle' | 'subtotal' | 'total' | 'texto'

export interface LineaNotaArchivo {
  orden: number
  fila: number
  etiqueta: string | null
  sangria: number
  tipo: TipoLinea
  actual: number | null
  anterior: number | null
  celdaActual: string | null
  celdaAnterior: string | null
}

export interface NotaArchivo {
  hoja: string
  orden: number
  numero: string | null
  titulo: string
  seccion: string | null
  filaInicio: number
  filaFin: number
  lineas: LineaNotaArchivo[]
}

export interface ExtraccionNotas {
  hoja: string
  notas: NotaArchivo[]
  /** Primera fila de encabezado de años encontrada (1-based). */
  filaAnios: number | null
  /** Columnas (letra) donde se encontró cada año en ese encabezado. */
  columnasAnios: Record<number, string>
  seEncontroActual: boolean
  seEncontroAnterior: boolean
  descartes: Descarte[]
  erroresCelda: string[]
  lineasSinEtiqueta: number
}

interface InfoFila {
  vacia: boolean
  etiqueta: string | null
  colEtiqueta: number | null
  nota: { numero: string | null; titulo: string } | null
}

function infoFila(h: Hoja, r: number): InfoFila {
  let hayContenido = false
  let etiqueta: string | null = null
  let colEtiqueta: number | null = null
  for (let c = 0; c <= h.ultimaColumna; c++) {
    const cel = celda(h, r, c)
    if (vacia(cel)) continue
    hayContenido = true
    if (etiqueta === null && cel?.t === 's' && tieneLetras(String(cel.v))) {
      etiqueta = texto(cel).replace(/\s+/g, ' ')
      colEtiqueta = c
    }
  }
  return {
    vacia: !hayContenido,
    etiqueta,
    colEtiqueta,
    nota: hayContenido ? encabezadoNotaDeFila(h, r) : null,
  }
}

/**
 * ¿Es una fila de encabezado de años? Sí cuando trae al menos dos celdas que
 * representan años y ningún otro número. Las fechas cuentan siempre; un entero
 * como 2025 solo cuenta si la fila no tiene una etiqueta de detalle.
 */
function aniosDeFila(h: Hoja, r: number, info: InfoFila, colBase: number): Map<number, number> | null {
  const sinEtiquetaDeDetalle = info.colEtiqueta === null || info.colEtiqueta > colBase + 1
  const anios = new Map<number, number>()
  for (let c = 0; c <= h.ultimaColumna; c++) {
    const cel = celda(h, r, c)
    if (vacia(cel) || !cel) continue
    if (cel.t === 'n') {
      const a = anioDeCelda(cel, sinEtiquetaDeDetalle)
      if (a === null) return null // otro número en la fila: no es encabezado
      anios.set(c, a)
    } else if (cel.t === 's') {
      const a = anioDeCelda(cel)
      if (a !== null) anios.set(c, a)
    }
  }
  return anios.size >= 2 ? anios : null
}

const primeraColumnaDe = (mapa: Map<number, number>, anio: number): number | null => {
  for (const [c, a] of [...mapa.entries()].sort((x, y) => x[0] - y[0])) if (a === anio) return c
  return null
}

function tipoDe(etiqueta: string | null, hayNumeros: boolean): TipoLinea {
  const e = (etiqueta ?? '').trim()
  if (!hayNumeros) return e.length > 90 ? 'texto' : 'encabezado'
  if (/^sub\s*-?\s*total/i.test(e)) return 'subtotal'
  if (/^total\b/i.test(e)) return 'total'
  return 'detalle'
}

export function extraerNotas(
  wb: XLSX.WorkBook,
  hojaNotas: string,
  anioActual: number,
  anioAnterior: number,
): ExtraccionNotas {
  const h = abrirHoja(wb, hojaNotas)
  const infos: InfoFila[] = []
  let colBase = Infinity
  for (let r = 0; r <= h.ultimaFila; r++) {
    const i = infoFila(h, r)
    infos.push(i)
    if (i.colEtiqueta !== null) colBase = Math.min(colBase, i.colEtiqueta)
  }
  if (!Number.isFinite(colBase)) colBase = 0

  const siguienteNoVacia = (r: number): InfoFila | null => {
    for (let k = r + 1; k < infos.length; k++) if (!infos[k].vacia) return infos[k]
    return null
  }

  const notas: NotaArchivo[] = []
  const descartes: Descarte[] = []
  const erroresCelda: string[] = []
  let mapaAnios = new Map<number, number>()
  let filaAnios: number | null = null
  let columnasAnios: Record<number, string> = {}
  let seEncontroActual = false
  let seEncontroAnterior = false
  let lineasSinEtiqueta = 0
  let seccionPendiente: string | null = null
  let actual: NotaArchivo | null = null

  for (let r = 0; r <= h.ultimaFila; r++) {
    const info = infos[r]
    if (info.vacia) continue

    const anios = aniosDeFila(h, r, info, colBase)
    if (anios) {
      mapaAnios = new Map([...mapaAnios, ...anios])
      if (filaAnios === null) {
        filaAnios = r + 1
        columnasAnios = Object.fromEntries([...anios.entries()].map(([c, a]) => [a, ref(r, c).replace(/\d+/, '')]))
      }
      if ([...anios.values()].includes(anioActual)) seEncontroActual = true
      if ([...anios.values()].includes(anioAnterior)) seEncontroAnterior = true
      continue
    }

    if (info.nota) {
      const { numero, titulo } = info.nota
      actual = {
        hoja: hojaNotas,
        orden: notas.length + 1,
        numero,
        titulo,
        seccion: seccionPendiente,
        filaInicio: r + 1,
        filaFin: r + 1,
        lineas: [],
      }
      notas.push(actual)
      seccionPendiente = null
      continue
    }

    if (!actual) {
      descartes.push({
        hoja: hojaNotas,
        fila: r + 1,
        motivo: 'Encabezado del documento, antes de la primera nota',
        contenido: info.etiqueta ?? '(sin texto)',
      })
      continue
    }

    const colA = primeraColumnaDe(mapaAnios, anioActual)
    const colB = primeraColumnaDe(mapaAnios, anioAnterior)
    for (const c of [colA, colB, info.colEtiqueta]) {
      if (c !== null && esError(celda(h, r, c))) erroresCelda.push(`${hojaNotas}!${ref(r, c)}`)
    }

    let hayNumeros = false
    for (let c = (info.colEtiqueta ?? -1) + 1; c <= h.ultimaColumna; c++) {
      if (numeroDeCelda(celda(h, r, c)) !== null) {
        hayNumeros = true
        break
      }
    }

    // Un título en mayúsculas sin valores justo antes de una nota es el nombre
    // de la sección que viene ("RESULTADOS DEL PERIODO"), no parte de esta nota.
    const sig = siguienteNoVacia(r)
    if (
      !hayNumeros &&
      info.etiqueta &&
      info.etiqueta === info.etiqueta.toUpperCase() &&
      sig?.nota
    ) {
      seccionPendiente = info.etiqueta
      continue
    }

    if (!info.etiqueta) lineasSinEtiqueta++
    actual.lineas.push({
      orden: actual.lineas.length + 1,
      fila: r + 1,
      etiqueta: info.etiqueta,
      sangria: Math.max(0, (info.colEtiqueta ?? colBase) - colBase),
      tipo: tipoDe(info.etiqueta, hayNumeros),
      actual: colA !== null ? numeroDeCelda(celda(h, r, colA)) : null,
      anterior: colB !== null ? numeroDeCelda(celda(h, r, colB)) : null,
      celdaActual: colA !== null ? `${hojaNotas}!${ref(r, colA)}` : null,
      celdaAnterior: colB !== null ? `${hojaNotas}!${ref(r, colB)}` : null,
    })
    actual.filaFin = r + 1
  }

  return {
    hoja: hojaNotas,
    notas,
    filaAnios,
    columnasAnios,
    seEncontroActual,
    seEncontroAnterior,
    descartes,
    erroresCelda,
    lineasSinEtiqueta,
  }
}

export interface ColumnasDeHoja {
  hoja: string
  notas: number
  filaAnios: number | null
  columnasAnios: Record<number, string>
  seEncontroActual: boolean
  seEncontroAnterior: boolean
}

export interface NotasDelLibro {
  hojas: string[]
  porHoja: ColumnasDeHoja[]
  notas: NotaArchivo[]
  descartes: Descarte[]
  erroresCelda: string[]
  lineasSinEtiqueta: number
}

/** Todas las hojas de notas del libro, en su orden, como una sola secuencia. */
export function extraerNotasDeHojas(
  wb: XLSX.WorkBook,
  hojas: string[],
  anioActual: number,
  anioAnterior: number,
): NotasDelLibro {
  const partes = hojas.map((h) => extraerNotas(wb, h, anioActual, anioAnterior))
  const notas = partes.flatMap((p) => p.notas).map((n, i) => ({ ...n, orden: i + 1 }))
  return {
    hojas,
    porHoja: partes.map((p) => ({
      hoja: p.hoja,
      notas: p.notas.length,
      filaAnios: p.filaAnios,
      columnasAnios: p.columnasAnios,
      seEncontroActual: p.seEncontroActual,
      seEncontroAnterior: p.seEncontroAnterior,
    })),
    notas,
    descartes: partes.flatMap((p) => p.descartes),
    erroresCelda: partes.flatMap((p) => p.erroresCelda),
    lineasSinEtiqueta: partes.reduce((s, p) => s + p.lineasSinEtiqueta, 0),
  }
}

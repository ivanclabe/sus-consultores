/**
 * Extracción de una hoja de balance de comprobación (Siigo u otro exportador).
 *
 * Todo determinístico. Principios:
 *  - Se conserva TODA la jerarquía: grupos, cuentas, subcuentas, auxiliares,
 *    subauxiliares y el detalle por tercero (NIT).
 *  - Ninguna fila con contenido se descarta en silencio: lo que no se
 *    incorpora queda en `descartes` con su motivo y su fila real de Excel.
 *  - Cada valor guarda la celda de donde salió.
 */
import {
  abrirHoja,
  celda,
  esError,
  normalizar,
  numeroDeCelda,
  ref,
  texto,
  vacia,
  type Hoja,
} from './excel'
import type * as XLSX from 'xlsx'
import type { Nivel } from './types'

export type NivelFila = Nivel | 'tercero'

export const NIVELES: Nivel[] = ['grupo', 'cuenta', 'subcuenta', 'auxiliar', 'subauxiliar']

export interface MapeoColumnas {
  hoja: string
  /** Índices 0-based reales de Excel. */
  filaEncabezado: number
  colNiveles: Partial<Record<Nivel, number>>
  /** Formato alterno: una sola columna con el código completo. */
  colCodigo: number | null
  colNombre: number | null
  colNit: number | null
  /** Saldo de cierre del periodo de la hoja ("NUEVO SALDO"). */
  colSaldo: number
  /** Saldo de apertura de la misma hoja ("SALDO ANTERIOR"). */
  colSaldoInicial: number | null
  /** Fecha del último movimiento ("ULT. MOV."). */
  colUltMov: number | null
}

export interface FilaHoja {
  hoja: string
  clave: string
  codigo: string
  nombre: string
  nivel: NivelFila
  nit: string | null
  padre: string | null
  fila: number
  celdaSaldo: string
  saldo: number | null
  saldoInicial: number | null
  /** Tal como lo muestra el Excel, p. ej. "2025/12/31". */
  ultimoMovimiento: string | null
}

export interface Descarte {
  hoja: string
  fila: number
  motivo: string
  contenido: string
}

export interface ExtraccionHoja {
  hoja: string
  mapeo: MapeoColumnas
  estiloCodigo: EstiloCodigo
  encabezados: string[]
  filas: FilaHoja[]
  descartes: Descarte[]
  filasEnBlanco: number
  filaTotales: { fila: number; saldo: number | null } | null
  erroresCelda: string[]
  codigosRepetidos: string[]
}

// ---------------------------------------------------------------------------
// Detección de columnas
// ---------------------------------------------------------------------------

/**
 * Nivel que nombra un encabezado. Tolera los truncamientos de Siigo
 * ("SUBCUENT", "SUBAUXIL") y no confunde "SALDO SUBCUENTA" con la columna.
 */
export function nivelDeEncabezado(encabezado: string): Nivel | null {
  const s = normalizar(encabezado).replace(/[^a-z ]/g, '').trim()
  if (/^sub ?aux/.test(s)) return 'subauxiliar'
  if (/^sub ?(cuent|cta)/.test(s)) return 'subcuenta'
  if (/^aux/.test(s)) return 'auxiliar'
  if (s === 'cuenta' || s === 'cuentas' || s === 'cta') return 'cuenta'
  if (s === 'grupo' || s === 'grupos') return 'grupo'
  return null
}

const esEncabezadoCodigo = (s: string): boolean =>
  /^(codigo|cod|codigo cuenta|cod cuenta|cuenta contable|codigo contable)$/.test(s)

const esEncabezadoNombre = (s: string): boolean =>
  s.includes('descripcion') || s === 'nombre' || s.includes('nombre cuenta') || s === 'detalle'

const esEncabezadoNit = (s: string): boolean => /^(nit|nit tercero|identificacion|tercero)$/.test(s)

function columnaSaldo(encabezados: string[]): number {
  const reglas: ((h: string) => boolean)[] = [
    (h) => h.includes('nuevo saldo'),
    (h) => h.includes('saldo final'),
    (h) => h.includes('saldo actual'),
    (h) => h.includes('saldo a '),
    (h) => h === 'saldo',
  ]
  for (const regla of reglas) {
    for (let i = encabezados.length - 1; i >= 0; i--) if (regla(encabezados[i])) return i
  }
  return -1
}

function columnaSaldoInicial(encabezados: string[]): number | null {
  const i = encabezados.findIndex(
    (h) => h.includes('saldo anterior') || h.includes('saldo inicial'),
  )
  return i >= 0 ? i : null
}

function columnaUltMov(encabezados: string[]): number | null {
  const i = encabezados.findIndex(
    (h) => (h.startsWith('ult') && h.includes('mov')) || h.includes('ultimo movimiento'),
  )
  return i >= 0 ? i : null
}

function encabezadosDeFila(h: Hoja, r: number): string[] {
  const out: string[] = []
  for (let c = 0; c <= h.ultimaColumna; c++) out.push(normalizar(texto(celda(h, r, c))))
  return out
}

/** Busca la fila de encabezados. null = la hoja no tiene estructura de balance. */
export function detectarMapeo(h: Hoja): MapeoColumnas | null {
  const limite = Math.min(h.ultimaFila, 60)
  for (let r = 0; r <= limite; r++) {
    const encabezados = encabezadosDeFila(h, r)
    const colNiveles: Partial<Record<Nivel, number>> = {}
    encabezados.forEach((e, c) => {
      const n = nivelDeEncabezado(e)
      if (n && colNiveles[n] === undefined) colNiveles[n] = c
    })
    const colCodigo = encabezados.findIndex(esEncabezadoCodigo)
    const niveles = Object.keys(colNiveles).length
    if (niveles < 2 && colCodigo < 0) continue

    const colSaldo = columnaSaldo(encabezados)
    if (colSaldo < 0) continue

    const usadas = new Set<number>(Object.values(colNiveles) as number[])
    const colNombre = encabezados.findIndex((e, c) => !usadas.has(c) && esEncabezadoNombre(e))
    const colNit = encabezados.findIndex(esEncabezadoNit)

    return {
      hoja: h.nombre,
      filaEncabezado: r,
      colNiveles: niveles >= 2 ? colNiveles : {},
      colCodigo: niveles >= 2 ? null : colCodigo,
      colNombre: colNombre >= 0 ? colNombre : null,
      colNit: colNit >= 0 ? colNit : null,
      colSaldo,
      colSaldoInicial: columnaSaldoInicial(encabezados),
      colUltMov: columnaUltMov(encabezados),
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Código contable de una fila
// ---------------------------------------------------------------------------

const digitos = (s: string): string => s.replace(/\D/g, '')
const pareceCodigo = (s: string): boolean => /^[\d\s.\-]+$/.test(s) && /\d/.test(s)

function fragmento(c: XLSX.CellObject | undefined, esPrimero: boolean): string {
  if (!c || vacia(c)) return ''
  if (c.t === 'n') {
    const s = String(c.v)
    // Si Excel guardó "05" como número 5, se pierde el cero: se repone.
    return esPrimero ? s : s.padStart(2, '0')
  }
  const s = texto(c)
  return pareceCodigo(s) ? digitos(s) : ''
}

const nivelPorLongitud = (codigo: string): Nivel =>
  codigo.length <= 2
    ? 'grupo'
    : codigo.length <= 4
      ? 'cuenta'
      : codigo.length <= 6
        ? 'subcuenta'
        : codigo.length <= 8
          ? 'auxiliar'
          : 'subauxiliar'

/**
 * Soporta las tres formas de escribir la jerarquía:
 *  - fragmentada, como Siigo: 11 | 20 | 05  → 112005
 *  - anidada: 11 | 1120 | 112005            → 112005
 *  - una sola columna de código             → nivel por longitud
 */
export type EstiloCodigo = 'fragmentado' | 'anidado'

function fragmentosDeFila(h: Hoja, r: number, m: MapeoColumnas): { nivel: Nivel; code: string }[] {
  const frags: { nivel: Nivel; code: string }[] = []
  for (const nivel of NIVELES) {
    const col = m.colNiveles[nivel]
    if (col === undefined) continue
    const code = fragmento(celda(h, r, col), frags.length === 0)
    if (code) frags.push({ nivel, code })
  }
  return frags
}

/**
 * El estilo se decide para toda la hoja, no fila por fila: en formato
 * fragmentado, grupo 25 + cuenta 25 (VACACIONES) parecería "anidado" si se
 * mirara solo esa fila, y el código quedaría 25 en vez de 2525.
 */
function detectarEstilo(h: Hoja, m: MapeoColumnas): EstiloCodigo {
  let anidadas = 0
  let total = 0
  for (let r = m.filaEncabezado + 1; r <= h.ultimaFila && total < 400; r++) {
    const frags = fragmentosDeFila(h, r, m)
    if (frags.length < 2) continue
    total++
    const esAnidada = frags.every(
      (f, i) => i === 0 || (f.code.length > frags[i - 1].code.length && f.code.startsWith(frags[i - 1].code)),
    )
    if (esAnidada) anidadas++
  }
  return total > 0 && anidadas / total >= 0.9 ? 'anidado' : 'fragmentado'
}

function codigoDeFila(
  h: Hoja,
  r: number,
  m: MapeoColumnas,
  estilo: EstiloCodigo,
): { codigo: string; nivel: Nivel } | null {
  if (m.colCodigo !== null) {
    const s = texto(celda(h, r, m.colCodigo))
    if (!pareceCodigo(s)) return null
    const codigo = digitos(s)
    return codigo ? { codigo, nivel: nivelPorLongitud(codigo) } : null
  }

  const frags = fragmentosDeFila(h, r, m)
  if (frags.length === 0) return null

  const codigo = estilo === 'anidado' ? frags[frags.length - 1].code : frags.map((f) => f.code).join('')
  return { codigo, nivel: frags[frags.length - 1].nivel }
}

// ---------------------------------------------------------------------------
// Extracción
// ---------------------------------------------------------------------------

function resumenFila(h: Hoja, r: number): string {
  const partes: string[] = []
  for (let c = 0; c <= h.ultimaColumna && partes.length < 6; c++) {
    const t = texto(celda(h, r, c))
    if (t) partes.push(t.slice(0, 40))
  }
  return partes.join(' | ')
}

function padreMasCercano(codigo: string, vistos: Set<string>): string | null {
  for (let i = codigo.length - 1; i >= 1; i--) {
    const p = codigo.slice(0, i)
    if (vistos.has(p)) return p
  }
  return null
}

export function extraerHoja(wb: XLSX.WorkBook, mapeo: MapeoColumnas): ExtraccionHoja {
  const h = abrirHoja(wb, mapeo.hoja)
  const estiloCodigo = detectarEstilo(h, mapeo)
  const encabezados: string[] = []
  for (let c = 0; c <= h.ultimaColumna; c++) {
    encabezados.push(texto(celda(h, mapeo.filaEncabezado, c)))
  }
  const encabezadosNorm = encabezados.map(normalizar)

  const filas: FilaHoja[] = []
  const descartes: Descarte[] = []
  const erroresCelda: string[] = []
  const vistos = new Set<string>()
  const repetidos = new Map<string, number>()
  let filasEnBlanco = 0
  let filaTotales: ExtraccionHoja['filaTotales'] = null
  let contexto: string | null = null

  const columnasClave = [
    ...(Object.values(mapeo.colNiveles) as number[]),
    mapeo.colCodigo,
    mapeo.colNombre,
    mapeo.colNit,
    mapeo.colSaldo,
    mapeo.colSaldoInicial,
    mapeo.colUltMov,
  ].filter((c): c is number => c !== null && c !== undefined)

  for (let r = mapeo.filaEncabezado + 1; r <= h.ultimaFila; r++) {
    let hayContenido = false
    for (let c = 0; c <= h.ultimaColumna; c++) {
      if (!vacia(celda(h, r, c))) {
        hayContenido = true
        break
      }
    }
    if (!hayContenido) {
      filasEnBlanco++
      continue
    }

    for (const c of columnasClave) {
      if (esError(celda(h, r, c))) erroresCelda.push(`${mapeo.hoja}!${ref(r, c)}`)
    }

    // Encabezado repetido (reportes paginados).
    const repite = columnasClave.every(
      (c) => normalizar(texto(celda(h, r, c))) === encabezadosNorm[c],
    )
    if (repite) {
      descartes.push({ hoja: mapeo.hoja, fila: r + 1, motivo: 'Encabezado repetido', contenido: resumenFila(h, r) })
      continue
    }

    const nombre = mapeo.colNombre !== null ? texto(celda(h, r, mapeo.colNombre)) : ''
    // El NIT es un identificador, no una cantidad: sin separadores de miles.
    const celdaNit = mapeo.colNit !== null ? celda(h, r, mapeo.colNit) : undefined
    const nit = celdaNit?.t === 'n' ? String(celdaNit.v) : texto(celdaNit) || null
    const saldo = numeroDeCelda(celda(h, r, mapeo.colSaldo))
    const saldoInicial =
      mapeo.colSaldoInicial !== null ? numeroDeCelda(celda(h, r, mapeo.colSaldoInicial)) : null
    const ultimoMovimiento =
      mapeo.colUltMov !== null ? texto(celda(h, r, mapeo.colUltMov)) || null : null
    const celdaSaldo = ref(r, mapeo.colSaldo)
    const info = codigoDeFila(h, r, mapeo, estiloCodigo)

    if (info) {
      const n = (repetidos.get(info.codigo) ?? 0) + 1
      repetidos.set(info.codigo, n)
      filas.push({
        hoja: mapeo.hoja,
        clave: n === 1 ? info.codigo : `${info.codigo}#${n}`,
        codigo: info.codigo,
        nombre: nombre || info.codigo,
        nivel: info.nivel,
        nit: null,
        padre: padreMasCercano(info.codigo, vistos),
        fila: r + 1,
        celdaSaldo,
        saldo,
        saldoInicial,
        ultimoMovimiento,
      })
      vistos.add(info.codigo)
      contexto = info.codigo
      continue
    }

    const textoFila = normalizar(resumenFila(h, r)).replace(/\s/g, '')
    if (!nit && textoFila.includes('total')) {
      filaTotales = { fila: r + 1, saldo }
      descartes.push({
        hoja: mapeo.hoja,
        fila: r + 1,
        motivo: 'Fila de totales del reporte (se usa para validar el cuadre)',
        contenido: resumenFila(h, r),
      })
      continue
    }

    if (contexto && saldo !== null && (nit || nombre)) {
      const base = `${contexto}·${nit ?? normalizar(nombre)}`
      const n = (repetidos.get(base) ?? 0) + 1
      repetidos.set(base, n)
      filas.push({
        hoja: mapeo.hoja,
        clave: n === 1 ? base : `${base}#${n}`,
        codigo: contexto,
        nombre: nombre || nit || '(tercero sin nombre)',
        nivel: 'tercero',
        nit,
        padre: contexto,
        fila: r + 1,
        celdaSaldo,
        saldo,
        saldoInicial,
        ultimoMovimiento,
      })
      continue
    }

    descartes.push({
      hoja: mapeo.hoja,
      fila: r + 1,
      motivo: contexto
        ? 'Fila sin código contable ni saldo numérico'
        : 'Fila antes de la primera cuenta, sin código contable',
      contenido: resumenFila(h, r),
    })
  }

  return {
    hoja: mapeo.hoja,
    mapeo,
    estiloCodigo,
    encabezados,
    filas,
    descartes,
    filasEnBlanco,
    filaTotales,
    erroresCelda,
    codigosRepetidos: [...repetidos.entries()]
      .filter(([k, n]) => n > 1 && !k.includes('·'))
      .map(([k]) => k),
  }
}

// ---------------------------------------------------------------------------
// Unión de varias hojas de un mismo período
// ---------------------------------------------------------------------------

export interface UnionPeriodo {
  extraccion: ExtraccionHoja
  /** Cuentas que aparecen en dos hojas del período con saldos distintos. */
  conflictos: string[]
  /** Cuentas repetidas con el mismo saldo: se toman una sola vez. */
  duplicadas: number
}

/**
 * Un período puede venir repartido en varias hojas (p. ej. activos en una y
 * pasivos en otra). Se unen por cuenta; si la misma cuenta aparece en dos hojas
 * con saldos distintos, es un conflicto que el usuario debe resolver.
 */
export function unirHojasDelPeriodo(extracciones: ExtraccionHoja[]): UnionPeriodo {
  if (extracciones.length === 1) return { extraccion: extracciones[0], conflictos: [], duplicadas: 0 }
  const porClave = new Map<string, FilaHoja>()
  const conflictos: string[] = []
  let duplicadas = 0
  for (const ext of extracciones) {
    for (const f of ext.filas) {
      const previa = porClave.get(f.clave)
      if (!previa) {
        porClave.set(f.clave, f)
      } else if (previa.saldo === f.saldo) {
        duplicadas++
      } else {
        conflictos.push(`${f.codigo} ${f.nombre}: ${previa.hoja} = ${previa.saldo} · ${f.hoja} = ${f.saldo}`)
      }
    }
  }
  const [primera] = extracciones
  return {
    conflictos,
    duplicadas,
    extraccion: {
      ...primera,
      hoja: extracciones.map((e) => e.hoja).join(' + '),
      filas: [...porClave.values()],
      descartes: extracciones.flatMap((e) => e.descartes),
      filasEnBlanco: extracciones.reduce((s, e) => s + e.filasEnBlanco, 0),
      // Cada hoja trae su propia fila de totales: se valida hoja por hoja.
      filaTotales: null,
      erroresCelda: extracciones.flatMap((e) => e.erroresCelda),
      codigosRepetidos: extracciones.flatMap((e) => e.codigosRepetidos),
    },
  }
}

// ---------------------------------------------------------------------------
// Unión de los dos años
// ---------------------------------------------------------------------------

export interface CuentaCombinada {
  clave: string
  codigo: string
  nombre: string
  nivel: NivelFila
  nit: string | null
  padre: string | null
  esHoja: boolean
  actual: number | null
  anterior: number | null
  saldoInicial: number | null
  ultimoMovimiento: string | null
  filaActual: number | null
  filaAnterior: number | null
  celdaActual: string | null
  celdaAnterior: string | null
}

const ordenClave = (c: { codigo: string; nivel: NivelFila; nit: string | null; clave: string }): string =>
  c.nivel === 'tercero' ? `${c.codigo}~${c.clave}` : c.clave

/**
 * Une ambas hojas por código de cuenta (y por cuenta + NIT para terceros).
 * Una cuenta que solo existe en un año queda con el otro valor en null:
 * se muestra como faltante, nunca como cero.
 */
export function combinarAnios(actual: ExtraccionHoja, anterior: ExtraccionHoja): CuentaCombinada[] {
  const porClave = new Map<string, CuentaCombinada>()

  for (const f of actual.filas) {
    porClave.set(f.clave, {
      clave: f.clave,
      codigo: f.codigo,
      nombre: f.nombre,
      nivel: f.nivel,
      nit: f.nit,
      padre: f.padre,
      esHoja: false,
      actual: f.saldo,
      anterior: null,
      saldoInicial: f.saldoInicial,
      ultimoMovimiento: f.ultimoMovimiento,
      filaActual: f.fila,
      filaAnterior: null,
      celdaActual: `${f.hoja}!${f.celdaSaldo}`,
      celdaAnterior: null,
    })
  }

  for (const f of anterior.filas) {
    const existente = porClave.get(f.clave)
    if (existente) {
      existente.anterior = f.saldo
      existente.filaAnterior = f.fila
      existente.celdaAnterior = `${f.hoja}!${f.celdaSaldo}`
      if (existente.nombre === existente.codigo && f.nombre !== f.codigo) existente.nombre = f.nombre
      continue
    }
    porClave.set(f.clave, {
      clave: f.clave,
      codigo: f.codigo,
      nombre: f.nombre,
      nivel: f.nivel,
      nit: f.nit,
      padre: f.padre,
      esHoja: false,
      actual: null,
      anterior: f.saldo,
      saldoInicial: null,
      ultimoMovimiento: null,
      filaActual: null,
      filaAnterior: f.fila,
      celdaActual: null,
      celdaAnterior: `${f.hoja}!${f.celdaSaldo}`,
    })
  }

  const cuentas = [...porClave.values()].sort((a, b) =>
    ordenClave(a) < ordenClave(b) ? -1 : ordenClave(a) > ordenClave(b) ? 1 : 0,
  )

  // Padre y hoja se recalculan sobre la unión de ambos años.
  const codigos = new Set(cuentas.filter((c) => c.nivel !== 'tercero').map((c) => c.codigo))
  const ordenados = [...codigos].sort()
  for (const c of cuentas) {
    if (c.nivel === 'tercero') {
      c.esHoja = false
      continue
    }
    c.padre = padreMasCercano(c.codigo, codigos)
    // Es hoja si ninguna otra cuenta lo tiene como prefijo.
    const i = ordenados.indexOf(c.codigo)
    const siguiente = ordenados[i + 1]
    c.esHoja = !(siguiente && siguiente.startsWith(c.codigo))
  }
  return cuentas
}

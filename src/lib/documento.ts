/**
 * Modelo de presentación del informe final. La vista previa, el Excel y el PDF
 * se arman desde aquí para que los tres muestren exactamente lo mismo.
 *
 * No calcula nada nuevo: reordena las líneas de calculos.ts en secciones
 * (ACTIVO, PASIVO, PATRIMONIO) y agrega la variación entre años.
 */
import type { Encabezado } from './empresaArchivo'
import type { LineaEstado, Nota } from './types'

export type TipoFila = 'seccion' | 'titulo' | 'rubro' | 'subtotal' | 'total' | 'gran_total' | 'espacio'

export interface FilaPresentacion {
  tipo: TipoFila
  etiqueta: string
  nota: number | null
  actual: number | null
  anterior: number | null
  variacion: number | null
  /** Fracción (0.12 = 12 %). null cuando el año anterior es 0 o no existe. */
  porcentaje: number | null
}

export interface DocumentoFinanciero {
  encabezado: Encabezado
  periodoActual: number
  periodoAnterior: number | null
  esf: FilaPresentacion[]
  er: FilaPresentacion[]
  notas: NotaPresentacion[]
  aprobadoAt: string | null
  generadoAt: Date
  cuadra: boolean
}

export interface NotaPresentacion {
  numero: number
  titulo: string
  lineas: { codigo: string; nombre: string; actual: number; anterior: number | null; variacion: number | null; porcentaje: number | null }[]
  totalActual: number
  totalAnterior: number | null
  variacion: number | null
  porcentaje: number | null
}

const valido = (n: number | null | undefined): n is number => n !== null && n !== undefined && !Number.isNaN(n)

/** Cero en los dos años (redondeado a pesos): no se presenta. */
const enCero = (a: number | null, b: number | null): boolean =>
  Math.round(a ?? 0) === 0 && Math.round(b ?? 0) === 0

export function variacion(actual: number | null, anterior: number | null) {
  if (!valido(actual) || !valido(anterior)) return { variacion: null, porcentaje: null }
  const v = actual - anterior
  return { variacion: v, porcentaje: anterior === 0 ? null : v / Math.abs(anterior) }
}

function fila(tipo: TipoFila, etiqueta: string, l?: Partial<LineaEstado>): FilaPresentacion {
  const actual = valido(l?.actual) ? l!.actual! : null
  const anterior = valido(l?.anterior) ? l!.anterior! : null
  return { tipo, etiqueta, nota: l?.nota ?? null, actual, anterior, ...variacion(actual, anterior) }
}

const GRUPO = (titulo: string): 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' =>
  /^activo/i.test(titulo) ? 'ACTIVO' : /^pasivo/i.test(titulo) ? 'PASIVO' : 'PATRIMONIO'

/** ESF agrupado: ACTIVO → bloques → TOTAL ACTIVO; PASIVO …; PATRIMONIO …; TOTAL PASIVO Y PATRIMONIO. */
export function presentarESF(esf: LineaEstado[]): FilaPresentacion[] {
  const totales = new Map(esf.filter((l) => l.tipo === 'total').map((l) => [l.etiqueta, l]))
  const bloques: { grupo: string; titulo: string; lineas: LineaEstado[]; total: LineaEstado | null }[] = []
  let actual: (typeof bloques)[number] | null = null
  for (const l of esf) {
    if (l.tipo === 'total') continue
    if (l.tipo === 'subtotal' && Number.isNaN(l.actual)) {
      actual = { grupo: GRUPO(l.etiqueta), titulo: l.etiqueta, lineas: [], total: null }
      bloques.push(actual)
    } else if (l.tipo === 'subtotal' && actual) {
      actual.total = l
    } else if (actual) {
      actual.lineas.push(l)
    }
  }

  const out: FilaPresentacion[] = []
  for (const grupo of ['ACTIVO', 'PASIVO', 'PATRIMONIO'] as const) {
    const delGrupo = bloques.filter((b) => b.grupo === grupo)
    const total = totales.get(`TOTAL ${grupo}`)
    if (delGrupo.length === 0 && !total) continue
    out.push(fila('seccion', grupo))
    for (const b of delGrupo) {
      // Con un solo bloque, su subtotal repetiría el total del grupo.
      const unico = delGrupo.length === 1
      if (!(unico && grupo === 'PATRIMONIO')) out.push(fila('titulo', b.titulo))
      for (const l of b.lineas) if (!enCero(l.actual, l.anterior)) out.push(fila('rubro', l.etiqueta, l))
      if (b.total && !unico) out.push(fila('subtotal', b.total.etiqueta, b.total))
    }
    if (total) out.push(fila('total', `Total ${grupo.toLowerCase()}`, total))
    out.push(fila('espacio', ''))
  }
  const pyp = totales.get('TOTAL PASIVO Y PATRIMONIO')
  if (pyp) out.push(fila('gran_total', 'Total pasivo y patrimonio', pyp))
  return out
}

export function presentarER(er: LineaEstado[]): FilaPresentacion[] {
  return er.filter((l) => l.tipo !== 'rubro' || !enCero(l.actual, l.anterior)).map((l) =>
    l.tipo === 'total'
      ? fila('gran_total', 'Resultado del periodo', l)
      : l.tipo === 'subtotal'
        ? fila('total', l.etiqueta, l)
        : fila('rubro', l.etiqueta, l),
  )
}

/** Las líneas en cero los dos años no aportan nada al lector: se omiten (el total no cambia). */
export function presentarNotas(notas: Nota[]): NotaPresentacion[] {
  return notas.filter((n) => !enCero(n.totalActual, n.totalAnterior) || n.detalle.some((d) => !enCero(d.actual, d.anterior))).map((n) => ({
    numero: n.numero,
    titulo: n.titulo,
    lineas: n.detalle
      .filter((d) => !enCero(d.actual, d.anterior))
      .map((d) => ({ ...d, nombre: d.nombre.replace(/\s+/g, ' ').trim(), ...variacion(d.actual, d.anterior) })),
    totalActual: n.totalActual,
    totalAnterior: n.totalAnterior,
    ...variacion(n.totalActual, n.totalAnterior),
  }))
}

export function armarDocumento(p: {
  encabezado: Encabezado
  periodoActual: number
  periodoAnterior: number | null
  esf: LineaEstado[]
  er: LineaEstado[]
  notas: Nota[]
  aprobadoAt: string | null
}): DocumentoFinanciero {
  const t = (e: string) => p.esf.find((l) => l.etiqueta === e)
  const a = t('TOTAL ACTIVO')
  const pyp = t('TOTAL PASIVO Y PATRIMONIO')
  const cuadra = !!a && !!pyp && Math.abs(a.actual - pyp.actual) < 1 &&
    (a.anterior === null || pyp.anterior === null || Math.abs(a.anterior - pyp.anterior) < 1)
  // Las notas que se presentan se numeran seguidas (1, 2, 3…) y los estados apuntan al número nuevo.
  const notas = presentarNotas(p.notas)
  const renumero = new Map(notas.map((n, i) => [n.numero, i + 1]))
  notas.forEach((n, i) => (n.numero = i + 1))
  const enlazar = (fs: FilaPresentacion[]) =>
    fs.map((f) => (f.nota === null ? f : { ...f, nota: renumero.get(f.nota) ?? null }))
  return {
    encabezado: p.encabezado,
    periodoActual: p.periodoActual,
    periodoAnterior: p.periodoAnterior,
    esf: enlazar(presentarESF(p.esf)),
    er: enlazar(presentarER(p.er)),
    notas,
    aprobadoAt: p.aprobadoAt,
    generadoAt: new Date(),
    cuadra,
  }
}

// ---------------------------------------------------------------------------
// Textos del encabezado
// ---------------------------------------------------------------------------

const diaMes = (fecha: string) => fecha.replace(/\s+de\s+\d{4}$/, '')
const anioDe = (fecha: string) => fecha.match(/(\d{4})$/)?.[1] ?? ''

/** "Al 31 de diciembre de 2025 y 2024" o, si los cortes difieren, ambas fechas completas. */
export function textoCorte(d: DocumentoFinanciero): string {
  const { fechaCorte: a, fechaCorteAnterior: b } = d.encabezado
  if (!b || !d.periodoAnterior) return `Al ${a}`
  return diaMes(a) === diaMes(b) ? `Al ${diaMes(a)} de ${anioDe(a)} y ${anioDe(b)}` : `Al ${a} y al ${b}`
}

export function textoPeriodoResultados(d: DocumentoFinanciero): string {
  const { fechaCorte: a, fechaCorteAnterior: b } = d.encabezado
  const anual = /^31 de diciembre/.test(a)
  if (!b || !d.periodoAnterior) return anual ? `Por el año terminado el ${a}` : `Por el período terminado el ${a}`
  if (diaMes(a) === diaMes(b)) {
    return anual
      ? `Por los años terminados el ${diaMes(a)} de ${anioDe(a)} y ${anioDe(b)}`
      : `Por los períodos terminados el ${diaMes(a)} de ${anioDe(a)} y ${anioDe(b)}`
  }
  return `Por los períodos terminados el ${a} y el ${b}`
}

export const nombreArchivo = (d: DocumentoFinanciero, ext: 'xlsx' | 'pdf'): string =>
  `Estados financieros ${d.encabezado.razonSocial || 'empresa'} ${d.periodoActual}`
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + `.${ext}`

export const formatoNumero = (n: number | null): string =>
  n === null ? '' : n < 0
    ? `(${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.abs(n))})`
    : Math.round(n) === 0 ? '–' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)

/** Variaciones de más de 999 % no dicen nada útil: "n.s." (no significativa). */
export const formatoPorcentaje = (p: number | null): string =>
  p === null ? '' : Math.abs(p) >= 10 ? 'n.s.' : `${p < 0 ? '(' : ''}${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(Math.abs(p) * 100)} %${p < 0 ? ')' : ''}`

export const fechaHoy = (d: Date = new Date()): string =>
  d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

export interface Firmante {
  nombre: string
  cargo: string
  detalle: string
}

/** Representante y contador siempre; revisor fiscal solo si se registró. */
export function firmantes(e: Encabezado): Firmante[] {
  const out: Firmante[] = [
    { nombre: e.representanteLegal, cargo: 'Representante legal', detalle: '' },
    { nombre: e.contador, cargo: 'Contador público', detalle: e.tarjetaContador ? `T.P. ${e.tarjetaContador}` : '' },
  ]
  if (e.revisorFiscal) {
    out.push({ nombre: e.revisorFiscal, cargo: 'Revisor fiscal', detalle: e.tarjetaRevisor ? `T.P. ${e.tarjetaRevisor}` : '' })
  }
  return out
}

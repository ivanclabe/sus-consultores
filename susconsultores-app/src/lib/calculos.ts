/**
 * Cálculos financieros. 100% determinístico, sin excepción (sección 10 del
 * documento). El modelo propone etiquetas; los números salen solo de aquí.
 */
import type { CuentaClasificada, LineaEstado, Nota, Rubro } from './types'

export type Convencion = 'absoluto' | 'acreedor_negativo'

/**
 * Cómo vienen firmados los saldos acreedores en este archivo.
 * Se deduce del propio archivo en vez de asumirlo: si la suma de pasivo,
 * patrimonio e ingresos es negativa, el exportador los trae en negativo.
 */
export function detectarConvencion(
  cuentas: CuentaClasificada[],
  rubros: Rubro[],
): Convencion {
  const porCodigo = new Map(rubros.map((r) => [r.codigo, r]))
  let suma = 0
  for (const c of cuentas) {
    const r = c.clasificacion.rubro_codigo ? porCodigo.get(c.clasificacion.rubro_codigo) : null
    if (r?.naturaleza === 'acreedora') suma += c.saldo_actual ?? 0
  }
  return suma < 0 ? 'acreedor_negativo' : 'absoluto'
}

const signo = (r: Rubro, conv: Convencion): number =>
  r.naturaleza === 'acreedora' && conv === 'acreedor_negativo' ? -1 : 1

const redondear = (n: number): number => Math.round(n * 100) / 100

export function presentables(cuentas: CuentaClasificada[]): CuentaClasificada[] {
  return cuentas.filter(
    (c) =>
      c.es_hoja &&
      c.clasificacion.rubro_codigo !== null &&
      c.clasificacion.estado !== 'excluida' &&
      c.clasificacion.estado !== 'sin_clasificar',
  )
}

/** RF-017, RF-018: una nota por número, con su detalle a nivel de cuenta. */
export function construirNotas(
  cuentas: CuentaClasificada[],
  rubros: Rubro[],
  conv: Convencion,
): Nota[] {
  const porCodigo = new Map(rubros.map((r) => [r.codigo, r]))
  const porNota = new Map<number, Nota>()

  for (const c of presentables(cuentas)) {
    const r = porCodigo.get(c.clasificacion.rubro_codigo!)
    if (!r || r.nota_numero === null) continue

    let nota = porNota.get(r.nota_numero)
    if (!nota) {
      nota = {
        numero: r.nota_numero,
        titulo: r.nombre,
        rubros: [],
        detalle: [],
        totalActual: 0,
        totalAnterior: null,
      }
      porNota.set(r.nota_numero, nota)
    }
    if (!nota.rubros.includes(r.codigo)) nota.rubros.push(r.codigo)

    const s = signo(r, conv)
    const actual = (c.saldo_actual ?? 0) * s
    const anterior = c.saldo_anterior === null ? null : c.saldo_anterior * s

    nota.detalle.push({ codigo: c.codigo, nombre: c.nombre, actual, anterior })
    nota.totalActual += actual
    if (anterior !== null) nota.totalAnterior = (nota.totalAnterior ?? 0) + anterior
  }

  const notas = [...porNota.values()]
  for (const n of notas) {
    n.detalle.sort((a, b) => a.codigo.localeCompare(b.codigo))
    n.totalActual = redondear(n.totalActual)
    if (n.totalAnterior !== null) n.totalAnterior = redondear(n.totalAnterior)
  }
  // RB-006: una nota sin detalle no existe.
  return notas.filter((n) => n.detalle.length > 0).sort((a, b) => a.numero - b.numero)
}

interface Bloque {
  titulo: string
  secciones: string[]
  totalEtiqueta: string
}

const BLOQUES_ESF: Bloque[] = [
  { titulo: 'Activo corriente', secciones: ['activo_corriente'], totalEtiqueta: 'Total activo corriente' },
  { titulo: 'Activo no corriente', secciones: ['activo_no_corriente'], totalEtiqueta: 'Total activo no corriente' },
  { titulo: 'Pasivo corriente', secciones: ['pasivo_corriente'], totalEtiqueta: 'Total pasivo corriente' },
  { titulo: 'Pasivo no corriente', secciones: ['pasivo_no_corriente'], totalEtiqueta: 'Total pasivo no corriente' },
  { titulo: 'Patrimonio', secciones: ['patrimonio'], totalEtiqueta: 'Total patrimonio' },
]

function totalDeRubro(nota: Nota | undefined): { actual: number; anterior: number | null } {
  return { actual: nota?.totalActual ?? 0, anterior: nota?.totalAnterior ?? null }
}

/**
 * RF-019 y RF-021: el estado se arma desde las notas y omite lo que no existe.
 * El balance de comprobación trae las cuentas de resultado sin cerrar, así que
 * el resultado del periodo se presenta dentro del patrimonio: sin él, el
 * patrimonio queda incompleto y el balance no cuadra.
 */
export function construirESF(
  rubros: Rubro[],
  notas: Nota[],
  resultado: { actual: number; anterior: number | null } | null = null,
): LineaEstado[] {
  const porNota = new Map(notas.map((n) => [n.numero, n]))
  const lineas: LineaEstado[] = []
  const acumulado = { activo: [0, 0], pasivo: [0, 0], patrimonio: [0, 0] }
  let hayAnterior = false

  for (const bloque of BLOQUES_ESF) {
    const delBloque = rubros
      .filter((r) => r.estado === 'ESF' && bloque.secciones.includes(r.seccion) && r.activo)
      .sort((a, b) => a.orden - b.orden)

    const conDatos = delBloque.filter(
      (r) => r.nota_numero !== null && porNota.has(r.nota_numero),
    )
    const esPatrimonio = bloque.secciones.includes('patrimonio')
    if (conDatos.length === 0 && !(esPatrimonio && resultado)) continue

    lineas.push({ tipo: 'subtotal', etiqueta: bloque.titulo, nota: null, actual: NaN, anterior: null })

    let sa = 0
    let sb = 0
    for (const r of conDatos) {
      const { actual, anterior } = totalDeRubro(porNota.get(r.nota_numero!))
      if (anterior !== null) hayAnterior = true
      lineas.push({ tipo: 'rubro', etiqueta: r.nombre, nota: r.nota_numero, actual, anterior })
      sa += actual
      sb += anterior ?? 0
    }
    if (esPatrimonio && resultado) {
      if (resultado.anterior !== null) hayAnterior = true
      lineas.push({
        tipo: 'rubro',
        etiqueta: 'Resultado del periodo',
        nota: null,
        actual: resultado.actual,
        anterior: resultado.anterior,
      })
      sa += resultado.actual
      sb += resultado.anterior ?? 0
    }

    lineas.push({
      tipo: 'subtotal',
      etiqueta: bloque.totalEtiqueta,
      nota: null,
      actual: redondear(sa),
      anterior: hayAnterior ? redondear(sb) : null,
    })

    const grupo = bloque.secciones[0].startsWith('activo')
      ? 'activo'
      : bloque.secciones[0].startsWith('pasivo')
        ? 'pasivo'
        : 'patrimonio'
    acumulado[grupo][0] += sa
    acumulado[grupo][1] += sb
  }

  const cierre = (etiqueta: string, v: number[]): LineaEstado => ({
    tipo: 'total',
    etiqueta,
    nota: null,
    actual: redondear(v[0]),
    anterior: hayAnterior ? redondear(v[1]) : null,
  })

  const salida: LineaEstado[] = [...lineas]
  salida.push(cierre('TOTAL ACTIVO', acumulado.activo))
  salida.push(cierre('TOTAL PASIVO', acumulado.pasivo))
  salida.push(cierre('TOTAL PATRIMONIO', acumulado.patrimonio))
  salida.push(
    cierre('TOTAL PASIVO Y PATRIMONIO', [
      acumulado.pasivo[0] + acumulado.patrimonio[0],
      acumulado.pasivo[1] + acumulado.patrimonio[1],
    ]),
  )
  return salida
}

const BLOQUES_ER: { seccion: string; factor: number }[] = [
  { seccion: 'ingresos', factor: 1 },
  { seccion: 'costos', factor: -1 },
  { seccion: 'gastos', factor: -1 },
  { seccion: 'otros_ingresos', factor: 1 },
  { seccion: 'otros_gastos', factor: -1 },
  { seccion: 'impuesto', factor: -1 },
]

/** RF-020: mismo mecanismo que el ESF, con el signo de cada sección. */
export function construirER(rubros: Rubro[], notas: Nota[]): LineaEstado[] {
  const porNota = new Map(notas.map((n) => [n.numero, n]))
  const lineas: LineaEstado[] = []
  let acumA = 0
  let acumB = 0
  let hayAnterior = false

  for (const bloque of BLOQUES_ER) {
    const delBloque = rubros
      .filter((r) => r.estado === 'ER' && r.seccion === bloque.seccion && r.activo)
      .sort((a, b) => a.orden - b.orden)
      .filter((r) => r.nota_numero !== null && porNota.has(r.nota_numero))

    for (const r of delBloque) {
      const { actual, anterior } = totalDeRubro(porNota.get(r.nota_numero!))
      if (anterior !== null) hayAnterior = true
      lineas.push({
        tipo: 'rubro',
        etiqueta: r.nombre,
        nota: r.nota_numero,
        actual: redondear(actual),
        anterior: anterior === null ? null : redondear(anterior),
      })
      acumA += actual * bloque.factor
      acumB += (anterior ?? 0) * bloque.factor
    }

    if (bloque.seccion === 'costos' && lineas.length > 0) {
      lineas.push({
        tipo: 'subtotal',
        etiqueta: 'Utilidad bruta',
        nota: null,
        actual: redondear(acumA),
        anterior: hayAnterior ? redondear(acumB) : null,
      })
    }
  }

  lineas.push({
    tipo: 'total',
    etiqueta: 'RESULTADO DEL PERIODO',
    nota: null,
    actual: redondear(acumA),
    anterior: hayAnterior ? redondear(acumB) : null,
  })
  return lineas
}

export const buscarLinea = (lineas: LineaEstado[], etiqueta: string): LineaEstado | undefined =>
  lineas.find((l) => l.etiqueta === etiqueta)

/** Notas, estado de resultados y balance, en ese orden: el balance necesita el resultado. */
export function construirEstados(cuentas: CuentaClasificada[], rubros: Rubro[]) {
  const convencion = detectarConvencion(cuentas, rubros)
  const notas = construirNotas(cuentas, rubros, convencion)
  const er = construirER(rubros, notas)
  const resultado = buscarLinea(er, 'RESULTADO DEL PERIODO') ?? null
  const esf = construirESF(rubros, notas, resultado && { actual: resultado.actual, anterior: resultado.anterior })
  return { convencion, notas, esf, er }
}

export const formatearMoneda = (n: number | null): string =>
  n === null || Number.isNaN(n)
    ? ''
    : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)

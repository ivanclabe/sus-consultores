/**
 * Validaciones y controles (sección 12 del documento).
 * Determinísticas y baratas: se recalculan en cada cambio del contador.
 *
 * V-01, V-02 y V-03 son las que impiden que la automatización altere la
 * información financiera. Las demás avisan.
 */
import { buscarLinea, presentables } from './calculos'
import type { CuentaClasificada, LineaEstado, Nota, ResultadoValidacion, Rubro } from './types'

const TOLERANCIA = 0.5 // pesos

const cerca = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCIA
const abs = (n: number | null): number => Math.abs(n ?? 0)

export function ejecutarValidaciones(
  cuentas: CuentaClasificada[],
  rubros: Rubro[],
  notas: Nota[],
  esf: LineaEstado[],
  er: LineaEstado[],
): ResultadoValidacion[] {
  const hojas = cuentas.filter((c) => c.es_hoja)
  const out: ResultadoValidacion[] = []

  // V-01 — Cobertura: ninguna cuenta con saldo puede quedarse sin decisión.
  const sinClasificar = hojas.filter(
    (c) => c.clasificacion.rubro_codigo === null && c.clasificacion.estado !== 'excluida',
  )
  out.push({
    codigo: 'V-01',
    titulo: 'Todas las cuentas con saldo fueron clasificadas',
    ok: sinClasificar.length === 0,
    bloqueante: true,
    detalle:
      sinClasificar.length === 0
        ? `${hojas.length} cuentas clasificadas.`
        : `${sinClasificar.length} cuenta(s) sin clasificar: ` +
          sinClasificar.slice(0, 5).map((c) => `${c.codigo} ${c.nombre}`).join('; ') +
          (sinClasificar.length > 5 ? '…' : ''),
  })

  // V-02 — Integridad: nada se pierde ni se duplica entre el archivo y las notas.
  const sumaArchivo = hojas.reduce((s, c) => s + abs(c.saldo_actual), 0)
  const sumaPresentada = presentables(cuentas).reduce((s, c) => s + abs(c.saldo_actual), 0)
  const sumaExcluida = hojas
    .filter((c) => c.clasificacion.estado === 'excluida')
    .reduce((s, c) => s + abs(c.saldo_actual), 0)
  const sumaPendiente = sinClasificar.reduce((s, c) => s + abs(c.saldo_actual), 0)
  const diferencia = sumaArchivo - (sumaPresentada + sumaExcluida + sumaPendiente)
  out.push({
    codigo: 'V-02',
    titulo: 'Integridad de importes contra el balance de comprobación',
    ok: cerca(diferencia, 0),
    bloqueante: true,
    detalle: cerca(diferencia, 0)
      ? 'Cada saldo del archivo está representado exactamente una vez.'
      : `Diferencia de ${diferencia.toFixed(2)} entre el archivo y lo clasificado.`,
  })

  // V-03 — El total de cada nota es la suma de su propio detalle.
  const notasMal = notas.filter(
    (n) => !cerca(n.detalle.reduce((s, d) => s + d.actual, 0), n.totalActual),
  )
  out.push({
    codigo: 'V-03',
    titulo: 'El total de cada nota coincide con su detalle',
    ok: notasMal.length === 0,
    bloqueante: true,
    detalle:
      notasMal.length === 0
        ? `${notas.length} notas cuadradas.`
        : `Notas descuadradas: ${notasMal.map((n) => n.numero).join(', ')}.`,
  })

  // V-04 — Cada línea del estado es el total de la nota que referencia.
  const porNota = new Map(notas.map((n) => [n.numero, n]))
  const lineasRubro = [...esf, ...er].filter((l) => l.tipo === 'rubro' && l.nota !== null)
  const lineasMal = lineasRubro.filter((l) => {
    const n = porNota.get(l.nota!)
    return !n || !cerca(n.totalActual, l.actual)
  })
  out.push({
    codigo: 'V-04',
    titulo: 'Cada línea de los estados trae el total de su nota',
    ok: lineasMal.length === 0,
    bloqueante: true,
    detalle:
      lineasMal.length === 0
        ? `${lineasRubro.length} líneas verificadas.`
        : `Líneas descuadradas: ${lineasMal.map((l) => l.etiqueta).join('; ')}.`,
  })

  // V-05 — Numeración de notas consistente en los dos sentidos.
  const referenciadas = new Set(lineasRubro.map((l) => l.nota!))
  const huerfanas = notas.filter((n) => !referenciadas.has(n.numero))
  out.push({
    codigo: 'V-05',
    titulo: 'Toda nota generada está referenciada en un estado',
    ok: huerfanas.length === 0,
    bloqueante: false,
    detalle:
      huerfanas.length === 0
        ? 'Sin notas huérfanas.'
        : `Notas sin referencia: ${huerfanas.map((n) => n.numero).join(', ')}.`,
  })

  // V-06 — Ecuación patrimonial. PROPUESTA: el cliente no la pidió.
  // El resultado del periodo ya está dentro del patrimonio (construirESF).
  const activo = buscarLinea(esf, 'TOTAL ACTIVO')?.actual ?? 0
  const pasivoPat = buscarLinea(esf, 'TOTAL PASIVO Y PATRIMONIO')?.actual ?? 0
  const incluyeResultado = esf.some((l) => l.etiqueta === 'Resultado del periodo')
  const resultado = incluyeResultado ? 0 : buscarLinea(er, 'RESULTADO DEL PERIODO')?.actual ?? 0
  const brecha = activo - (pasivoPat + resultado)
  out.push({
    codigo: 'V-06',
    titulo: 'Activo = Pasivo + Patrimonio (con el resultado del periodo)',
    ok: cerca(brecha, 0),
    bloqueante: false,
    detalle: cerca(brecha, 0)
      ? 'La ecuación cuadra.'
      : `Diferencia de ${brecha.toFixed(2)}. Revisa el signo de los saldos acreedores ` +
        `y la clasificación de patrimonio antes de entregar.`,
  })

  // V-07 — Periodo comparativo.
  const conAnterior = hojas.filter((c) => c.saldo_anterior !== null).length
  out.push({
    codigo: 'V-07',
    titulo: 'Periodo comparativo disponible',
    ok: conAnterior > 0,
    bloqueante: false,
    detalle:
      conAnterior > 0
        ? `${conAnterior} cuentas traen saldo del periodo anterior.`
        : 'El archivo no trae periodo anterior: el informe saldrá con una sola columna.',
  })

  // V-08 — Rubros del catálogo que este archivo no usa. Solo informativo.
  const usados = new Set(presentables(cuentas).map((c) => c.clasificacion.rubro_codigo))
  const noUsados = rubros.filter((r) => r.activo && !usados.has(r.codigo))
  out.push({
    codigo: 'V-08',
    titulo: 'Rubros omitidos por no tener información',
    ok: true,
    bloqueante: false,
    detalle:
      noUsados.length === 0
        ? 'La empresa usa todos los rubros del catálogo.'
        : `No se presentan (RB-006): ${noUsados.map((r) => r.nombre).join(', ')}.`,
  })

  return out
}

export const hayBloqueantes = (v: ResultadoValidacion[]): boolean =>
  v.some((r) => r.bloqueante && !r.ok)

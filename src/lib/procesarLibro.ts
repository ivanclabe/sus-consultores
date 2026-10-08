/**
 * Orquestación del procesamiento del Excel. El orden es obligatorio:
 *
 *   1. clasificar todas las hojas (clasificarHojas.ts)   ← ocurre antes de esto
 *   2. extraer el año actual SOLO de las hojas del año actual
 *   3. extraer el año anterior SOLO de las hojas del año anterior
 *   4. unir ambos años por cuenta
 *   5. extraer las notas SOLO de las hojas de notas
 *   6. validar
 *
 * Todo determinístico y sin efectos: la misma entrada da siempre la misma salida.
 * Nada se guarda aquí; PasoCargar persiste el resultado cuando el usuario continúa.
 */
import type * as XLSX from 'xlsx'
import { abrirHoja } from './excel'
import { hojasDe, type Clasificacion, type Destino } from './clasificarHojas'
import {
  combinarAnios,
  detectarMapeo,
  extraerHoja,
  unirHojasDelPeriodo,
  type CuentaCombinada,
  type Descarte,
  type ExtraccionHoja,
} from './parseBalance'
import { extraerNotasDeHojas, type NotasDelLibro } from './parseNotas'
import type { ResultadoValidacion } from './types'

/** Lo extraído de las hojas de un período. */
export interface ExtraccionPeriodo {
  anio: number
  /** Una extracción por hoja, tal como vino. */
  hojas: ExtraccionHoja[]
  /** Todas las hojas del período unidas por cuenta. */
  union: ExtraccionHoja
  conflictos: string[]
  duplicadas: number
}

export interface ResultadoProcesamiento {
  clasificacion: Clasificacion
  actual: ExtraccionPeriodo | null
  anterior: ExtraccionPeriodo | null
  cuentas: CuentaCombinada[]
  notas: NotasDelLibro | null
  validaciones: ResultadoValidacion[]
  descartes: Descarte[]
}

const TOL = 1 // pesos: tolerancia por redondeo de centavos

const lista = (xs: string[], max = 5): string =>
  xs.slice(0, max).join('; ') + (xs.length > max ? `; y ${xs.length - max} más` : '')

const fmt = (n: number): string =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)

function extraerPeriodo(
  wb: XLSX.WorkBook,
  c: Clasificacion,
  destino: Destino,
  anio: number | null,
): ExtraccionPeriodo | null {
  if (anio === null) return null
  const hojas = hojasDe(c, destino)
    .filter((h) => h.seExtrae)
    .map((h) => detectarMapeo(abrirHoja(wb, h.nombre)))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .map((m) => extraerHoja(wb, m))
  if (hojas.length === 0) return null
  const { extraccion, conflictos, duplicadas } = unirHojasDelPeriodo(hojas)
  return { anio, hojas, union: extraccion, conflictos, duplicadas }
}

export function procesarLibro(wb: XLSX.WorkBook, clasificacion: Clasificacion): ResultadoProcesamiento {
  const v: ResultadoValidacion[] = [...clasificacion.validaciones]
  const { anioActual: yA, anioAnterior: yB } = clasificacion

  const periodoActual = extraerPeriodo(wb, clasificacion, 'actual', yA)
  const periodoAnterior = extraerPeriodo(wb, clasificacion, 'anterior', yB)

  let notas: NotasDelLibro | null = null
  const hojasNotas = hojasDe(clasificacion, 'notas').map((h) => h.nombre)
  if (hojasNotas.length && yA !== null && yB !== null) {
    notas = extraerNotasDeHojas(wb, hojasNotas, yA, yB)
  }

  const resultado: ResultadoProcesamiento = {
    clasificacion,
    actual: periodoActual,
    anterior: periodoAnterior,
    cuentas: [],
    notas,
    validaciones: v,
    descartes: [],
  }
  if (!periodoActual || !periodoAnterior) {
    validarNotas(v, notas, yA, yB)
    resultado.descartes = notas?.descartes ?? []
    return resultado
  }

  const actual = periodoActual.union
  const anterior = periodoAnterior.union
  const cuentas = combinarAnios(actual, anterior)
  resultado.cuentas = cuentas
  const deCuenta = cuentas.filter((c) => c.nivel !== 'tercero')

  // E-02 — Dos períodos, consecutivos.
  v.push({
    codigo: 'E-02',
    titulo: 'Dos períodos financieros consecutivos',
    ok: yA !== null && yB !== null && yA === yB + 1,
    bloqueante: false,
    detalle:
      yA !== null && yB !== null && yA === yB + 1
        ? `${yA} y ${yB}.`
        : `Se compararán ${yA} contra ${yB}: no son años consecutivos. Confirma que es lo que quieres.`,
  })

  // E-14 — Un período repartido en varias hojas no puede contradecirse.
  const conflictos = [...periodoActual.conflictos, ...periodoAnterior.conflictos]
  const varias = [periodoActual, periodoAnterior].filter((p) => p.hojas.length > 1)
  if (varias.length) {
    v.push({
      codigo: 'E-14',
      titulo: 'Las hojas de un mismo período no se contradicen',
      ok: conflictos.length === 0,
      bloqueante: true,
      detalle:
        conflictos.length === 0
          ? varias.map((p) => `${p.anio}: ${p.hojas.map((h) => `«${h.hoja}»`).join(' + ')}`).join(' · ') +
            (periodoActual.duplicadas + periodoAnterior.duplicadas
              ? `. ${periodoActual.duplicadas + periodoAnterior.duplicadas} cuenta(s) repetida(s) con el mismo saldo se tomaron una sola vez.`
              : '.')
          : `${conflictos.length} cuenta(s) aparecen en dos hojas del mismo período con saldos distintos: ${lista(conflictos, 3)}. Deja solo una de esas hojas.`,
    })
  }

  // E-03 — Celdas con error de fórmula (#REF!, #¿NOMBRE?, …).
  const errores = [...actual.erroresCelda, ...anterior.erroresCelda]
  v.push({
    codigo: 'E-03',
    titulo: 'Sin celdas con error de fórmula en los balances',
    ok: errores.length === 0,
    bloqueante: true,
    detalle:
      errores.length === 0
        ? 'Ninguna celda relevante trae #REF!, #¿NOMBRE? u otro error.'
        : `${errores.length} celda(s) con error: ${lista(errores)}. Suele pasar cuando el libro está ` +
          'enlazado a otro archivo. Guárdalo con los valores dentro y vuelve a cargarlo.',
  })

  // E-04 — Cuentas extraídas en ambos períodos.
  const nA = actual.filas.filter((f) => f.nivel !== 'tercero').length
  const nB = anterior.filas.filter((f) => f.nivel !== 'tercero').length
  v.push({
    codigo: 'E-04',
    titulo: 'Se extrajeron cuentas de los dos períodos',
    ok: nA > 0 && nB > 0,
    bloqueante: true,
    detalle: `${nA} cuentas de ${yA} («${actual.hoja}») y ${nB} de ${yB} («${anterior.hoja}»).`,
  })

  // E-05 — Cuentas con fila pero sin valor numérico en la columna de saldo.
  const sinValor = deCuenta
    .filter((c) => (c.filaActual !== null && c.actual === null) || (c.filaAnterior !== null && c.anterior === null))
    .map((c) => `${c.codigo} ${c.nombre}`)
  v.push({
    codigo: 'E-05',
    titulo: 'Todas las cuentas traen un saldo numérico',
    ok: sinValor.length === 0,
    bloqueante: false,
    detalle:
      sinValor.length === 0
        ? 'Cada fila de cuenta tiene un número en la columna de saldo.'
        : `${sinValor.length} cuenta(s) sin valor numérico en el saldo: ${lista(sinValor)}. Se muestran como faltantes.`,
  })

  // E-06 — Cada cuenta padre es la suma de sus hojas, en cada año.
  const hojasBajo = (codigo: string) =>
    deCuenta.filter((c) => c.esHoja && c.codigo !== codigo && c.codigo.startsWith(codigo))
  const descuadres: string[] = []
  for (const p of deCuenta.filter((c) => !c.esHoja)) {
    const hs = hojasBajo(p.codigo)
    for (const [anio, val, get] of [
      [yA, p.actual, (c: CuentaCombinada) => c.actual],
      [yB, p.anterior, (c: CuentaCombinada) => c.anterior],
    ] as const) {
      if (val === null) continue
      const suma = hs.reduce((s, c) => s + (get(c) ?? 0), 0)
      if (Math.abs(suma - val) > TOL) descuadres.push(`${p.codigo} ${p.nombre} (${anio}: ${fmt(val)} vs. ${fmt(suma)})`)
    }
  }
  v.push({
    codigo: 'E-06',
    titulo: 'Cada cuenta es la suma de sus subcuentas',
    ok: descuadres.length === 0,
    bloqueante: false,
    detalle:
      descuadres.length === 0
        ? 'La jerarquía reconstruida cuadra en los dos años.'
        : `${descuadres.length} descuadre(s): ${lista(descuadres, 4)}. Puede indicar columnas mal asignadas o una cuenta que cambió de estructura entre años.`,
  })

  // E-07 — Los terceros suman su cuenta.
  const porCuenta = new Map<string, CuentaCombinada[]>()
  for (const t of cuentas.filter((c) => c.nivel === 'tercero')) {
    porCuenta.set(t.codigo, [...(porCuenta.get(t.codigo) ?? []), t])
  }
  const terceroMal: string[] = []
  for (const [codigo, ts] of porCuenta) {
    const cuenta = deCuenta.find((c) => c.codigo === codigo)
    if (!cuenta) continue
    for (const [val, get] of [
      [cuenta.actual, (c: CuentaCombinada) => c.actual],
      [cuenta.anterior, (c: CuentaCombinada) => c.anterior],
    ] as const) {
      if (val === null) continue
      const suma = ts.reduce((s, t) => s + (get(t) ?? 0), 0)
      if (Math.abs(suma - val) > TOL) terceroMal.push(`${codigo} ${cuenta.nombre}`)
    }
  }
  const nTerceros = cuentas.length - deCuenta.length
  v.push({
    codigo: 'E-07',
    titulo: 'El detalle por tercero suma su cuenta',
    ok: terceroMal.length === 0,
    bloqueante: false,
    detalle:
      nTerceros === 0
        ? 'El archivo no trae detalle por tercero.'
        : terceroMal.length === 0
          ? `${nTerceros} filas de tercero bajo ${porCuenta.size} cuentas; todas cuadran.`
          : `${terceroMal.length} cuenta(s) cuyos terceros no suman el saldo: ${lista([...new Set(terceroMal)])}.`,
  })

  // E-08 — Cuadre contra la fila de totales que imprime cada reporte, hoja por hoja.
  const cuadreTotales: string[] = []
  const revisados: string[] = []
  for (const ext of [...periodoActual.hojas, ...periodoAnterior.hojas]) {
    if (!ext.filaTotales || ext.filaTotales.saldo === null) continue
    revisados.push(ext.hoja)
    const suma = ext.filas
      .filter((f) => f.nivel !== 'tercero' && f.padre === null)
      .reduce((s, f) => s + (f.saldo ?? 0), 0)
    if (Math.abs(suma - ext.filaTotales.saldo) > TOL) {
      cuadreTotales.push(`«${ext.hoja}»: suma ${fmt(suma)} vs. fila ${ext.filaTotales.fila} = ${fmt(ext.filaTotales.saldo)}`)
    }
  }
  v.push({
    codigo: 'E-08',
    titulo: 'Las cuentas extraídas cuadran con la fila de totales del reporte',
    ok: cuadreTotales.length === 0,
    bloqueante: false,
    detalle:
      revisados.length === 0
        ? 'Las hojas no traen fila de totales: no hay contra qué cuadrar.'
        : cuadreTotales.length === 0
          ? `Cuadra en ${revisados.map((h) => `«${h}»`).join(' y ')}: no se perdió ninguna cuenta.`
          : cuadreTotales.join('; '),
  })

  // E-09 — Continuidad: saldo inicial del año actual = saldo final del anterior.
  // Solo activo y pasivo (clases 1 y 2): patrimonio y resultados se cierran entre años.
  const continuidad = deCuenta.filter(
    (c) => /^[12]/.test(c.codigo) && c.saldoInicial !== null && c.anterior !== null,
  )
  const rotas = continuidad.filter((c) => Math.abs(c.saldoInicial! - c.anterior!) > TOL)
  v.push({
    codigo: 'E-09',
    titulo: `El saldo inicial de ${yA} coincide con el saldo final de ${yB}`,
    ok: rotas.length === 0,
    bloqueante: false,
    detalle:
      continuidad.length === 0
        ? 'La hoja del año actual no trae columna de saldo inicial: no se pudo verificar.'
        : rotas.length === 0
          ? `${continuidad.length} cuentas de activo y pasivo verificadas. Confirma que las dos hojas son años consecutivos del mismo libro.`
          : `${rotas.length} de ${continuidad.length} cuentas no coinciden: ${lista(rotas.map((c) => `${c.codigo} ${c.nombre}`))}. ` +
            'Si son muchas, revisa que las hojas elegidas sean de años consecutivos.',
  })

  validarNotas(v, notas, yA, yB)

  // E-13 — Nada se descarta en silencio.
  const descartes = [...actual.descartes, ...anterior.descartes, ...(notas?.descartes ?? [])]
  resultado.descartes = descartes
  const porMotivo = new Map<string, number>()
  for (const d of descartes) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1)
  const repetidosCod = [...actual.codigosRepetidos, ...anterior.codigosRepetidos]
  v.push({
    codigo: 'E-13',
    titulo: 'Filas no incorporadas, con su motivo',
    ok: true,
    bloqueante: false,
    detalle:
      (descartes.length === 0
        ? 'Todas las filas con contenido se incorporaron.'
        : [...porMotivo.entries()].map(([m, k]) => `${k} · ${m}`).join('. ') + '. El detalle fila por fila está abajo.') +
      (repetidosCod.length ? ` Códigos repetidos dentro de una hoja: ${lista(repetidosCod)}.` : ''),
  })

  return resultado
}

function validarNotas(
  v: ResultadoValidacion[],
  notas: NotasDelLibro | null,
  yA: number | null,
  yB: number | null,
) {
  if (!notas || yA === null || yB === null) return

  const conNotas = notas.porHoja.filter((h) => h.notas > 0)
  const sinColumnas = conNotas.filter((h) => !h.seEncontroActual || !h.seEncontroAnterior)
  v.push({
    codigo: 'E-10',
    titulo: `Las hojas de notas tienen columnas de ${yA} y de ${yB}`,
    ok: conNotas.length > 0 && sinColumnas.length === 0,
    // Las notas del archivo son referencia: el informe arma las suyas desde el balance.
    bloqueante: false,
    detalle:
      sinColumnas.length === 0
        ? conNotas
            .map(
              (h) =>
                `«${h.hoja}», fila ${h.filaAnios}: ` +
                Object.entries(h.columnasAnios).map(([a, c]) => `${a} en ${c}`).join(', '),
            )
            .join(' · ') + '.'
        : sinColumnas
            .map(
              (h) =>
                `«${h.hoja}» no tiene encabezado con ` +
                [!h.seEncontroActual && yA, !h.seEncontroAnterior && yB].filter(Boolean).join(' ni ') + '.',
            )
            .join(' '),
  })

  const vacias = notas.porHoja.filter((h) => h.notas === 0).map((h) => `«${h.hoja}»`)
  v.push({
    codigo: 'E-11',
    titulo: 'Se extrajeron las notas',
    ok: notas.notas.length > 0 && notas.erroresCelda.length === 0,
    bloqueante: false,
    detalle:
      notas.notas.length === 0
        ? `No se encontró ningún encabezado de nota en ${notas.hojas.map((h) => `«${h}»`).join(', ')}. ` +
          'Puedes continuar: las notas del informe se arman desde el balance.'
        : notas.erroresCelda.length > 0
          ? `Celdas con error en las notas: ${lista(notas.erroresCelda)}.`
          : `${notas.notas.length} notas, ${notas.notas.reduce((s, n) => s + n.lineas.length, 0)} líneas` +
            (notas.hojas.length > 1 ? `, de ${notas.hojas.length} hojas` : '') +
            (vacias.length ? `. ${vacias.join(', ')} no contiene(n) notas.` : '.'),
  })

  const conteo = new Map<string, number>()
  for (const n of notas.notas) if (n.numero) conteo.set(n.numero, (conteo.get(n.numero) ?? 0) + 1)
  const repetidas = [...conteo.entries()].filter(([, k]) => k > 1).map(([num, k]) => `${num} (${k} veces)`)
  const sinNumero = notas.notas.filter((n) => !n.numero).map((n) => n.titulo)
  const avisos: string[] = []
  if (repetidas.length) avisos.push(`Números repetidos: ${repetidas.join(', ')}`)
  if (sinNumero.length) avisos.push(`Notas sin número: ${lista(sinNumero, 3)}`)
  if (notas.lineasSinEtiqueta) avisos.push(`${notas.lineasSinEtiqueta} línea(s) con valores pero sin descripción`)
  v.push({
    codigo: 'E-12',
    titulo: 'Numeración y descripciones de las notas',
    ok: avisos.length === 0,
    bloqueante: false,
    detalle: avisos.length === 0 ? 'Cada nota tiene un número único.' : `${avisos.join('. ')}. Se conservan tal como vienen en el archivo.`,
  })
}

export const hayBloqueantesExtraccion = (r: ResultadoProcesamiento | null): boolean =>
  !r || r.validaciones.some((x) => x.bloqueante && !x.ok)

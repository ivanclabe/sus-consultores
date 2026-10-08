/**
 * Primera etapa del procesamiento: clasificar TODAS las hojas del libro antes
 * de extraer una sola cuenta.
 *
 *   leer hojas → tipo de cada hoja → períodos → año actual / año anterior / notas
 *
 * Cada hoja termina en exactamente un destino, así que ninguna puede quedar en
 * dos períodos a la vez. Lo que no se puede decidir con certeza va a "revisión"
 * y bloquea el avance hasta que el usuario lo resuelva: nada se asigna en silencio.
 *
 * Ningún año está fijo en el código. El período de cada hoja se lee de su
 * contenido (títulos como "DIC/31/2025", encabezados como "31 de diciembre de
 * 2025") y del nombre. El año actual es el balance de comprobación más reciente;
 * el anterior, el inmediatamente previo.
 */
import type * as XLSX from 'xlsx'
import {
  abrirHoja,
  aniosEnTexto,
  anioDeCelda,
  celda,
  encabezadoNotaDeFila,
  normalizar,
  numeroDeCelda,
  texto,
  type Hoja,
} from './excel'
import { detectarMapeo, type MapeoColumnas } from './parseBalance'
import type { ResultadoValidacion } from './types'

/**
 * balance = balance de comprobación (estructura de cuentas con saldo): es lo que se extrae.
 * estado  = estado financiero ya armado (situación financiera, resultados, flujos…).
 */
export type TipoHoja = 'balance' | 'estado' | 'notas' | 'otra' | 'vacia'

export const NOMBRE_TIPO: Record<TipoHoja, string> = {
  balance: 'Balance de comprobación',
  estado: 'Estado financiero',
  notas: 'Notas',
  otra: 'Otra información',
  vacia: 'Hoja vacía',
}

export interface PerfilHoja {
  nombre: string
  tipo: TipoHoja
  /** Todos los períodos que menciona la hoja. */
  anios: number[]
  /** El período de la hoja cuando es uno solo; null si no hay o hay varios. */
  anio: number | null
  anioEnNombre: number | null
  evidencia: string
  mapeo: MapeoColumnas | null
  encabezadosNota: number
  titulos: string[]
  encabezados: string[]
  /** Muestra de etiquetas de texto del cuerpo (sin números), para la IA. */
  etiquetas: string[]
  filas: number
}

export type Destino = 'actual' | 'anterior' | 'notas' | 'ignorada' | 'revision'

export interface HojaClasificada {
  nombre: string
  tipo: TipoHoja
  anio: number | null
  anios: number[]
  destino: Destino
  motivo: string
  manual: boolean
  /** true = sus datos alimentan la extracción; false = solo se muestra. */
  seExtrae: boolean
}

export type MetodoClasificacion = 'automatico' | 'ia' | 'manual'

export interface Clasificacion {
  anioActual: number | null
  anioAnterior: number | null
  /** Períodos que tienen balance de comprobación: los elegibles. */
  aniosDisponibles: number[]
  hojas: HojaClasificada[]
  metodo: MetodoClasificacion
  razon: string | null
  validaciones: ResultadoValidacion[]
  avisos: string[]
}

// Líneas que traen fechas que NO son el período del documento.
const FECHA_AJENA = /(procesad|impres|generad|elaborad|emitid|fecha de (impresion|generacion))/

const ESTADO = /(estado de situaci[oó]n|situaci[oó]n financiera|balance general|estado de resultado|estado de flujo|flujos? de efectivo|cambios en el patrimonio|estado de cambios)/i

function anioDelNombre(nombre: string): number | null {
  const cuatro = aniosEnTexto(nombre)
  if (cuatro.length === 1) return cuatro[0]
  // "BALANCE25", "BALANCE 24": dos dígitos al final, precedidos de letras.
  const dos = nombre.match(/[a-z]\s*(\d{2})\s*$/i)
  return dos ? 2000 + Number(dos[1]) : null
}

function textosDeFila(h: Hoja, r: number): string[] {
  const out: string[] = []
  for (let c = 0; c <= h.ultimaColumna; c++) {
    const cel = celda(h, r, c)
    if (cel?.t === 's') {
      const t = texto(cel)
      if (t) out.push(t)
    }
  }
  return out
}

/**
 * Años que la hoja declara en su cabecera, por frecuencia. Lee títulos y filas
 * de encabezado; ignora "Procesado en…". Un número suelto solo cuenta como año
 * si la fila tiene al menos dos (un encabezado de columnas por año).
 */
function aniosDeCabecera(h: Hoja, hasta: number): number[] {
  const conteo = new Map<number, number>()
  const sumar = (a: number) => conteo.set(a, (conteo.get(a) ?? 0) + 1)
  for (let r = 0; r < hasta; r++) {
    const enteros: number[] = []
    let otrosNumeros = 0
    for (let c = 0; c <= h.ultimaColumna; c++) {
      const cel = celda(h, r, c)
      if (!cel) continue
      if (cel.t === 's') {
        const t = texto(cel)
        if (FECHA_AJENA.test(normalizar(t))) continue
        aniosEnTexto(t).forEach(sumar)
      } else if (cel.t === 'n') {
        const fecha = anioDeCelda(cel, false)
        if (fecha) sumar(fecha)
        else if (anioDeCelda(cel, true)) enteros.push(cel.v as number)
        else otrosNumeros++
      }
    }
    if (enteros.length >= 2 && otrosNumeros === 0) enteros.forEach(sumar)
  }
  return [...conteo.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([a]) => a)
}

export function analizarLibro(wb: XLSX.WorkBook): PerfilHoja[] {
  return wb.SheetNames.map((nombre) => {
    const h = abrirHoja(wb, nombre)
    const mapeo = h.ultimaFila >= 0 ? detectarMapeo(h) : null
    const anioEnNombre = anioDelNombre(nombre)

    let encabezadosNota = 0
    let numeros = 0
    for (let r = 0; r <= h.ultimaFila; r++) {
      if (encabezadoNotaDeFila(h, r)) encabezadosNota++
      if (numeros < 5) {
        for (let c = 0; c <= h.ultimaColumna && numeros < 5; c++) {
          if (numeroDeCelda(celda(h, r, c)) !== null) numeros++
        }
      }
    }

    const hastaCabecera = mapeo ? mapeo.filaEncabezado + 1 : Math.min(h.ultimaFila + 1, 15)
    const titulos: string[] = []
    for (let r = 0; r < Math.min(hastaCabecera, 12); r++) {
      const t = textosDeFila(h, r).join(' · ')
      if (t) titulos.push(t.slice(0, 160))
    }
    const encabezados = mapeo ? textosDeFila(h, mapeo.filaEncabezado).slice(0, 20) : []
    const etiquetas: string[] = []
    for (let r = hastaCabecera; r <= h.ultimaFila && etiquetas.length < 12; r++) {
      const t = textosDeFila(h, r)[0]
      if (t && /[a-záéíóúñ]{3,}/i.test(t)) etiquetas.push(t.slice(0, 60))
    }

    let tipo: TipoHoja
    if (h.ultimaFila < 0 || (titulos.length === 0 && numeros === 0)) tipo = 'vacia'
    else if (mapeo) tipo = 'balance'
    else if (/nota/i.test(nombre) || encabezadosNota >= 2) tipo = 'notas'
    else if (titulos.some((t) => ESTADO.test(t)) || ESTADO.test(nombre)) tipo = 'estado'
    else tipo = 'otra'

    // Período: primero el contenido, después el nombre.
    const deCabecera = tipo === 'vacia' ? [] : aniosDeCabecera(h, hastaCabecera)
    let anios: number[]
    let evidencia: string
    if (tipo === 'balance') {
      // Un balance de comprobación es de un solo período: gana el más mencionado.
      const anio = deCabecera[0] ?? anioEnNombre
      anios = anio ? [anio] : []
      evidencia = deCabecera.length
        ? `Año ${anio} en el título` +
          (anioEnNombre && anioEnNombre !== anio ? `; el nombre sugiere ${anioEnNombre}` : anioEnNombre ? ' y en el nombre' : '')
        : anioEnNombre
          ? `Año ${anio} tomado del nombre (el título no trae fecha)`
          : 'No se encontró el año en el título ni en el nombre'
    } else {
      anios = deCabecera.length ? [...deCabecera].sort((a, b) => b - a) : anioEnNombre ? [anioEnNombre] : []
      evidencia =
        tipo === 'notas'
          ? `${encabezadosNota} encabezados de nota`
          : anios.length > 1
            ? `Menciona ${anios.join(', ')}`
            : anios.length === 1
              ? `Año ${anios[0]} en ${deCabecera.length ? 'el título' : 'el nombre'}`
              : tipo === 'vacia'
                ? 'Sin contenido'
                : 'No menciona ningún período'
      if (tipo === 'estado' || tipo === 'otra') {
        const t = titulos.find((x) => ESTADO.test(x)) ?? titulos[0]
        if (t) evidencia = `«${t.slice(0, 60)}» · ${evidencia}`
      }
    }

    return {
      nombre,
      tipo,
      anios,
      anio: anios.length === 1 ? anios[0] : null,
      anioEnNombre,
      evidencia,
      mapeo,
      encabezadosNota,
      titulos,
      encabezados,
      etiquetas,
      filas: h.ultimaFila + 1,
    }
  })
}

// ---------------------------------------------------------------------------
// Agrupación en los tres destinos
// ---------------------------------------------------------------------------

export interface OpcionesClasificacion {
  anioActual?: number | null
  anioAnterior?: number | null
  /** Asignaciones hechas a mano por el usuario: mandan sobre las automáticas. */
  destinos?: Record<string, Destino>
  metodo?: MetodoClasificacion
  razon?: string | null
}

const lista = (xs: string[]): string => xs.map((x) => `«${x}»`).join(', ')

function destinoAutomatico(
  p: PerfilHoja,
  actual: number | null,
  anterior: number | null,
): { destino: Destino; motivo: string } {
  const fuera = (a: number) =>
    `Es de ${a}, fuera de los períodos del informe` +
    (actual && anterior ? ` (${actual} y ${anterior})` : '') + '.'

  switch (p.tipo) {
    case 'vacia':
      return { destino: 'ignorada', motivo: 'Hoja vacía.' }
    case 'notas':
      return { destino: 'notas', motivo: `Notas a los estados financieros (${p.encabezadosNota} encabezados de nota).` }
    case 'balance':
      if (p.anio === null) {
        return {
          destino: 'revision',
          motivo: `No fue posible determinar a qué período pertenece la hoja «${p.nombre}»: ni su título ni su nombre indican el año.`,
        }
      }
      if (p.anio === actual) return { destino: 'actual', motivo: `Balance de comprobación de ${p.anio}.` }
      if (p.anio === anterior) return { destino: 'anterior', motivo: `Balance de comprobación de ${p.anio}.` }
      return { destino: 'ignorada', motivo: `Balance de comprobación. ${fuera(p.anio)}` }
    case 'estado':
    case 'otra': {
      const que = p.tipo === 'estado' ? 'Estado financiero ya armado' : 'Información complementaria'
      if (p.anios.length > 1) {
        return {
          destino: 'ignorada',
          motivo: `${que}, comparativo de varios períodos (${p.anios.join(', ')}): no pertenece a uno solo.`,
        }
      }
      if (p.anio !== null) {
        if (p.anio === actual || p.anio === anterior) {
          return {
            destino: p.anio === actual ? 'actual' : 'anterior',
            motivo: `${que} de ${p.anio}. Se muestra como referencia; la extracción usa el balance de comprobación.`,
          }
        }
        return { destino: 'ignorada', motivo: `${que}. ${fuera(p.anio)}` }
      }
      return p.tipo === 'estado'
        ? {
            destino: 'revision',
            motivo: `No fue posible determinar a qué período pertenece la hoja «${p.nombre}». Revisa su estructura o asígnala a mano.`,
          }
        : { destino: 'ignorada', motivo: 'No contiene balance, estados financieros ni notas, ni menciona un período.' }
    }
  }
}

export function clasificarLibro(perfiles: PerfilHoja[], o: OpcionesClasificacion = {}): Clasificacion {
  const aniosDisponibles = [
    ...new Set(perfiles.filter((p) => p.tipo === 'balance' && p.anio !== null).map((p) => p.anio!)),
  ].sort((a, b) => b - a)

  const anioActual = o.anioActual !== undefined ? o.anioActual : (aniosDisponibles[0] ?? null)
  const anioAnterior =
    o.anioAnterior !== undefined
      ? o.anioAnterior
      : anioActual !== null && aniosDisponibles.includes(anioActual - 1)
        ? anioActual - 1
        : null

  const hojas: HojaClasificada[] = perfiles.map((p) => {
    const manual = o.destinos?.[p.nombre]
    const auto = destinoAutomatico(p, anioActual, anioAnterior)
    const destino = manual ?? auto.destino
    return {
      nombre: p.nombre,
      tipo: p.tipo,
      anio: p.anio,
      anios: p.anios,
      destino,
      motivo: manual ? 'Asignada a mano.' : auto.motivo,
      manual: Boolean(manual),
      seExtrae:
        (destino === 'actual' || destino === 'anterior') ? p.tipo === 'balance' : destino === 'notas',
    }
  })

  // Dos balances automáticos en el mismo período: ¿se complementan o son versiones
  // distintas? No se adivina: el usuario lo decide.
  for (const periodo of ['actual', 'anterior'] as const) {
    const auto = hojas.filter((h) => h.destino === periodo && h.tipo === 'balance' && !h.manual)
    if (auto.length > 1) {
      const anio = periodo === 'actual' ? anioActual : anioAnterior
      for (const h of auto) {
        h.destino = 'revision'
        h.seExtrae = false
        h.motivo =
          `Hay ${auto.length} balances de comprobación de ${anio} (${lista(auto.map((x) => x.nombre))}). ` +
          'Si se complementan, asígnalos todos a ese período; si son versiones distintas, deja solo una.'
      }
    }
  }

  const validaciones = validarClasificacion(hojas, perfiles, anioActual, anioAnterior, aniosDisponibles)
  const avisos: string[] = []
  if (anioActual !== null && anioAnterior !== null && anioAnterior !== anioActual - 1 && anioAnterior < anioActual) {
    avisos.push(`Se comparará ${anioActual} contra ${anioAnterior}: no son años consecutivos.`)
  }
  const manuales = hojas.filter((h) => h.manual).length
  if (manuales) avisos.push(`${manuales} hoja(s) asignada(s) a mano.`)

  return {
    anioActual,
    anioAnterior,
    aniosDisponibles,
    hojas,
    metodo: o.metodo ?? (manuales ? 'manual' : 'automatico'),
    razon: o.razon ?? null,
    validaciones,
    avisos,
  }
}

function validarClasificacion(
  hojas: HojaClasificada[],
  perfiles: PerfilHoja[],
  anioActual: number | null,
  anioAnterior: number | null,
  disponibles: number[],
): ResultadoValidacion[] {
  const v: ResultadoValidacion[] = []
  const de = (d: Destino) => hojas.filter((h) => h.destino === d)
  const nombresBalances = perfiles.filter((p) => p.tipo === 'balance').map((p) => p.nombre)

  v.push({
    codigo: 'C-01',
    titulo: 'Se identificó el período actual',
    ok: anioActual !== null,
    bloqueante: true,
    detalle:
      anioActual !== null
        ? `${anioActual}: el balance de comprobación más reciente del libro.`
        : nombresBalances.length
          ? `Hay balances de comprobación (${lista(nombresBalances)}) pero en ninguno se pudo leer el año.`
          : 'No se encontró ninguna hoja con estructura de balance de comprobación (columnas GRUPO / CUENTA / SUBCUENTA… y una columna de saldo).',
  })

  v.push({
    codigo: 'C-02',
    titulo: 'Se identificó el período anterior',
    ok: anioAnterior !== null,
    bloqueante: true,
    detalle:
      anioAnterior !== null
        ? `${anioAnterior}.`
        : anioActual !== null
          ? `No se encontró el balance de comprobación de ${anioActual - 1}, anterior a ${anioActual}.` +
            (disponibles.filter((a) => a < anioActual).length
              ? ` Hay balances de ${disponibles.filter((a) => a < anioActual).join(', ')}: puedes elegir uno como período anterior.`
              : '')
          : 'Primero debe identificarse el período actual.',
  })

  const distintos = anioActual !== null && anioAnterior !== null && anioAnterior < anioActual
  v.push({
    codigo: 'C-03',
    titulo: 'Los dos períodos son diferentes',
    ok: distintos,
    bloqueante: true,
    detalle: distintos
      ? `${anioActual} y ${anioAnterior}.`
      : anioActual !== null && anioAnterior !== null
        ? `El período anterior (${anioAnterior}) debe ser anterior al actual (${anioActual}).`
        : 'Faltan períodos por identificar.',
  })

  const periodos = (['actual', 'anterior'] as const).filter(
    (d) => (d === 'actual' ? anioActual : anioAnterior) !== null,
  )
  const sinBalance = periodos.filter((d) => !de(d).some((h) => h.tipo === 'balance'))
  const balancesDe = (d: Destino) => lista(de(d).filter((h) => h.tipo === 'balance').map((h) => h.nombre))
  v.push({
    codigo: 'C-04',
    titulo: 'Cada período tiene su balance de comprobación',
    ok: periodos.length === 2 && sinBalance.length === 0,
    bloqueante: true,
    detalle:
      periodos.length < 2
        ? 'Pendiente: faltan períodos por identificar (C-01, C-02).'
        : sinBalance.length === 0
          ? `${anioActual}: ${balancesDe('actual')} · ${anioAnterior}: ${balancesDe('anterior')}.`
          : sinBalance
              .map((d) => {
                const anio = d === 'actual' ? anioActual : anioAnterior
                const otras = de(d)
                return otras.length
                  ? `El período ${anio} solo tiene ${lista(otras.map((h) => h.nombre))}, que no son balances de comprobación: de ahí no se pueden extraer cuentas.`
                  : `El período ${anio} no tiene ningún balance de comprobación asignado.`
              })
              .join(' '),
  })

  // Las notas son opcionales: si el libro no las trae, se arman desde el balance.
  v.push({
    codigo: 'C-05',
    titulo: 'Hojas de notas (opcional)',
    ok: true,
    bloqueante: false,
    detalle: de('notas').length
      ? lista(de('notas').map((h) => h.nombre)) + '.'
      : 'El libro no trae hoja de notas. No es necesaria: las notas del informe se arman desde el balance de comprobación.',
  })

  const revision = de('revision')
  v.push({
    codigo: 'C-06',
    titulo: 'Ninguna hoja pendiente de revisión',
    ok: revision.length === 0,
    bloqueante: true,
    detalle: revision.length === 0 ? 'Todas las hojas quedaron clasificadas.' : revision.map((h) => h.motivo).join(' '),
  })

  const incompatibles: string[] = []
  for (const h of hojas) {
    if (h.destino === 'actual' || h.destino === 'anterior') {
      const periodo = h.destino === 'actual' ? anioActual : anioAnterior
      if (h.anios.length > 1) {
        incompatibles.push(`«${h.nombre}» abarca varios períodos (${h.anios.join(', ')}) y está en ${periodo}.`)
      } else if (h.anio !== null && periodo !== null && h.anio !== periodo) {
        incompatibles.push(`«${h.nombre}» es de ${h.anio} y está asignada a ${periodo}.`)
      }
      if (h.tipo === 'notas') incompatibles.push(`«${h.nombre}» es una hoja de notas y está asignada a ${periodo}.`)
    }
    if (h.destino === 'notas' && h.tipo === 'balance') {
      incompatibles.push(`«${h.nombre}» es un balance de comprobación y está asignada a Notas.`)
    }
  }
  v.push({
    codigo: 'C-07',
    titulo: 'Ninguna hoja asignada a un período que no le corresponde',
    ok: incompatibles.length === 0,
    bloqueante: true,
    detalle: incompatibles.length === 0 ? 'Cada hoja está en el período que declara.' : incompatibles.join(' '),
  })

  return v
}

export const hojasDe = (c: Clasificacion, destino: Destino): HojaClasificada[] =>
  c.hojas.filter((h) => h.destino === destino)

export const clasificacionBloqueada = (c: Clasificacion): boolean =>
  c.validaciones.some((v) => v.bloqueante && !v.ok)

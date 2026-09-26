/**
 * Mapeo de cada cuenta a un rubro del formato institucional.
 *
 * Orden de resolución, de mayor a menor autoridad:
 *   1. memoria  — el contador ya decidió esta cuenta en esta empresa.
 *   2. regla    — prefijo del código PUC (determinístico, gana el más largo).
 *   3. ia       — solo lo que sobra llega al modelo.
 *   4. sin_clasificar — se le muestra al contador; nunca se descarta en silencio.
 */
import { llamarFuncion } from './funciones'
import type {
  Cuenta,
  EstadoClasificacion,
  OrigenClasificacion,
  ReglaMapeo,
  Rubro,
} from './types'

/** Por debajo de esto, la propuesta se marca para revisión prioritaria. */
export const UMBRAL_REVISION = 0.8

export interface Propuesta {
  cuenta_id: string
  rubro_codigo: string | null
  confianza: number | null
  origen: OrigenClasificacion
  estado: EstadoClasificacion
  razon: string | null
}

export interface MapeoMemoria {
  codigo: string
  nombre_norm: string
  rubro_codigo: string
}

export const normalizarNombre = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

function porRegla(codigo: string, reglas: ReglaMapeo[]): ReglaMapeo | null {
  let mejor: ReglaMapeo | null = null
  for (const r of reglas) {
    if (!r.activo) continue
    if (!codigo.startsWith(r.prefijo)) continue
    if (
      !mejor ||
      r.prefijo.length > mejor.prefijo.length ||
      (r.prefijo.length === mejor.prefijo.length && r.prioridad > mejor.prioridad)
    ) {
      mejor = r
    }
  }
  return mejor
}

async function clasificarConIA(
  cuentas: Cuenta[],
  rubros: Rubro[],
): Promise<Map<string, { rubro_codigo: string | null; confianza: number; razon: string }>> {
  const salida = new Map<string, { rubro_codigo: string | null; confianza: number; razon: string }>()
  if (cuentas.length === 0) return salida

  type Respuesta = { resultados: { id: string; rubro_codigo: string | null; confianza: number; razon: string }[] }
  const data = await llamarFuncion<Respuesta>('sc-clasificar-cuentas', {
    // Deliberadamente sin saldos: el modelo no ve importes.
    cuentas: cuentas.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre })),
    rubros: rubros.map((r) => ({
      codigo: r.codigo,
      nombre: r.nombre,
      estado: r.estado,
      seccion: r.seccion,
    })),
  })

  for (const r of data?.resultados ?? []) salida.set(r.id, r)
  return salida
}

export async function clasificar(opciones: {
  cuentas: Cuenta[]
  rubros: Rubro[]
  reglas: ReglaMapeo[]
  memoria: MapeoMemoria[]
  usarIA: boolean
}): Promise<{ propuestas: Propuesta[]; consultadasIA: number }> {
  const { cuentas, rubros, reglas, memoria, usarIA } = opciones
  const validos = new Set(rubros.filter((r) => r.activo).map((r) => r.codigo))
  const porMemoria = new Map(
    memoria
      .filter((m) => validos.has(m.rubro_codigo))
      .map((m) => [`${m.codigo}|${m.nombre_norm}`, m.rubro_codigo]),
  )

  const propuestas: Propuesta[] = []
  const pendientes: Cuenta[] = []

  for (const c of cuentas) {
    const recordado = porMemoria.get(`${c.codigo}|${normalizarNombre(c.nombre)}`)
    if (recordado) {
      propuestas.push({
        cuenta_id: c.id,
        rubro_codigo: recordado,
        confianza: 1,
        origen: 'memoria',
        estado: 'confirmada',
        razon: 'Confirmada antes por el contador para esta empresa.',
      })
      continue
    }

    const regla = porRegla(c.codigo, reglas)
    if (regla && validos.has(regla.rubro_codigo)) {
      propuestas.push({
        cuenta_id: c.id,
        rubro_codigo: regla.rubro_codigo,
        confianza: 1,
        origen: 'regla',
        estado: 'propuesta',
        razon: `Código ${c.codigo} bajo el prefijo ${regla.prefijo}.`,
      })
      continue
    }

    pendientes.push(c)
  }

  let consultadasIA = 0
  if (pendientes.length > 0 && usarIA) {
    const resultados = await clasificarConIA(pendientes, rubros)
    consultadasIA = pendientes.length
    for (const c of pendientes) {
      const r = resultados.get(c.id)
      propuestas.push({
        cuenta_id: c.id,
        rubro_codigo: r?.rubro_codigo ?? null,
        confianza: r?.confianza ?? 0,
        origen: 'ia',
        estado: r?.rubro_codigo ? 'propuesta' : 'sin_clasificar',
        razon: r?.razon ?? 'Sin correspondencia en el catálogo.',
      })
    }
  } else {
    for (const c of pendientes) {
      propuestas.push({
        cuenta_id: c.id,
        rubro_codigo: null,
        confianza: 0,
        origen: 'regla',
        estado: 'sin_clasificar',
        razon: 'Ninguna regla del catálogo cubre este código.',
      })
    }
  }

  return { propuestas, consultadasIA }
}

export const requiereRevision = (p: {
  origen: OrigenClasificacion
  confianza: number | null
  estado: EstadoClasificacion
}): boolean =>
  p.estado === 'sin_clasificar' ||
  (p.origen === 'ia' && (p.confianza ?? 0) < UMBRAL_REVISION)

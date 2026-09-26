/**
 * Segunda opinión del modelo sobre la clasificación de las hojas. Solo se pide
 * cuando las reglas dejan algo sin resolver.
 *
 * El modelo recibe texto (nombres, títulos, encabezados, etiquetas), nunca
 * saldos, y propone tipo y período por hoja. El código acepta únicamente lo que
 * puede verificar:
 *  - un período, solo para hojas en las que el código no encontró ninguno;
 *  - un tipo, nunca "balance" para una hoja sin estructura de cuentas (no habría
 *    de dónde extraer) ni otro tipo para una hoja que sí la tiene.
 * Lo demás queda como discrepancia visible.
 */
import { llamarFuncion } from './funciones'
import type { PerfilHoja, TipoHoja } from './clasificarHojas'

interface RespuestaHoja {
  nombre: string
  clasificacion: 'balance' | 'estado' | 'notas' | 'otra'
  periodo: number | null
}

interface Respuesta {
  resultado: {
    hojas?: RespuestaHoja[]
    anio_actual?: number | null
    anio_anterior?: number | null
    razon?: string
  }
}

export interface PropuestaIA {
  perfiles: PerfilHoja[]
  anioActual: number | null
  anioAnterior: number | null
  razon: string | null
  discrepancias: string[]
}

const anioValido = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1950 && n <= 2099

export async function clasificarConIA(perfiles: PerfilHoja[]): Promise<PropuestaIA> {
  const { resultado: r } = await llamarFuncion<Respuesta>('sc-identificar-hojas', {
    hojas: perfiles.map((p) => ({
      nombre: p.nombre,
      tipo_detectado: p.tipo,
      anios_detectados: p.anios,
      anio_en_nombre: p.anioEnNombre,
      filas: p.filas,
      titulos: p.titulos,
      encabezados: p.encabezados,
      etiquetas: p.etiquetas,
      encabezados_nota: p.encabezadosNota,
    })),
  })

  const porNombre = new Map((r.hojas ?? []).map((h) => [h.nombre, h]))
  const discrepancias: string[] = []

  const ajustados = perfiles.map((p): PerfilHoja => {
    const ia = porNombre.get(p.nombre)
    if (!ia) return p
    let { tipo, anios, evidencia } = p

    if (ia.clasificacion === 'balance' && p.tipo !== 'balance') {
      discrepancias.push(
        `La IA considera «${p.nombre}» un balance de comprobación, pero no tiene la estructura de ` +
          'columnas de niveles y saldo que la app necesita para extraer cuentas.',
      )
    } else if (p.tipo !== 'balance' && ia.clasificacion !== p.tipo) {
      tipo = ia.clasificacion as TipoHoja
      evidencia = `${evidencia} · tipo sugerido por la IA`
    }

    if (anioValido(ia.periodo)) {
      if (p.anios.length === 0) {
        anios = [ia.periodo]
        evidencia = `${evidencia} · período ${ia.periodo} sugerido por la IA`
      } else if (p.anio !== null && p.anio !== ia.periodo) {
        discrepancias.push(
          `Para «${p.nombre}» la IA sugiere ${ia.periodo}, pero la hoja declara ${p.anio}: se mantiene ${p.anio}.`,
        )
      }
    }
    return { ...p, tipo, anios, anio: anios.length === 1 ? anios[0] : null, evidencia }
  })

  const disponibles = new Set(ajustados.filter((p) => p.tipo === 'balance' && p.anio !== null).map((p) => p.anio!))
  return {
    perfiles: ajustados,
    anioActual: anioValido(r.anio_actual) && disponibles.has(r.anio_actual) ? r.anio_actual : null,
    anioAnterior: anioValido(r.anio_anterior) && disponibles.has(r.anio_anterior) ? r.anio_anterior : null,
    razon: typeof r.razon === 'string' ? r.razon : null,
    discrepancias,
  }
}

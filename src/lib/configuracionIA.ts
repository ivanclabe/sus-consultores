/**
 * Configuración de la IA desde la app.
 *
 * La llave se ESCRIBE con una función de la base que la guarda cifrada en Vault;
 * nunca se lee de vuelta. De ella solo se conocen sus últimos 4 caracteres.
 */
import { llamarFuncion } from './funciones'
import { supabase } from './supabase'

export interface ConfiguracionIA {
  modelo: string
  clave_final: string | null
  clave_actualizada_at: string | null
  clave_actualizada_por: string | null
  updated_at: string
}

export interface ResultadoPrueba {
  ok: boolean
  fuente: 'app' | 'secreto' | 'ninguna'
  modelo: string
  mensaje: string
  latencia_ms?: number
}

export const MODELOS: { id: string; nombre: string; descripcion: string }[] = [
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', descripcion: 'Equilibrio entre precisión, velocidad y costo. Recomendado.' },
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', descripcion: 'Máxima precisión en catálogos difíciles. Más lento y costoso.' },
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', descripcion: 'El más rápido y económico. Bueno si las reglas cubren casi todo.' },
  { id: 'claude-fable-5-1', nombre: 'Claude Fable 5.1', descripcion: 'Modelo más reciente de la familia.' },
  { id: 'claude-sonnet-5', nombre: 'Claude Sonnet 5', descripcion: 'El modelo con el que se construyó la app.' },
]

export const MODELO_VALIDO = /^claude-[a-z0-9][a-z0-9.-]{2,60}$/
export const CLAVE_VALIDA = /^sk-ant-[A-Za-z0-9_-]{20,}$/

/** null cuando la base todavía no tiene la migración de configuración. */
export async function leerConfiguracion(): Promise<ConfiguracionIA | null> {
  const { data, error } = await supabase
    .from('sc_configuracion')
    .select('modelo, clave_final, clave_actualizada_at, clave_actualizada_por, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) return null
  return data as ConfiguracionIA | null
}

export async function esAdministrador(): Promise<boolean> {
  const { data, error } = await supabase.rpc('sc_es_administrador')
  return !error && data === true
}

async function rpc(nombre: string, args: Record<string, unknown> = {}) {
  const { error } = await supabase.rpc(nombre, args)
  if (error) throw new Error(error.message)
}

export const guardarClave = (clave: string) => rpc('sc_guardar_clave_ia', { p_clave: clave.trim() })
export const borrarClave = () => rpc('sc_borrar_clave_ia')
export const guardarModelo = (modelo: string) => rpc('sc_guardar_modelo_ia', { p_modelo: modelo.trim() })
export const probarConexion = (modelo?: string) =>
  llamarFuncion<ResultadoPrueba>('sc-probar-ia', modelo ? { modelo } : {})

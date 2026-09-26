/**
 * Llamadas a las Edge Functions que hablan con Claude. Viajan con la sesión
 * del usuario, y la llave de Anthropic vive en Supabase, nunca en el navegador.
 */
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export async function llamarFuncion<T>(nombre: string, cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body: cuerpo })
  if (error) {
    // Las funciones devuelven { error } con un mensaje útil ("falta ANTHROPIC_API_KEY", …).
    let mensaje = error.message
    if (error instanceof FunctionsHttpError) {
      try {
        const cuerpoError = await error.context.json()
        if (cuerpoError?.error) mensaje = String(cuerpoError.error)
      } catch {
        // sin cuerpo JSON: se queda el mensaje genérico
      }
    }
    throw new Error(mensaje)
  }
  if (data?.error) throw new Error(String(data.error))
  return data as T
}

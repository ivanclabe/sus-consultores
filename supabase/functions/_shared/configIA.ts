// Configuración de la IA para las Edge Functions.
//
// Orden de prioridad de la llave:
//   1. La configurada desde la app (Vault, secreto sc_anthropic_api_key).
//   2. El secreto ANTHROPIC_API_KEY de las Edge Functions (respaldo).
// El modelo sale de public.sc_configuracion; si no existe, se usa el de siempre.
//
// La lectura usa la llave de servicio: la función sc_config_ia_servidor() no es
// ejecutable por usuarios de la app, así que la llave nunca llega al navegador.

export const MODELO_POR_DEFECTO = "claude-sonnet-5";

export type FuenteClave = "app" | "secreto" | "ninguna";

export interface ConfigIA {
  apiKey: string | null;
  modelo: string;
  fuente: FuenteClave;
}

export async function obtenerConfigIA(): Promise<ConfigIA> {
  const url = Deno.env.get("SUPABASE_URL");
  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let modelo = MODELO_POR_DEFECTO;
  let clave: string | null = null;

  if (url && servicio) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/sc_config_ia_servidor`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: servicio,
          authorization: `Bearer ${servicio}`,
        },
        body: "{}",
      });
      if (res.ok) {
        const filas = (await res.json()) as { modelo: string | null; clave: string | null }[];
        if (filas[0]?.modelo) modelo = filas[0].modelo;
        if (filas[0]?.clave) clave = filas[0].clave;
      }
    } catch {
      // Sin la migración de configuración: se sigue con el secreto y el modelo por defecto.
    }
  }

  if (clave) return { apiKey: clave, modelo, fuente: "app" };
  const secreto = Deno.env.get("ANTHROPIC_API_KEY");
  if (secreto) return { apiKey: secreto, modelo, fuente: "secreto" };
  return { apiKey: null, modelo, fuente: "ninguna" };
}

export const MENSAJE_SIN_CLAVE =
  "La IA no está configurada: un administrador debe registrar la llave de Anthropic en Configuración " +
  "(o definir el secreto ANTHROPIC_API_KEY en Supabase > Edge Functions > Secrets).";

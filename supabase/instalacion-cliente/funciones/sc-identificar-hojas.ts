// sc-identificar-hojas — versión de un solo archivo para el editor del panel de Supabase.
// Generada por supabase/instalacion-cliente/generar.sh: no editar a mano.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ---- configuración compartida (functions/_shared/configIA.ts) ----
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
// ---- fin de la configuración compartida ----

// SusConsultores — clasificación de las hojas del libro con el modelo.
//
// Solo se llama cuando las reglas determinísticas dejaron algo sin resolver.
// Recibe, por hoja, texto (nombre, títulos, encabezados, etiquetas) y lo que
// el análisis automático ya detectó; nunca saldos. Devuelve, por hoja, su tipo
// y su período. La app acepta solo lo que puede verificar y el usuario revisa.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Hoja = {
  nombre: string;
  tipo_detectado: string;
  anios_detectados: number[];
  anio_en_nombre: number | null;
  filas: number;
  titulos: string[];
  encabezados: string[];
  etiquetas: string[];
  encabezados_nota: number;
};

const HERRAMIENTA = {
  name: "registrar_clasificacion",
  description: "Registra el tipo y el período de cada hoja del libro.",
  input_schema: {
    type: "object",
    properties: {
      hojas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre exacto de la hoja, tal cual se recibió." },
            clasificacion: {
              type: "string",
              enum: ["balance", "estado", "notas", "otra"],
              description:
                "balance = balance de comprobación / de prueba (cuentas con saldo). " +
                "estado = estado financiero ya armado (situación financiera, resultados, flujos, patrimonio). " +
                "notas = notas a los estados financieros. otra = cualquier otra cosa.",
            },
            periodo: {
              type: ["integer", "null"],
              description: "Año al que pertenece la hoja. null si abarca varios años o no se puede saber.",
            },
          },
          required: ["nombre", "clasificacion", "periodo"],
        },
      },
      anio_actual: { type: ["integer", "null"], description: "Año del balance de comprobación más reciente." },
      anio_anterior: { type: ["integer", "null"], description: "Año inmediatamente anterior con balance de comprobación." },
      razon: { type: "string", description: "Máximo 50 palabras: en qué te basaste y qué dudas quedan." },
    },
    required: ["hojas", "anio_actual", "anio_anterior", "razon"],
  },
} as const;

const SISTEMA = [
  "Ayudas a un contador colombiano a preparar el informe de estados financieros.",
  "Recibes la descripción de cada hoja de un libro de Excel: nombre, títulos (primeras filas",
  "de texto), encabezados de columnas, algunas etiquetas del cuerpo y lo que un análisis",
  "automático ya detectó. Clasifica TODAS las hojas: tipo y período.",
  "",
  "Reglas:",
  "- Usa exactamente los nombres de hoja recibidos. Nunca inventes una hoja.",
  "- El período es el año que cubre la hoja (\"A: DIC 31/2025\", \"DIC/31/2025\", \"31 de diciembre",
  "  de 2025\"), NO la fecha en que se procesó o imprimió (\"Procesado en: 2026/03/..\").",
  "- Un balance de comprobación tiene columnas de niveles contables (grupo, cuenta, subcuenta,",
  "  auxiliar…) o de código, y una columna de saldo. Un estado financiero ya armado no lo es.",
  "- Si una hoja compara varios años, su período es null.",
  "- Ante la duda, periodo null: es preferible dejarlo sin resolver a adivinar. Un contador",
  "  revisará tu respuesta.",
].join("\n");

function describir(h: Hoja): string {
  return [
    `## Hoja "${h.nombre}" (${h.filas} filas)`,
    `Análisis automático: tipo=${h.tipo_detectado}, años=${h.anios_detectados.join(", ") || "ninguno"}, ` +
      `año en el nombre=${h.anio_en_nombre ?? "ninguno"}, encabezados de nota=${h.encabezados_nota}`,
    h.titulos.length ? `Títulos:\n${h.titulos.map((t) => `  - ${t}`).join("\n")}` : "Títulos: (ninguno)",
    h.encabezados.length ? `Encabezados de columnas: ${h.encabezados.join(" | ")}` : "",
    h.etiquetas.length ? `Etiquetas del cuerpo: ${h.etiquetas.join(" · ")}` : "",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  try {
    const { apiKey, modelo } = await obtenerConfigIA();
    if (!apiKey) return json({ error: MENSAJE_SIN_CLAVE }, 500);

    const { hojas } = (await req.json()) as { hojas: Hoja[] };
    if (!Array.isArray(hojas) || hojas.length === 0) return json({ error: "Payload inválido." }, 400);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 4000,
        system: SISTEMA,
        tools: [HERRAMIENTA],
        tool_choice: { type: "tool", name: "registrar_clasificacion" },
        messages: [{ role: "user", content: `El libro tiene ${hojas.length} hojas:\n\n${hojas.map(describir).join("\n\n")}` }],
      }),
    });
    if (!res.ok) return json({ error: `Anthropic ${res.status}: ${await res.text()}` }, 502);

    const data = await res.json();
    const bloque = (data.content ?? []).find(
      (c: { type: string; name?: string }) => c.type === "tool_use" && c.name === "registrar_clasificacion",
    );
    if (!bloque) return json({ error: "El modelo no devolvió una clasificación." }, 502);

    // Verificación mínima aquí; la app vuelve a validar con sus propias reglas.
    const nombres = new Set(hojas.map((h) => h.nombre));
    const r = bloque.input ?? {};
    r.hojas = (Array.isArray(r.hojas) ? r.hojas : []).filter((h: { nombre: string }) => nombres.has(h.nombre));
    return json({ resultado: r, modelo });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

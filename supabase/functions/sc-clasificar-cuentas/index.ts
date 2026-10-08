// SusConsultores — clasificación semántica de cuentas contables.
//
// Único punto de la aplicación donde interviene un modelo de lenguaje.
// Contrato estricto (sección 10 del documento de requerimientos):
//   - Entra: código y nombre de cuenta + el catálogo institucional.
//   - Sale: una ETIQUETA (código de rubro) + confianza + razón.
//   - NUNCA sale un importe. Los saldos ni siquiera se envían al modelo.
// Todo código de rubro devuelto se valida contra el catálogo antes de salir
// de aquí; lo que no valide se devuelve como sin_clasificar.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MENSAJE_SIN_CLAVE, obtenerConfigIA } from "../_shared/configIA.ts";

const LOTE = 50;

type Cuenta = { id: string; codigo: string; nombre: string };
type Rubro = { codigo: string; nombre: string; estado: string; seccion: string };
type Resultado = {
  id: string;
  rubro_codigo: string | null;
  confianza: number;
  razon: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HERRAMIENTA = {
  name: "registrar_clasificacion",
  description:
    "Registra el rubro del formato institucional que corresponde a cada cuenta contable.",
  input_schema: {
    type: "object",
    properties: {
      resultados: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "id de la cuenta, tal cual se recibió" },
            rubro_codigo: {
              type: ["string", "null"],
              description:
                "Código del rubro del catálogo. null si ninguno corresponde con claridad.",
            },
            confianza: {
              type: "number",
              description: "0 a 1. Usa un valor bajo cuando el nombre sea ambiguo.",
            },
            razon: {
              type: "string",
              description: "Máximo 12 palabras: en qué te basaste.",
            },
          },
          required: ["id", "rubro_codigo", "confianza", "razon"],
        },
      },
    },
    required: ["resultados"],
  },
} as const;

function sistema(rubros: Rubro[]): string {
  const catalogo = rubros
    .map((r) => `- ${r.codigo} | ${r.nombre} | ${r.estado} / ${r.seccion}`)
    .join("\n");
  return [
    "Eres asistente de un contador colombiano. Clasificas cuentas de un balance de",
    "comprobación (plan único de cuentas, PUC) dentro del formato institucional de",
    "presentación de SusConsultores.",
    "",
    "Catálogo de rubros disponibles (código | nombre | estado financiero / sección):",
    catalogo,
    "",
    "Reglas:",
    "1. Devuelve SIEMPRE un código exacto del catálogo, o null. Nunca inventes códigos.",
    "2. El código PUC manda sobre el nombre. El nombre solo desempata o confirma.",
    "3. Si el nombre contradice al código, baja la confianza y explícalo en la razón.",
    "4. Ante duda real, devuelve null con confianza 0: el contador lo resolverá.",
    "   Es preferible dejarla sin clasificar antes que ubicarla mal.",
    "5. No calcules, no sumes y no comentes importes. No los recibes.",
  ].join("\n");
}

async function clasificarLote(
  apiKey: string,
  modelo: string,
  cuentas: Cuenta[],
  rubros: Rubro[],
): Promise<Resultado[]> {
  const listado = cuentas
    .map((c) => `${c.id} | ${c.codigo} | ${c.nombre}`)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 8000,
      system: sistema(rubros),
      tools: [HERRAMIENTA],
      tool_choice: { type: "tool", name: "registrar_clasificacion" },
      messages: [
        {
          role: "user",
          content:
            `Clasifica estas ${cuentas.length} cuentas. Formato: id | código | nombre\n\n` +
            listado,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const bloque = (data.content ?? []).find(
    (c: { type: string; name?: string }) =>
      c.type === "tool_use" && c.name === "registrar_clasificacion",
  );
  if (!bloque) return [];
  return (bloque.input?.resultados ?? []) as Resultado[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { apiKey, modelo } = await obtenerConfigIA();
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: MENSAJE_SIN_CLAVE }),
        { status: 500, headers: { ...cors, "content-type": "application/json" } },
      );
    }

    const { cuentas, rubros } = (await req.json()) as {
      cuentas: Cuenta[];
      rubros: Rubro[];
    };
    if (!Array.isArray(cuentas) || !Array.isArray(rubros) || rubros.length === 0) {
      return new Response(JSON.stringify({ error: "Payload inválido." }), {
        status: 400,
        headers: { ...cors, "content-type": "application/json" },
      });
    }

    const validos = new Set(rubros.map((r) => r.codigo));
    const porId = new Map<string, Resultado>();

    for (let i = 0; i < cuentas.length; i += LOTE) {
      const lote = cuentas.slice(i, i + LOTE);
      const salida = await clasificarLote(apiKey, modelo, lote, rubros);
      for (const r of salida) porId.set(r.id, r);
    }

    // Verificación determinística de la salida del modelo.
    const resultados: Resultado[] = cuentas.map((c) => {
      const r = porId.get(c.id);
      if (!r || !r.rubro_codigo || !validos.has(r.rubro_codigo)) {
        return {
          id: c.id,
          rubro_codigo: null,
          confianza: 0,
          razon: r?.rubro_codigo
            ? `El modelo devolvió un rubro inexistente (${r.rubro_codigo}).`
            : "Sin correspondencia clara en el catálogo.",
        };
      }
      return {
        id: c.id,
        rubro_codigo: r.rubro_codigo,
        confianza: Math.min(1, Math.max(0, Number(r.confianza) || 0)),
        razon: String(r.razon ?? "").slice(0, 200),
      };
    });

    return new Response(JSON.stringify({ resultados, modelo }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});

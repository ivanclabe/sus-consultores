// SusConsultores — prueba de la configuración de la IA.
//
// Hace una llamada mínima a Anthropic con la llave configurada y el modelo
// (el guardado o, si se envía, el que se quiere probar antes de guardarlo).
// Nunca devuelve la llave. Solo para administradores de SusConsultores.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MENSAJE_SIN_CLAVE, obtenerConfigIA } from "../_shared/configIA.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function esAdministrador(req: Request): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const auth = req.headers.get("authorization");
  if (!url || !anon || !auth) return false;
  const res = await fetch(`${url}/rest/v1/rpc/sc_es_administrador`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anon, authorization: auth },
    body: "{}",
  });
  return res.ok && (await res.json()) === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  try {
    if (!(await esAdministrador(req))) {
      return json({ error: "Solo un administrador de SusConsultores puede probar la configuración." }, 403);
    }
    const cuerpo = (await req.json().catch(() => ({}))) as { modelo?: string };
    const config = await obtenerConfigIA();
    if (!config.apiKey) return json({ ok: false, fuente: config.fuente, modelo: config.modelo, mensaje: MENSAJE_SIN_CLAVE });

    const modelo = cuerpo.modelo && /^claude-[a-z0-9][a-z0-9.\-]{2,60}$/.test(cuerpo.modelo) ? cuerpo.modelo : config.modelo;
    const inicio = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo, max_tokens: 5, messages: [{ role: "user", content: "Responde solo: OK" }] }),
    });
    const latencia = Date.now() - inicio;
    if (!res.ok) {
      const detalle = await res.text();
      const mensaje =
        res.status === 401 ? "Anthropic rechazó la llave (401). Revisa que esté activa y bien copiada."
        : res.status === 404 ? `El modelo «${modelo}» no existe o la llave no tiene acceso a él (404).`
        : res.status === 429 ? "Límite de uso alcanzado o saldo insuficiente (429)."
        : `Anthropic respondió ${res.status}: ${detalle.slice(0, 300)}`;
      return json({ ok: false, fuente: config.fuente, modelo, mensaje, latencia_ms: latencia });
    }
    const data = await res.json();
    return json({
      ok: true,
      fuente: config.fuente,
      modelo: data.model ?? modelo,
      mensaje: "Conexión correcta.",
      latencia_ms: latencia,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

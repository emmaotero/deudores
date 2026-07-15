// Este endpoint guarda tu API key de Anthropic en el servidor (variable de
// entorno ANTHROPIC_API_KEY en Vercel) — nunca se expone al navegador.

const SYSTEM_PROMPT = `Sos un intérprete de riesgo crediticio para dueños de PyMEs argentinas que venden a crédito (30/60/90 días). Traducís datos de la Central de Deudores del BCRA y cheques rechazados a una alerta breve (máximo 3 frases), en castellano simple, sin jerga bancaria sin explicar.

Nunca decís "no le vendas" ni "cortale el crédito" de forma tajante: das el dato, el contexto, y como máximo una sugerencia prudente (ej. "podría valer la pena confirmar el próximo pedido antes de despachar"). La decisión comercial es siempre de la PyME.

Si la situación es normal y no hay cheques rechazados, tranquilizá brevemente sin exagerar ni prometer que el cliente va a pagar seguro — la Central de Deudores reduce sorpresas, no las elimina.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Falta configurar ANTHROPIC_API_KEY en las variables de entorno de Vercel.",
    });
  }

  const { nombre, cuit, data } = req.body || {};
  if (!nombre || !data) {
    return res.status(400).json({ error: "Faltan datos del cliente." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Cliente: ${nombre} (CUIT ${cuit}). Datos BCRA: ${JSON.stringify(data)}`,
          },
        ],
      }),
    });

    const json = await r.json();
    if (json.error) {
      return res.status(502).json({ error: json.error.message || "Error de la API de Anthropic" });
    }

    const text = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(502).json({ error: "No se pudo generar la explicación", detail: String(err) });
  }
}

export default async function handler(req, res) {
  const { cuit } = req.query;

  if (!/^\d{11}$/.test(cuit || "")) {
    return res.status(400).json({ error: "CUIT inválido. Debe tener 11 dígitos." });
  }

  const url = `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/ChequesRechazados/${cuit}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "Respuesta no válida del BCRA", raw: text.slice(0, 300) });
    }
    return res.status(r.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: "No se pudo consultar la API del BCRA", detail: String(err) });
  }
}

// Proxy server-side a la API pública del BCRA — Central de Deudores.
// Corre en el servidor de Vercel, no en el navegador, así que no hay problema de CORS.

export default async function handler(req, res) {
  const { cuit } = req.query;

  if (!/^\d{11}$/.test(cuit || "")) {
    return res.status(400).json({ error: "CUIT inválido. Debe tener 11 dígitos." });
  }

  const url = `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/${cuit}`;

  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      // El certificado de api.bcra.gob.ar a veces presenta una cadena
      // incompleta que algunos clientes HTTP rechazan por defecto.
      // Si ves errores de TLS/certificado en los logs de Vercel, ver
      // la nota al respecto en el README antes de forzar cualquier
      // bypass de validación de certificados.
    });

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

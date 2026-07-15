# Cartera Sana

Monitor de riesgo crediticio para PyMEs que venden a crédito. Consulta en vivo
la Central de Deudores y los Cheques Rechazados del BCRA por CUIT, y arma un
semáforo de riesgo por cliente. La explicación en lenguaje simple ("Explicar
con IA") es opcional y usa la API de Anthropic.

## Cómo funciona

- `pages/index.js` — la interfaz. Guarda tu cartera en `localStorage` del
  navegador (por ahora es por dispositivo, no compartida entre usuarios).
- `pages/api/deudas/[cuit].js` y `pages/api/cheques/[cuit].js` — funciones
  serverless que consultan la API pública del BCRA **desde el servidor**, no
  desde el navegador. Esto es lo que resuelve el problema de CORS que vimos
  al probarlo como artifact.
- `pages/api/explicar.js` — función serverless que llama a la API de
  Anthropic con tu clave privada (nunca se expone al navegador).

## Deploy en Vercel (paso a paso)

1. **Subí este proyecto a GitHub.** Si no tenés el repo creado:
   ```bash
   cd cartera-sana
   git init
   git add .
   git commit -m "Cartera Sana MVP"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/cartera-sana.git
   git push -u origin main
   ```
2. **Entrá a [vercel.com](https://vercel.com)**, iniciá sesión (podés usar tu
   cuenta de GitHub) y elegí **Add New → Project**.
3. **Importá el repo** `cartera-sana`. Vercel detecta que es Next.js
   automáticamente — no hace falta tocar la configuración de build.
4. **Variable de entorno** (solo si vas a usar "Explicar con IA"): en
   *Project Settings → Environment Variables*, agregá:
   - `ANTHROPIC_API_KEY` = tu clave de `console.anthropic.com`
   Si no la configurás, toda la app funciona igual — solo el botón
   "Explicar con IA" va a devolver un error amigable.
5. **Deploy.** Vercel te da una URL tipo `cartera-sana.vercel.app` en un par
   de minutos.

## Nota importante sobre la API del BCRA

Es información pública oficial (`api.bcra.gob.ar`), sin necesidad de API key.
Dos cosas a tener en cuenta en producción:

- **Certificado TLS**: algunos entornos reportan problemas con la cadena de
  certificados de `api.bcra.gob.ar`. Si las funciones de `/api/deudas` o
  `/api/cheques` fallan en Vercel con un error de certificado (revisalo en
  *Deployments → Functions → Logs*), es un problema conocido de esa API
  puntual, no de este código — antes de forzar cualquier bypass de
  validación de certificados (lo cual no es recomendable en producción),
  conviene confirmar si persiste y buscar la solución vigente.
- **Límite de consultas**: el BCRA puede aplicar control de tráfico por IP.
  Si tenés muchos clientes en la cartera, conviene escalonar las consultas
  del botón "Actualizar todos" en vez de dispararlas todas en simultáneo
  (ahora mismo se hacen en secuencia, una por una, así que ya está mitigado).

## Qué falta para ser un producto vendible (no solo un MVP)

- **Autenticación y multiusuario.** Hoy la cartera vive en el navegador de
  quien la usa (`localStorage`). Para vender esto a varios clientes hace
  falta una base de datos real (ej. Vercel Postgres o Supabase) con cuentas
  separadas por PyME.
- **Alertas automáticas.** Hoy hay que entrar a la app y tocar "Actualizar".
  El valor real del producto (el "che, bajó a situación 3") aparece cuando
  hay un job periódico (cron de Vercel) que consulta solo, compara contra el
  snapshot anterior, y manda un email o notificación cuando cambia algo.
- **Chequeo legal** sobre el uso de datos de terceros bajo la Ley 25.326
  antes de la primera venta real (ver notas del prompt inicial del
  proyecto).

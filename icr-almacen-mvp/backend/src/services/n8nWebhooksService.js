const crypto = require("crypto");
const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");

async function crearWebhook({ evento, url, secret, usuarioId, canal }) {
  if (!evento || !url) throw new AppError("SCHEMA_INVALID", "evento y url son obligatorios", 400);
  if (!/^https?:\/\//i.test(url)) throw new AppError("SCHEMA_INVALID", "url debe empezar con http:// o https://", 400);

  return withAuditedTransaction("admin.n8n_webhook.create", usuarioId, canal, async (client) => {
    const r = await client.query(
      `INSERT INTO n8n_webhooks (evento, url, secret, creado_por) VALUES ($1,$2,$3,$4) RETURNING *`,
      [evento, url, secret || null, usuarioId]
    );
    return { entidad: "n8n_webhooks", entidadId: r.rows[0].webhook_id, valorNuevo: { evento, url }, webhook: r.rows[0] };
  });
}

// El secret nunca se vuelve a mostrar tras crearlo (mismo criterio que los
// tokens de servicio) — acá solo se informa si tiene uno configurado.
async function listWebhooks() {
  const r = await pool.query(
    `SELECT webhook_id, evento, url, activo, (secret IS NOT NULL) AS tiene_secret, created_at
     FROM n8n_webhooks ORDER BY created_at DESC`
  );
  return r.rows;
}

async function actualizarWebhook({ webhookId, activo, usuarioId, canal }) {
  if (activo == null) throw new AppError("SCHEMA_INVALID", "activo es obligatorio", 400);
  return withAuditedTransaction("admin.n8n_webhook.update", usuarioId, canal, async (client) => {
    const r = await client.query("UPDATE n8n_webhooks SET activo=$2 WHERE webhook_id=$1 RETURNING *", [webhookId, activo]);
    if (r.rows.length === 0) throw new AppError("WEBHOOK_NOT_FOUND", "El webhook indicado no existe", 404);
    return { entidad: "n8n_webhooks", entidadId: webhookId, valorNuevo: { activo }, webhook: r.rows[0] };
  });
}

async function eliminarWebhook({ webhookId, usuarioId, canal }) {
  return withAuditedTransaction("admin.n8n_webhook.delete", usuarioId, canal, async (client) => {
    const r = await client.query("DELETE FROM n8n_webhooks WHERE webhook_id=$1 RETURNING *", [webhookId]);
    if (r.rows.length === 0) throw new AppError("WEBHOOK_NOT_FOUND", "El webhook indicado no existe", 404);
    return { entidad: "n8n_webhooks", entidadId: webhookId, valorNuevo: { eliminado: true }, webhook: r.rows[0] };
  });
}

// Notifica, best-effort, a cada webhook activo suscripto a `evento` (o al
// comodín '*'). Nunca lanza: quien dispara el evento (ej. marcar asistencia)
// ya terminó su operación real y no debe fallar porque N8N esté caído o una
// URL esté mal configurada — mismo espíritu que el resto de las
// integraciones "best-effort" del proyecto (asientos automáticos, Drive).
// Timeout corto por request para no colgar nunca al llamador. `deps.fetchImpl`
// permite inyectar un mock en los tests (mismo patrón que aiChatService.chat),
// sin hacer ninguna petición de red real.
async function dispatchEvent(evento, data, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  let r;
  try {
    r = await pool.query("SELECT * FROM n8n_webhooks WHERE activo = true AND (evento = $1 OR evento = '*')", [evento]);
  } catch (err) {
    console.error(`No se pudo consultar los webhooks N8N para el evento '${evento}':`, err.message);
    return;
  }
  if (r.rows.length === 0) return;

  const body = JSON.stringify({ evento, data, timestamp: new Date().toISOString() });
  await Promise.all(
    r.rows.map(async (hook) => {
      try {
        const headers = { "Content-Type": "application/json" };
        if (hook.secret) {
          headers["X-ICR-Signature"] = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
        }
        const res = await fetchImpl(hook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
        if (!res.ok) console.error(`Webhook N8N '${hook.url}' respondió ${res.status} para el evento '${evento}'`);
      } catch (err) {
        console.error(`No se pudo notificar el webhook N8N '${hook.url}' para el evento '${evento}':`, err.message);
      }
    })
  );
}

module.exports = { crearWebhook, listWebhooks, actualizarWebhook, eliminarWebhook, dispatchEvent };

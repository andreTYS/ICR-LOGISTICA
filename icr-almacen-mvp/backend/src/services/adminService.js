const crypto = require("crypto");
const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const { ROLE_PERMISSIONS, hashApiToken, API_TOKEN_PREFIX } = require("../auth");

// Solo lectura, pensado para las pantallas de Administración → Roles y
// permisos / Integraciones. ROLE_PERMISSIONS vive hardcodeado en auth.js
// (documento técnico §2.4) — acá solo se expone tal cual, sin duplicar el
// mapa ni permitir editarlo desde el panel (cambiarlo requiere tocar el
// código y desplegar, a propósito: es la fuente de verdad de seguridad).
function getRolePermissions() {
  return Object.entries(ROLE_PERMISSIONS).map(([rol, permisos]) => ({ rol, permisos }));
}

// Nunca devuelve los valores de las variables de entorno — solo si están
// configuradas o no, para que Administración → Integraciones pueda avisar
// "falta GEMINI_API_KEY" sin exponer secretos en la respuesta de la API.
function getIntegrationsStatus() {
  return {
    gemini: { configurado: !!process.env.GEMINI_API_KEY, variable: "GEMINI_API_KEY" },
    telegram_bot: { configurado: !!process.env.TELEGRAM_BOT_TOKEN, variable: "TELEGRAM_BOT_TOKEN" },
    telegram_webhook: { configurado: !!process.env.TELEGRAM_WEBHOOK_SECRET, variable: "TELEGRAM_WEBHOOK_SECRET" },
    google_drive: { configurado: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!process.env.GOOGLE_DRIVE_FOLDER_ID, variable: "GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_FOLDER_ID" },
  };
}

// Tokens de servicio para integraciones (N8N y similares): el token "actúa
// como" un usuario existente y hereda sus permisos tal cual — no hay un rol
// especial "N8N". El valor en claro solo se devuelve acá, en el momento de
// crearlo; después solo queda su hash en BD, irrecuperable.
async function crearApiToken({ actuaComoUsuarioId, etiqueta, expiraDias, usuarioId, canal }) {
  if (!actuaComoUsuarioId || !etiqueta) {
    throw new AppError("SCHEMA_INVALID", "actuaComoUsuarioId y etiqueta son obligatorios", 400);
  }
  return withAuditedTransaction("admin.api_token.create", usuarioId, canal, async (client) => {
    const u = await client.query("SELECT usuario_id, nombre_completo, rol_codigo FROM usuarios WHERE usuario_id=$1 AND activo=true", [actuaComoUsuarioId]);
    if (u.rows.length === 0) throw new AppError("USER_NOT_FOUND", "El usuario indicado no existe o está inactivo", 404);

    const plaintext = API_TOKEN_PREFIX + crypto.randomBytes(24).toString("hex");
    const hash = hashApiToken(plaintext);
    const expiraEn = expiraDias ? new Date(Date.now() + Number(expiraDias) * 24 * 60 * 60 * 1000) : null;
    const r = await client.query(
      `INSERT INTO api_tokens (etiqueta, token_hash, prefijo, usuario_id, creado_por, expira_en)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING api_token_id, etiqueta, prefijo, usuario_id, expira_en, revocado, created_at`,
      [etiqueta, hash, plaintext.slice(0, 12), actuaComoUsuarioId, usuarioId, expiraEn]
    );
    return {
      entidad: "api_tokens", entidadId: r.rows[0].api_token_id, valorNuevo: { etiqueta, actuaComoUsuarioId },
      token: plaintext, // se muestra una sola vez — no queda guardado en ningún lado
      apiToken: { ...r.rows[0], usuario_nombre: u.rows[0].nombre_completo, usuario_rol: u.rows[0].rol_codigo },
    };
  });
}

async function listApiTokens() {
  const r = await pool.query(
    `SELECT t.api_token_id, t.etiqueta, t.prefijo, t.expira_en, t.revocado, t.ultimo_uso, t.created_at,
            u.usuario_id, u.nombre_completo AS usuario_nombre, u.rol_codigo AS usuario_rol,
            c.nombre_completo AS creado_por_nombre
     FROM api_tokens t
     JOIN usuarios u ON u.usuario_id = t.usuario_id
     JOIN usuarios c ON c.usuario_id = t.creado_por
     ORDER BY t.created_at DESC`
  );
  return r.rows;
}

async function revocarApiToken({ apiTokenId, usuarioId, canal }) {
  return withAuditedTransaction("admin.api_token.revoke", usuarioId, canal, async (client) => {
    const r = await client.query(
      "UPDATE api_tokens SET revocado=true WHERE api_token_id=$1 AND revocado=false RETURNING api_token_id",
      [apiTokenId]
    );
    if (r.rows.length === 0) throw new AppError("API_TOKEN_NOT_FOUND", "El token indicado no existe o ya está revocado", 404);
    return { entidad: "api_tokens", entidadId: apiTokenId, valorNuevo: { revocado: true } };
  });
}

module.exports = { getRolePermissions, getIntegrationsStatus, crearApiToken, listApiTokens, revocarApiToken };

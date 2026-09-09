const { ROLE_PERMISSIONS } = require("../auth");

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
  };
}

module.exports = { getRolePermissions, getIntegrationsStatus };

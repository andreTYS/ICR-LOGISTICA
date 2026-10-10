const express = require("express");
const router = express.Router();
const { handle, loginLimiter } = require("./_shared");
const { AppError } = require("../errors");
const { requireAuth, login } = require("../auth");
const settings = require("../services/settingsService");
const telegram = require("../services/telegramService");
const chatbot = require("../services/chatbotService");
const openapi = require("../openapi");
const navIcons = require("../services/navIconsService");

// -------- Autenticación --------

router.post(
  "/auth/login",
  loginLimiter,
  handle(async (req) => login(req.body?.email, req.body?.password))
);

router.get(
  "/auth/me",
  requireAuth,
  handle(async (req) => req.user)
);

// Pública: la pantalla de login necesita el logo antes de autenticarse
router.get(
  "/settings",
  handle(async () => settings.getSettings())
);

// Pública: la sidebar necesita pintar los íconos personalizados apenas
// carga, y no son datos sensibles (solo URLs de imágenes ya públicas en /uploads).
router.get(
  "/nav-icons",
  handle(async () => navIcons.listNavIcons())
);

// Pública (sin JWT): Telegram llama este endpoint directo. Se autentica con
// el secret_token que Telegram reenvía en el header (configurado al hacer
// setWebhook), nunca con el token de sesión del panel. Ver README
// "Integración N8N / Telegram" para los pasos de activación — no hay
// infraestructura de Telegram real en este entorno de desarrollo.
router.post(
  "/telegram/webhook",
  handle(async (req) => {
    if (!telegram.verifySecretToken(req.headers["x-telegram-bot-api-secret-token"])) {
      throw new AppError("AUTH_INVALID", "Token secreto de Telegram inválido o no configurado", 401);
    }
    return telegram.handleUpdate(req.body);
  })
);

// Pública (sin JWT): N8N llama este endpoint cuando el chatbot externo
// (widget de la web, o el de la futura tienda) recibe un mensaje. Se
// autentica con CHATBOT_WEBHOOK_SECRET, nunca con el token de sesión del
// panel — mismo criterio que el webhook de Telegram de arriba.
router.post(
  "/chatbot/webhook",
  handle(async (req) => {
    if (!chatbot.verifyWebhookSecret(req.headers["x-chatbot-secret"])) {
      throw new AppError("AUTH_INVALID", "Token secreto del chatbot inválido o no configurado", 401);
    }
    const b = req.body;
    return chatbot.recibirMensaje({
      conversacionCodigo: b.conversacion_codigo || null, canal: b.canal, remitente: b.remitente,
      nombreContacto: b.nombre_contacto, contacto: b.contacto, texto: b.texto,
    });
  })
);

// Pública: el widget de chat (o N8N en su nombre) puede consultar si el
// chatbot está habilitado y su mensaje de bienvenida sin necesitar sesión —
// mismo criterio que GET /settings (logo) y GET /nav-icons.
router.get(
  "/chatbot/config",
  handle(async () => chatbot.getChatbotConfig())
);

// Pública: documentación exportable para integradores (N8N y similares) —
// generada leyendo las rutas reales, nunca queda desactualizada. Devuelve
// el documento OpenAPI tal cual (sin el sobre {status,data,error} del resto
// de la API) porque se espera importar esta respuesta directo en un cliente
// OpenAPI (Swagger UI, el importador de N8N, etc).
router.get("/openapi.json", (req, res) => {
  res.json(openapi.buildOpenApiSpec());
});

module.exports = router;

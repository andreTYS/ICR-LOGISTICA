const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const settings = require("../services/settingsService");
const chatbot = require("../services/chatbotService");
const crm = require("../services/crmService");

// -------- Chatbot (administración del chatbot externo, vía N8N) --------

router.put(
  "/chatbot/config",
  requirePermission("settings.manage"),
  handle(async (req) => {
    const b = req.body;
    return chatbot.setChatbotConfig({
      habilitado: b.habilitado != null ? !!b.habilitado : null, mensajeBienvenida: b.mensaje_bienvenida || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/chatbot/conversations",
  requirePermission("crm.query"),
  handle(async (req) => chatbot.listConversaciones({ estado: req.query.estado || null, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/chatbot/conversations/:codigo",
  requirePermission("crm.query"),
  handle(async (req) => chatbot.getConversacion(req.params.codigo))
);

router.post(
  "/chatbot/conversations/:codigo/reply",
  requirePermission("crm.manage"),
  handle(async (req) => chatbot.responderMensaje({
    conversacionCodigo: req.params.codigo, texto: req.body.texto,
    usuarioId: req.user.usuario_id, canal: req.body.channel || "web",
  }))
);

router.post(
  "/chatbot/conversations/:codigo/close",
  requirePermission("crm.manage"),
  handle(async (req) => chatbot.cerrarConversacion({
    conversacionCodigo: req.params.codigo, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.post(
  "/chatbot/conversations/:codigo/convert-to-lead",
  requirePermission("crm.manage"),
  handle(async (req) => chatbot.convertirALead({
    conversacionCodigo: req.params.codigo, origen: req.body?.origen || null,
    usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

module.exports = router;

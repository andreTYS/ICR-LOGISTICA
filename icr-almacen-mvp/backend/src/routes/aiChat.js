const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const aiChat = require("../services/aiChatService");

// -------- Asistente de IA (consulta del ERP, Gemini) --------

router.post(
  "/ai/chat",
  requirePermission("ai.chat"),
  handle(async (req) => {
    const b = req.body;
    return aiChat.chat({
      mensaje: b.mensaje, historial: b.historial || [],
      usuarioId: req.user.usuario_id, rolCodigo: req.user.rol_codigo, canal: b.channel || "web",
    });
  })
);

module.exports = router;

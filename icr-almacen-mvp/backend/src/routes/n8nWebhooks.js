const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const users = require("../services/userService");
const n8nWebhooks = require("../services/n8nWebhooksService");

// -------- Webhooks salientes hacia N8N (automatizaciones a futuro) --------

router.get(
  "/admin/n8n-webhooks",
  requirePermission("users.manage"),
  handle(async () => n8nWebhooks.listWebhooks())
);

router.post(
  "/admin/n8n-webhooks",
  requirePermission("users.manage"),
  handle(async (req) => {
    const b = req.body;
    return n8nWebhooks.crearWebhook({
      evento: b.evento, url: b.url, secret: b.secret || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/admin/n8n-webhooks/:id/toggle",
  requirePermission("users.manage"),
  handle(async (req) => n8nWebhooks.actualizarWebhook({
    webhookId: req.params.id, activo: req.body?.activo, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.delete(
  "/admin/n8n-webhooks/:id",
  requirePermission("users.manage"),
  handle(async (req) => n8nWebhooks.eliminarWebhook({
    webhookId: req.params.id, usuarioId: req.user.usuario_id, canal: req.query.channel || "web",
  }))
);

module.exports = router;

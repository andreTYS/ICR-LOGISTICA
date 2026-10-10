const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const users = require("../services/userService");
const settings = require("../services/settingsService");
const admin = require("../services/adminService");
const integracionesConfig = require("../services/integracionesConfigService");

// -------- Roles y permisos / Integraciones (solo ADMIN vía wildcard '*') --------

router.get(
  "/admin/role-permissions",
  requirePermission("users.manage"),
  handle(async () => admin.getRolePermissions())
);

router.get(
  "/admin/integrations-status",
  requirePermission("users.manage"),
  handle(async () => admin.getIntegrationsStatus())
);

// Google Drive y WhatsApp se pueden configurar acá mismo (sin entrar por
// SSH a editar el .env): el valor se guarda en la tabla `parametros` y
// integracionesConfigService lo prioriza sobre la variable de entorno.
router.post(
  "/admin/integrations-config",
  requirePermission("settings.manage"),
  handle(async (req) => integracionesConfig.setConfigValue({ clave: req.body?.clave, valor: req.body?.valor }))
);

// -------- Tokens de servicio para integraciones (N8N y similares, solo ADMIN) --------

router.get(
  "/admin/api-tokens",
  requirePermission("users.manage"),
  handle(async () => admin.listApiTokens())
);

router.post(
  "/admin/api-tokens",
  requirePermission("users.manage"),
  handle(async (req) => {
    const b = req.body;
    return admin.crearApiToken({
      actuaComoUsuarioId: b.usuario_id, etiqueta: b.etiqueta, expiraDias: b.expira_dias ? Number(b.expira_dias) : null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/admin/api-tokens/:id/revoke",
  requirePermission("users.manage"),
  handle(async (req) => admin.revocarApiToken({
    apiTokenId: req.params.id, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

module.exports = router;

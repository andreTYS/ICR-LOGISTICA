const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const users = require("../services/userService");
const moduleAccess = require("../services/moduleAccessService");

// -------- Switch de módulos (solo ADMIN vía wildcard '*') --------

router.get(
  "/admin/module-access",
  requirePermission("users.manage"),
  handle(async () => moduleAccess.listModuleAccess())
);

router.post(
  "/admin/module-access",
  requirePermission("users.manage"),
  handle(async (req) => {
    const b = req.body;
    return moduleAccess.setModuleAccess({
      modulo: b.modulo, rolCodigo: b.rol_codigo, habilitado: !!b.habilitado,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

module.exports = router;

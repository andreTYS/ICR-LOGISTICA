const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { AppError } = require("../errors");
const { requirePermission } = require("../auth");
const { upload, processAndSaveImage, processAndSaveIcon } = require("../uploads");
const settings = require("../services/settingsService");
const navIcons = require("../services/navIconsService");

// -------- Configuración (logo, solo ADMIN vía wildcard '*') --------

router.post(
  "/settings/logo",
  requirePermission("settings.manage"),
  upload.single("logo"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    const url = await processAndSaveImage(req.file);
    return settings.setLogoUrl(url);
  })
);

router.post(
  "/settings/empresa",
  requirePermission("settings.manage"),
  handle(async (req) => {
    const b = req.body;
    return settings.setEmpresaInfo({
      razonSocial: b.razon_social, ruc: b.ruc, direccion: b.direccion, telefono: b.telefono,
    });
  })
);

router.post(
  "/nav-icons",
  requirePermission("settings.manage"),
  upload.single("icon"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    if (!req.body.item_key) throw new AppError("SCHEMA_INVALID", "item_key es obligatorio", 400);
    const url = await processAndSaveIcon(req.file);
    return navIcons.setNavIcon({
      itemKey: req.body.item_key, imagenUrl: url, usuarioId: req.user.usuario_id, canal: req.body.channel || "web",
    });
  })
);

router.delete(
  "/nav-icons/:itemKey",
  requirePermission("settings.manage"),
  handle(async (req) => navIcons.removeNavIcon({
    itemKey: req.params.itemKey, usuarioId: req.user.usuario_id, canal: req.query.channel || "web",
  }))
);

module.exports = router;

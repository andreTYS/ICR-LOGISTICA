const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const assets = require("../services/assetsService");

// -------- Activos y Mantenimiento --------

router.post(
  "/assets",
  requirePermission("assets.manage"),
  handle(async (req) => {
    const b = req.body;
    return assets.crearActivo({
      serieNumero: b.serie_numero || null, sku: b.sku || null, descripcion: b.descripcion,
      clienteRuc: b.cliente_ruc || null, proyectoCodigo: b.proyecto_codigo || null,
      fechaInstalacion: b.fecha_instalacion || null, garantiaInicio: b.garantia_inicio || null, garantiaFin: b.garantia_fin || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/assets/:id/status",
  requirePermission("assets.manage"),
  handle(async (req) => assets.actualizarEstadoActivo({ activoId: req.params.id, estado: req.body.estado, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.get(
  "/assets",
  requirePermission("assets.query"),
  handle(async (req) => assets.listActivos({
    clienteRuc: req.query.cliente_ruc || null, proyectoCodigo: req.query.proyecto_codigo || null, estado: req.query.estado || null,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

router.get(
  "/assets/:id",
  requirePermission("assets.query"),
  handle(async (req) => assets.getActivo(req.params.id))
);

router.get(
  "/assets-warranties-expiring",
  requirePermission("assets.query"),
  handle(async (req) => assets.getWarrantiesExpiringSoon({ dias: req.query.dias ? Number(req.query.dias) : null }))
);

router.post(
  "/maintenance",
  requirePermission("assets.manage"),
  handle(async (req) => {
    const b = req.body;
    return assets.programarMantenimiento({
      activoId: b.activo_id, tipo: b.tipo, descripcion: b.descripcion || null, fechaProgramada: b.fecha_programada || null, tecnicoId: b.tecnico_id || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/maintenance/:id/complete",
  requirePermission("assets.manage"),
  handle(async (req) => assets.completarMantenimiento({
    mantenimientoId: req.params.id, fechaRealizada: req.body?.fecha_realizada || null, observaciones: req.body?.observaciones || null,
    usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.get(
  "/maintenance",
  requirePermission("assets.query"),
  handle(async (req) => assets.listMantenimientos({ estado: req.query.estado || null, activoId: req.query.activo_id || null, page: req.query.page, pageSize: req.query.page_size }))
);

module.exports = router;

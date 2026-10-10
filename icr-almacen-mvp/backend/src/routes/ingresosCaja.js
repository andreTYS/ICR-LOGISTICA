const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const ingresos = require("../services/ingresosCajaService");

// -------- Ingresos de caja (ICR Finanzas / Caja de Obra) --------

router.post(
  "/income",
  requirePermission("income.register"),
  handle(async (req) => {
    const b = req.body;
    return ingresos.registrarIngreso({
      tipo: b.tipo, detalle: b.detalle, monto: Number(b.monto), moneda: b.moneda || null,
      fecha: b.fecha || null, proyectoCodigo: b.proyecto_codigo || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/income",
  requirePermission("income.query"),
  handle(async (req) => ingresos.listIngresos({
    tipo: req.query.tipo || null, proyectoCodigo: req.query.proyecto_codigo || null,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

module.exports = router;

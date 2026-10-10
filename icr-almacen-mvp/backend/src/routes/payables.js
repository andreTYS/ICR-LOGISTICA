const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const payables = require("../services/payablesService");

// -------- Cuentas por pagar --------

router.post(
  "/payables/invoices",
  requirePermission("payables.manage"),
  handle(async (req) => {
    const b = req.body;
    return payables.registrarFactura({
      proveedorRuc: b.proveedor_ruc, ordenCompraNumero: b.orden_compra_numero || null, numeroProveedor: b.numero_proveedor || null,
      montoTotal: Number(b.monto_total), moneda: b.moneda || null, fechaEmision: b.fecha_emision || null, fechaVencimiento: b.fecha_vencimiento || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/payables/invoices/:codigo/payments",
  requirePermission("payables.manage"),
  handle(async (req) => {
    const b = req.body;
    return payables.registrarPago({
      codigo: req.params.codigo, monto: Number(b.monto), fechaPago: b.fecha_pago || null, metodo: b.metodo || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/payables/invoices",
  requirePermission("payables.query"),
  handle(async (req) => payables.listFacturas({
    proveedorRuc: req.query.proveedor_ruc || null, estado: req.query.estado || null,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

router.get(
  "/payables/invoices/:codigo",
  requirePermission("payables.query"),
  handle(async (req) => payables.getFactura(req.params.codigo))
);

router.get(
  "/payables-report",
  requirePermission("payables.query"),
  handle(async (req) => payables.listCuentasPorPagar({ estado: req.query.estado || null }))
);

module.exports = router;

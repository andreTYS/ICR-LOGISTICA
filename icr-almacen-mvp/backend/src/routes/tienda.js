const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const tienda = require("../services/tiendaService");

// -------- Tienda (segunda fuente de ingresos: venta directa de equipos) --------

router.post(
  "/store/sales",
  requirePermission("store.sale.register"),
  handle(async (req) => {
    const b = req.body;
    return tienda.registrarVenta({
      sku: b.product?.sku || null,
      warehouseCode: b.warehouse_code || null,
      descripcion: b.descripcion,
      cantidad: Number(b.cantidad),
      precioUnitario: Number(b.precio_unitario),
      clienteRuc: b.cliente_ruc || null,
      comprobante: b.comprobante || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/store/sales",
  requirePermission("store.query"),
  handle(async (req) => tienda.listVentas({
    desde: req.query.desde || null, hasta: req.query.hasta || null,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

module.exports = router;

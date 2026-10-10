const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const { requirePermission } = require("../auth");
const compras = require("../services/comprasService");
const reportesPdf = require("../services/reportesPdfService");
const whatsapp = require("../services/whatsappService");

// -------- Compras --------

router.post(
  "/purchases/orders",
  requirePermission("purchases.create"),
  handle(async (req) => {
    const b = req.body;
    return compras.crearOrdenCompra({
      proveedorRuc: b.proveedor_ruc,
      warehouseCode: b.warehouse_code,
      items: (b.items || []).map((it) => ({ sku: it.sku, quantity: Number(it.quantity), unitCost: it.unit_cost != null ? Number(it.unit_cost) : undefined })),
      fechaEsperada: b.fecha_esperada || null,
      observaciones: b.observaciones || null,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/purchases/orders/:numero/send",
  requirePermission("purchases.send"),
  handle(async (req) => compras.enviarOrdenCompra({ numero: req.params.numero, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.post(
  "/purchases/orders/:numero/cancel",
  requirePermission("purchases.cancel"),
  handle(async (req) => compras.cancelarOrdenCompra({ numero: req.params.numero, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.post(
  "/purchases/orders/:numero/receive",
  requirePermission("purchases.receive"),
  handle(async (req) => {
    const b = req.body;
    return compras.recibirOrdenCompra({
      numero: req.params.numero,
      items: (b.items || []).map((it) => ({ sku: it.sku, quantity: Number(it.quantity) })),
      documento: b.document,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.get(
  "/purchases/orders",
  requirePermission("purchases.query"),
  handle(async (req) => compras.getOrdenesCompra({ estado: req.query.estado, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/purchases/orders/:numero",
  requirePermission("purchases.query"),
  handle(async (req) => compras.getOrdenCompra(req.params.numero))
);

router.get(
  "/purchases/orders/:numero/pdf",
  requirePermission("purchases.query"),
  handleBinary(async (req) => {
    const orden = await compras.getOrdenCompra(req.params.numero);
    const buffer = await reportesPdf.buildOrdenCompraPdf(orden);
    return { buffer, filename: `${orden.numero}.pdf`, contentType: "application/pdf" };
  })
);

router.post(
  "/purchases/orders/:numero/send-whatsapp",
  requirePermission("purchases.send"),
  handle(async (req) => {
    const orden = await compras.getOrdenCompra(req.params.numero);
    const buffer = await reportesPdf.buildOrdenCompraPdf(orden);
    await whatsapp.enviarDocumentoPorWhatsapp({
      to: req.body?.to,
      caption: `Orden de Compra ${orden.numero} — Inversiones ICR`,
      filename: `${orden.numero}.pdf`,
      buffer,
    });
    return { enviado_a: req.body?.to };
  })
);

router.get(
  "/purchases/replenishment-suggestions",
  requirePermission("purchases.replenishment.get"),
  handle(async () => compras.getSugerenciasReabastecimiento())
);

router.get(
  "/purchases/suppliers",
  requirePermission("purchases.query"),
  handle(async () => compras.listProveedores())
);

router.post(
  "/purchases/suppliers",
  requirePermission("purchases.create"),
  handle(async (req) => {
    const b = req.body;
    return compras.crearProveedor({ ruc: b.ruc, razonSocial: b.razon_social, contacto: b.contacto || null, usuarioId: req.user.usuario_id, canal: b.channel || "web" });
  })
);

router.post(
  "/purchases/suppliers/:ruc",
  requirePermission("purchases.create"),
  handle(async (req) => {
    const b = req.body;
    return compras.actualizarProveedor({
      ruc: req.params.ruc, razonSocial: b.razon_social || null, contacto: b.contacto || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

module.exports = router;

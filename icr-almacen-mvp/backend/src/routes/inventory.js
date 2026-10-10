const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { AppError } = require("../errors");
const { requirePermission } = require("../auth");
const { upload, processAndSaveImage } = require("../uploads");
const inventory = require("../services/inventoryService");

// -------- Comandos de escritura --------

router.post(
  "/inventory/receive",
  requirePermission("inventory.receive"),
  handle(async (req) => {
    const b = req.body;
    return inventory.receive({
      sku: b.product?.sku,
      quantity: Number(b.quantity),
      warehouseCode: b.warehouse_code,
      locationCode: b.location_code,
      documento: b.document,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/inventory/remove",
  requirePermission("inventory.remove"),
  handle(async (req) => {
    const b = req.body;
    return inventory.remove({
      sku: b.product?.sku,
      quantity: Number(b.quantity),
      warehouseCode: b.warehouse_code,
      locationCode: b.location_code,
      proyectoCodigo: b.destination?.proyecto_codigo,
      clienteRuc: b.destination?.cliente_ruc,
      documento: b.document,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/inventory/transfer",
  requirePermission("inventory.transfer"),
  handle(async (req) => {
    const b = req.body;
    return inventory.transfer({
      sku: b.product?.sku,
      quantity: Number(b.quantity),
      fromWarehouseCode: b.from?.warehouse_code,
      fromLocationCode: b.from?.location_code,
      toWarehouseCode: b.to?.warehouse_code,
      toLocationCode: b.to?.location_code,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/inventory/product",
  requirePermission("inventory.product.create"),
  handle(async (req) => inventory.createProduct(req.body))
);

router.post(
  "/inventory/products/import-csv",
  requirePermission("inventory.product.create"),
  handle(async (req) => inventory.importProductsCsv(req.body.csv))
);

router.post(
  "/inventory/products/:sku/photo",
  requirePermission("inventory.product.update"),
  upload.single("photo"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    const url = await processAndSaveImage(req.file);
    return inventory.setProductPhoto(req.params.sku, url);
  })
);

router.post(
  "/inventory/products/:sku/returnable",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.setProductRetornable(req.params.sku, req.body?.retornable))
);

router.post(
  "/inventory/products/:sku/precio-venta",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.setProductPrecioVenta(req.params.sku, req.body?.precio_venta))
);

router.post(
  "/inventory/products/:sku/categoria",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.setProductCategoria(req.params.sku, req.body?.categoria))
);

router.post(
  "/inventory/products/:sku/destacado",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.setProductDestacado(req.params.sku, req.body?.destacado))
);

// Baja lógica (activo=false) — ver comentario en inventoryService.deactivateProduct
// sobre por qué nunca es un DELETE real.
router.delete(
  "/inventory/products/:sku",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.deactivateProduct(req.params.sku))
);

// -------- Kits ("cajas de herramientas") --------

router.post(
  "/inventory/kits/:kitSku/items",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.addKitItem({
    kitSku: req.params.kitSku, itemSku: req.body?.sku, quantity: Number(req.body?.quantity),
  }))
);

router.delete(
  "/inventory/kits/:kitSku/items/:itemSku",
  requirePermission("inventory.product.update"),
  handle(async (req) => inventory.removeKitItem({ kitSku: req.params.kitSku, itemSku: req.params.itemSku }))
);

router.get(
  "/inventory/kits/:kitSku/items",
  requirePermission("inventory.stock.get"),
  handle(async (req) => inventory.getKitItems(req.params.kitSku))
);

// -------- Comandos de consulta --------

router.get(
  "/inventory/stock",
  requirePermission("inventory.stock.get"),
  handle(async (req) => inventory.getStock({
    sku: req.query.sku, warehouseCode: req.query.warehouse_code,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

router.get(
  "/inventory/products",
  requirePermission("inventory.stock.search"),
  handle(async (req) => inventory.searchProducts({
    query: req.query.q, page: req.query.page, pageSize: req.query.page_size,
  }))
);

router.get(
  "/inventory/movements",
  requirePermission("inventory.query"),
  handle(async (req) => inventory.getMovements({
    sku: req.query.sku, page: req.query.page, pageSize: req.query.page_size,
  }))
);

router.get(
  "/inventory/alerts",
  requirePermission("inventory.alerts.get"),
  handle(async (req) => inventory.getAlerts({ estado: req.query.estado }))
);

router.get(
  "/inventory/warehouses",
  requirePermission("inventory.stock.get"),
  handle(async () => inventory.listWarehouses())
);

// -------- Almacenes y ubicaciones (gestión) --------

router.get(
  "/inventory/warehouses-managed",
  requirePermission("inventory.query"),
  handle(async () => inventory.listWarehousesManaged())
);

router.post(
  "/inventory/warehouses-managed",
  requirePermission("inventory.warehouse.manage"),
  handle(async (req) => {
    const b = req.body;
    return inventory.crearAlmacen({
      codigo: b.codigo, nombre: b.nombre, responsableId: b.responsable_id || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.patch(
  "/inventory/warehouses-managed/:id",
  requirePermission("inventory.warehouse.manage"),
  handle(async (req) => {
    const b = req.body;
    return inventory.actualizarAlmacen({
      almacenId: req.params.id, nombre: b.nombre || null, responsableId: b.responsable_id || null, activo: b.activo ?? null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/inventory/locations",
  requirePermission("inventory.warehouse.manage"),
  handle(async (req) => {
    const b = req.body;
    return inventory.crearUbicacion({
      almacenCodigo: b.almacen_codigo, codigoUbicacion: b.codigo_ubicacion, descripcion: b.descripcion || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.patch(
  "/inventory/locations/:id",
  requirePermission("inventory.warehouse.manage"),
  handle(async (req) => {
    const b = req.body;
    return inventory.actualizarUbicacion({
      ubicacionId: req.params.id, descripcion: b.descripcion || null, activo: b.activo ?? null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

// -------- Reservas --------

router.post(
  "/inventory/reserve",
  requirePermission("inventory.reserve"),
  handle(async (req) => {
    const b = req.body;
    return inventory.reserve({
      sku: b.product?.sku,
      quantity: Number(b.quantity),
      warehouseCode: b.warehouse_code,
      locationCode: b.location_code,
      proyectoCodigo: b.destination?.proyecto_codigo,
      clienteRuc: b.destination?.cliente_ruc,
      fechaExpiracion: b.fecha_expiracion || null,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/inventory/release_reservation",
  requirePermission("inventory.release_reservation"),
  handle(async (req) => inventory.releaseReservation({
    reservaId: req.body?.reserva_id,
    usuarioId: req.user.usuario_id,
    canal: req.body?.channel || "web",
  }))
);

router.post(
  "/inventory/dispatch_reservation",
  requirePermission("inventory.dispatch_reservation"),
  handle(async (req) => {
    const b = req.body;
    return inventory.dispatchReservation({
      reservaId: b?.reserva_id,
      cantidad: b?.cantidad !== undefined ? Number(b.cantidad) : undefined,
      documento: b?.document,
      usuarioId: req.user.usuario_id,
      canal: b?.channel || "web",
    });
  })
);

router.get(
  "/inventory/reservations",
  requirePermission("inventory.query"),
  handle(async (req) => inventory.getReservations({ estado: req.query.estado }))
);

// -------- Préstamos de herramientas --------

router.post(
  "/inventory/return_loan",
  requirePermission("inventory.return_loan"),
  handle(async (req) => inventory.returnLoan({
    prestamoId: req.body?.prestamo_id,
    usuarioId: req.user.usuario_id,
    canal: req.body?.channel || "web",
  }))
);

router.get(
  "/inventory/loans",
  requirePermission("inventory.query"),
  handle(async (req) => inventory.getLoans({ estado: req.query.estado }))
);

// -------- Ajustes con aprobación --------

router.post(
  "/inventory/adjust",
  requirePermission("inventory.adjust"),
  handle(async (req) => {
    const b = req.body;
    return inventory.adjustCreate({
      sku: b.product?.sku,
      warehouseCode: b.warehouse_code,
      locationCode: b.location_code,
      cantidadFisica: b.cantidad_fisica,
      motivo: b.motivo,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/inventory/adjust/:id/decide",
  requirePermission("inventory.adjust.approve"),
  handle(async (req) => inventory.adjustDecide({
    ajusteId: req.params.id,
    decision: req.body?.decision,
    aprobadoPor: req.user.usuario_id,
    canal: req.body?.channel || "web",
  }))
);

router.get(
  "/inventory/adjustments",
  requirePermission("inventory.query"),
  handle(async (req) => inventory.getAdjustments({ estado: req.query.estado }))
);

// -------- Auditoría --------

router.get(
  "/inventory/audit",
  requirePermission("inventory.audit.get"),
  handle(async (req) => inventory.getAuditLog({
    accion: req.query.accion, resultado: req.query.resultado, limit: req.query.limit,
  }))
);

module.exports = router;

const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const multer = require("multer");
const inventory = require("./services/inventoryService");
const compras = require("./services/comprasService");
const proyectos = require("./services/proyectosService");
const contabilidad = require("./services/contabilidadService");
const users = require("./services/userService");
const settings = require("./services/settingsService");
const { upload, processAndSaveImage } = require("./uploads");
const { AppError } = require("./errors");
const { login, requireAuth, requirePermission } = require("./auth");

// Máximo 10 intentos de login por IP cada 15 minutos, para frenar fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", data: null, error: { code: "RATE_LIMITED", message: "Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos." } },
});

// Envuelve cada handler para capturar errores AppError y devolver el envelope estándar de respuesta
function handle(fn) {
  return async (req, res) => {
    const requestId = req.body?.request_id || req.query?.request_id || null;
    try {
      const data = await fn(req);
      res.json({ request_id: requestId, status: "success", data, error: null });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({
          request_id: requestId,
          status: "error",
          data: null,
          error: { code: err.code, message: err.message, details: err.details },
        });
      } else {
        console.error(err);
        res.status(500).json({
          request_id: requestId,
          status: "error",
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
        });
      }
    }
  };
}

// -------- Autenticación --------

router.post(
  "/auth/login",
  loginLimiter,
  handle(async (req) => login(req.body?.email, req.body?.password))
);

router.get(
  "/auth/me",
  requireAuth,
  handle(async (req) => req.user)
);

// Pública: la pantalla de login necesita el logo antes de autenticarse
router.get(
  "/settings",
  handle(async () => settings.getSettings())
);

// A partir de aquí, todo comando requiere sesión válida (Authorization: Bearer <token>)
router.use(requireAuth);

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
  "/inventory/products/:sku/photo",
  requirePermission("inventory.product.update"),
  upload.single("photo"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    const url = await processAndSaveImage(req.file);
    return inventory.setProductPhoto(req.params.sku, url);
  })
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

router.get(
  "/inventory/reservations",
  requirePermission("inventory.query"),
  handle(async (req) => inventory.getReservations({ estado: req.query.estado }))
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

// -------- Proyectos --------

router.post(
  "/projects",
  requirePermission("projects.create"),
  handle(async (req) => {
    const b = req.body;
    return proyectos.crearProyecto({
      codigoProyecto: b.codigo_proyecto,
      nombre: b.nombre,
      clienteRuc: b.cliente_ruc || null,
      responsableId: b.responsable_id || null,
      presupuesto: b.presupuesto != null ? Number(b.presupuesto) : null,
      moneda: b.moneda || null,
      fechaInicio: b.fecha_inicio || null,
      fechaFin: b.fecha_fin || null,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.post(
  "/projects/:codigo/status",
  requirePermission("projects.update_status"),
  handle(async (req) => proyectos.actualizarEstado({
    codigoProyecto: req.params.codigo, estado: req.body?.estado,
    usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.post(
  "/projects/:codigo/labor",
  requirePermission("projects.labor.register"),
  handle(async (req) => {
    const b = req.body;
    return proyectos.registrarManoObra({
      codigoProyecto: req.params.codigo,
      tecnicoId: b.tecnico_id,
      fecha: b.fecha || null,
      horas: Number(b.horas),
      costoHora: Number(b.costo_hora),
      descripcion: b.descripcion || null,
      usuarioId: req.user.usuario_id,
      canal: b.channel || "web",
    });
  })
);

router.get(
  "/projects",
  requirePermission("projects.query"),
  handle(async (req) => proyectos.listProyectos({ estado: req.query.estado, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/projects/:codigo",
  requirePermission("projects.query"),
  handle(async (req) => proyectos.getProyecto(req.params.codigo))
);

router.get(
  "/projects-technicians",
  requirePermission("projects.query"),
  handle(async () => proyectos.listTecnicos())
);

router.get(
  "/projects-clients",
  requirePermission("projects.query"),
  handle(async () => proyectos.listClientes())
);

router.post(
  "/projects-clients",
  requirePermission("projects.create"),
  handle(async (req) => {
    const b = req.body;
    return proyectos.crearCliente({ ruc: b.ruc, razonSocial: b.razon_social, contacto: b.contacto || null, usuarioId: req.user.usuario_id, canal: b.channel || "web" });
  })
);

router.get(
  "/projects-profitability-report",
  requirePermission("projects.query"),
  handle(async (req) => proyectos.getReporteRentabilidad({ estado: req.query.estado }))
);

// -------- Contabilidad --------

router.post(
  "/accounting/accounts",
  requirePermission("accounting.account.manage"),
  handle(async (req) => {
    const b = req.body;
    return contabilidad.crearCuenta({
      codigo: b.codigo, nombre: b.nombre, tipo: b.tipo, cuentaPadreCodigo: b.cuenta_padre_codigo || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/accounting/accounts",
  requirePermission("accounting.query"),
  handle(async () => contabilidad.listCuentas())
);

router.post(
  "/accounting/fiscal-params",
  requirePermission("accounting.fiscal_param.manage"),
  handle(async (req) => {
    const b = req.body;
    return contabilidad.crearParametroFiscal({
      tipo: b.tipo, valor: Number(b.valor), vigenteDesde: b.vigente_desde, vigenteHasta: b.vigente_hasta || null,
      descripcion: b.descripcion || null, usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/accounting/fiscal-params",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.listParametrosFiscales({ tipo: req.query.tipo }))
);

router.post(
  "/accounting/rules",
  requirePermission("accounting.rule.manage"),
  handle(async (req) => {
    const b = req.body;
    return contabilidad.crearRegla({
      evento: b.evento, cuentaDebeCodigo: b.cuenta_debe_codigo, cuentaHaberCodigo: b.cuenta_haber_codigo,
      descripcion: b.descripcion || null, usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/accounting/rules",
  requirePermission("accounting.query"),
  handle(async () => contabilidad.listReglas())
);

router.post(
  "/accounting/rules/:evento/toggle",
  requirePermission("accounting.rule.manage"),
  handle(async (req) => contabilidad.setReglaActiva({
    evento: req.params.evento, activo: !!req.body?.activo, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.post(
  "/accounting/entries",
  requirePermission("accounting.entry.create"),
  handle(async (req) => {
    const b = req.body;
    return contabilidad.crearAsientoManual({
      fecha: b.fecha || null, glosa: b.glosa,
      lineas: (b.lineas || []).map((l) => ({ cuenta_codigo: l.cuenta_codigo, debe: Number(l.debe || 0), haber: Number(l.haber || 0), proyecto_codigo: l.proyecto_codigo || null })),
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/accounting/entries/:numero/post",
  requirePermission("accounting.entry.post"),
  handle(async (req) => contabilidad.contabilizarAsiento({ numero: req.params.numero, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.post(
  "/accounting/entries/:numero/void",
  requirePermission("accounting.entry.void"),
  handle(async (req) => contabilidad.anularAsiento({ numero: req.params.numero, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.get(
  "/accounting/entries",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.listAsientos({ estado: req.query.estado, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/accounting/entries/:numero",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.getAsiento(req.params.numero))
);

// -------- Usuarios (solo ADMIN vía wildcard '*') --------

router.get(
  "/users",
  requirePermission("users.manage"),
  handle(async () => users.listUsers())
);

router.post(
  "/users",
  requirePermission("users.manage"),
  handle(async (req) => users.createUser(req.body))
);

router.patch(
  "/users/:id",
  requirePermission("users.manage"),
  handle(async (req) => users.updateUser(req.params.id, req.body))
);

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

// Maneja errores de multer (tamaño/tipo de archivo) con el mismo formato de respuesta que `handle()`
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "El archivo supera el tamaño máximo permitido (3MB)" : err.message;
    return res.status(400).json({ status: "error", data: null, error: { code: "UPLOAD_ERROR", message } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ status: "error", data: null, error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error(err);
  res.status(500).json({ status: "error", data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
});

module.exports = router;

const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const inventory = require("./services/inventoryService");
const users = require("./services/userService");
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

module.exports = router;

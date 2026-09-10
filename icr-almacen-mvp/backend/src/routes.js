const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const multer = require("multer");
const inventory = require("./services/inventoryService");
const compras = require("./services/comprasService");
const proyectos = require("./services/proyectosService");
const contabilidad = require("./services/contabilidadService");
const rrhh = require("./services/rrhhService");
const ventas = require("./services/ventasService");
const gastos = require("./services/gastosService");
const dashboard = require("./services/dashboardService");
const users = require("./services/userService");
const settings = require("./services/settingsService");
const moduleAccess = require("./services/moduleAccessService");
const payables = require("./services/payablesService");
const cotizaciones = require("./services/cotizacionesService");
const assets = require("./services/assetsService");
const aiChat = require("./services/aiChatService");
const telegram = require("./services/telegramService");
const admin = require("./services/adminService");
const crm = require("./services/crmService");
const archivos = require("./services/archivosService");
const calendario = require("./services/calendarioService");
const openapi = require("./openapi");
const driveService = require("./services/driveService");
const { upload, processAndSaveImage, processAndSaveIcon, uploadDocument, saveDocumentFile } = require("./uploads");
const navIcons = require("./services/navIconsService");
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

// Pública: la sidebar necesita pintar los íconos personalizados apenas
// carga, y no son datos sensibles (solo URLs de imágenes ya públicas en /uploads).
router.get(
  "/nav-icons",
  handle(async () => navIcons.listNavIcons())
);

// Pública (sin JWT): Telegram llama este endpoint directo. Se autentica con
// el secret_token que Telegram reenvía en el header (configurado al hacer
// setWebhook), nunca con el token de sesión del panel. Ver README
// "Integración N8N / Telegram" para los pasos de activación — no hay
// infraestructura de Telegram real en este entorno de desarrollo.
router.post(
  "/telegram/webhook",
  handle(async (req) => {
    if (!telegram.verifySecretToken(req.headers["x-telegram-bot-api-secret-token"])) {
      throw new AppError("AUTH_INVALID", "Token secreto de Telegram inválido o no configurado", 401);
    }
    return telegram.handleUpdate(req.body);
  })
);

// Pública: documentación exportable para integradores (N8N y similares) —
// generada leyendo las rutas reales, nunca queda desactualizada. Devuelve
// el documento OpenAPI tal cual (sin el sobre {status,data,error} del resto
// de la API) porque se espera importar esta respuesta directo en un cliente
// OpenAPI (Swagger UI, el importador de N8N, etc).
router.get("/openapi.json", (req, res) => {
  res.json(openapi.buildOpenApiSpec());
});

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

router.get(
  "/accounting/reports/income-statement",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.getEstadoResultados({ fechaDesde: req.query.fecha_desde || null, fechaHasta: req.query.fecha_hasta || null }))
);

router.get(
  "/accounting/reports/balance-sheet",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.getBalanceGeneral({ fechaCorte: req.query.fecha_corte || null }))
);

// -------- RRHH --------

router.post(
  "/rrhh/employees",
  requirePermission("rrhh.employee.manage"),
  handle(async (req) => {
    const b = req.body;
    return rrhh.crearEmpleado({
      usuarioVinculadoId: b.usuario_vinculado_id || null, nombreCompleto: b.nombre_completo, dni: b.dni || null,
      cargo: b.cargo || null, tipoContrato: b.tipo_contrato || null, fechaIngreso: b.fecha_ingreso || null,
      costoHora: b.costo_hora != null ? Number(b.costo_hora) : null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.put(
  "/rrhh/employees/:empleadoId",
  requirePermission("rrhh.employee.manage"),
  handle(async (req) => {
    const b = req.body;
    return rrhh.actualizarEmpleado({
      empleadoId: req.params.empleadoId, cargo: b.cargo || null, tipoContrato: b.tipo_contrato || null,
      costoHora: b.costo_hora != null ? Number(b.costo_hora) : null, activo: b.activo != null ? !!b.activo : null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/rrhh/employees",
  requirePermission("rrhh.query"),
  handle(async (req) => rrhh.listEmpleados({ activo: req.query.activo != null ? req.query.activo === "true" : null, page: req.query.page, pageSize: req.query.page_size }))
);

router.post(
  "/rrhh/attendance/check-in",
  requirePermission("rrhh.attendance.mark"),
  handle(async (req) => rrhh.marcarEntrada({ empleadoId: req.body.empleado_id, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.post(
  "/rrhh/attendance/check-out",
  requirePermission("rrhh.attendance.mark"),
  handle(async (req) => rrhh.marcarSalida({ empleadoId: req.body.empleado_id, observaciones: req.body.observaciones || null, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.get(
  "/rrhh/attendance",
  requirePermission("rrhh.query"),
  handle(async (req) => rrhh.listAsistencias({
    empleadoId: req.query.empleado_id || null, fechaDesde: req.query.fecha_desde || null, fechaHasta: req.query.fecha_hasta || null,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

// -------- Ventas --------

router.post(
  "/sales/contracts",
  requirePermission("sales.contract.manage"),
  handle(async (req) => {
    const b = req.body;
    return ventas.crearContrato({
      codigoContrato: b.codigo_contrato, clienteRuc: b.cliente_ruc, proyectoCodigo: b.proyecto_codigo || null,
      montoTotal: Number(b.monto_total), moneda: b.moneda || null, fechaFirma: b.fecha_firma || null,
      responsableId: b.responsable_id || null,
      hitos: (b.hitos || []).map((h) => ({ descripcion: h.descripcion, monto: Number(h.monto), fecha_esperada: h.fecha_esperada || null })),
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/sales/contracts/:codigo/milestones",
  requirePermission("sales.contract.manage"),
  handle(async (req) => {
    const b = req.body;
    return ventas.agregarHito({
      codigoContrato: req.params.codigo, descripcion: b.descripcion, monto: Number(b.monto), fechaEsperada: b.fecha_esperada || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/sales/contracts/:codigo/milestones/:hitoId/pay",
  requirePermission("sales.contract.manage"),
  handle(async (req) => {
    const b = req.body;
    return ventas.registrarPagoHito({
      codigoContrato: req.params.codigo, hitoId: req.params.hitoId, fechaPago: b.fecha_pago || null,
      montoPagado: b.monto_pagado != null ? Number(b.monto_pagado) : null,
      comprobante: b.comprobante ? {
        tipo: b.comprobante.tipo, serie_numero: b.comprobante.serie_numero,
        fecha_emision: b.comprobante.fecha_emision || null, monto: b.comprobante.monto != null ? Number(b.comprobante.monto) : null,
      } : null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/sales/contracts/:codigo/status",
  requirePermission("sales.contract.manage"),
  handle(async (req) => ventas.actualizarEstadoContrato({ codigoContrato: req.params.codigo, estado: req.body.estado, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.get(
  "/sales/contracts",
  requirePermission("sales.query"),
  handle(async (req) => ventas.listContratos({ estado: req.query.estado, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/sales/contracts/:codigo",
  requirePermission("sales.query"),
  handle(async (req) => ventas.getContrato(req.params.codigo))
);

router.get(
  "/sales-receivables",
  requirePermission("sales.query"),
  handle(async (req) => ventas.listCuentasPorCobrar({ estado: req.query.estado || null }))
);

// -------- Gastos --------

router.post(
  "/expenses",
  requirePermission("expenses.register"),
  handle(async (req) => {
    const b = req.body;
    return gastos.registrarGasto({
      categoria: b.categoria, descripcion: b.descripcion, monto: Number(b.monto), moneda: b.moneda || null,
      fecha: b.fecha || null, proyectoCodigo: b.proyecto_codigo || null, empleadoId: b.empleado_id || null,
      comprobante: b.comprobante ? { tipo: b.comprobante.tipo, serie_numero: b.comprobante.serie_numero } : null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/expenses",
  requirePermission("expenses.query"),
  handle(async (req) => gastos.listGastos({
    categoria: req.query.categoria || null, proyectoCodigo: req.query.proyecto_codigo || null,
    page: req.query.page, pageSize: req.query.page_size,
  }))
);

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

// -------- Cotizaciones --------

router.post(
  "/quotes",
  requirePermission("quotes.manage"),
  handle(async (req) => {
    const b = req.body;
    return cotizaciones.crearCotizacion({
      clienteRuc: b.cliente_ruc, proyectoCodigo: b.proyecto_codigo || null, moneda: b.moneda || null,
      fechaEmision: b.fecha_emision || null, validezDias: b.validez_dias || null, items: b.items || [],
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/quotes/:codigo/status",
  requirePermission("quotes.manage"),
  handle(async (req) => cotizaciones.actualizarEstado({ codigo: req.params.codigo, estado: req.body.estado, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.post(
  "/quotes/:codigo/convert",
  requirePermission("quotes.manage"),
  handle(async (req) => cotizaciones.convertirAContrato({ codigo: req.params.codigo, fechaFirma: req.body?.fecha_firma || null, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" }))
);

router.get(
  "/quotes",
  requirePermission("quotes.query"),
  handle(async (req) => cotizaciones.listCotizaciones({ estado: req.query.estado || null, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/quotes/:codigo",
  requirePermission("quotes.query"),
  handle(async (req) => cotizaciones.getCotizacion(req.params.codigo))
);

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

// -------- CRM / Pipeline comercial --------

router.post(
  "/crm/leads",
  requirePermission("crm.manage"),
  handle(async (req) => {
    const b = req.body;
    return crm.crearLead({
      nombreContacto: b.nombre_contacto, empresa: b.empresa || null, telefono: b.telefono || null, email: b.email || null,
      clienteRuc: b.cliente_ruc || null, origen: b.origen || null, montoEstimado: b.monto_estimado != null ? Number(b.monto_estimado) : null,
      moneda: b.moneda || null, fechaProximoSeguimiento: b.fecha_proximo_seguimiento || null, notas: b.notas || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/crm/leads/:codigo/stage",
  requirePermission("crm.manage"),
  handle(async (req) => crm.actualizarEtapa({
    codigo: req.params.codigo, etapa: req.body.etapa, motivoPerdida: req.body?.motivo_perdida || null,
    usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.post(
  "/crm/leads/:codigo/activities",
  requirePermission("crm.manage"),
  handle(async (req) => {
    const b = req.body;
    return crm.registrarActividad({
      codigo: req.params.codigo, tipo: b.tipo, descripcion: b.descripcion, fecha: b.fecha || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/crm/leads/:codigo/convert",
  requirePermission("crm.manage"),
  handle(async (req) => {
    const b = req.body;
    return crm.convertirACotizacion({
      codigo: req.params.codigo, items: b.items || [], proyectoCodigo: b.proyecto_codigo || null,
      moneda: b.moneda || null, validezDias: b.validez_dias || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/crm/leads",
  requirePermission("crm.query"),
  handle(async (req) => crm.listLeads({ etapa: req.query.etapa || null, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/crm/leads/:codigo",
  requirePermission("crm.query"),
  handle(async (req) => crm.getLead(req.params.codigo))
);

// -------- Gestión documental --------

router.post(
  "/documents",
  requirePermission("documents.manage"),
  uploadDocument.single("archivo"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    let url, tipoArchivo, tamanoBytes;
    if (req.body.destino === "drive") {
      const drive = await driveService.uploadFile({ buffer: req.file.buffer, filename: req.body.nombre || req.file.originalname, mimeType: req.file.mimetype });
      url = drive.webViewLink;
      tipoArchivo = req.file.mimetype;
      tamanoBytes = req.file.buffer.length;
    } else {
      ({ url, tipoArchivo, tamanoBytes } = await saveDocumentFile(req.file));
    }
    return archivos.subirArchivo({
      entidadTipo: req.body.entidad_tipo, entidadId: req.body.entidad_id, nombre: req.body.nombre || req.file.originalname,
      url, tipoArchivo, tamanoBytes, usuarioId: req.user.usuario_id, canal: req.body.channel || "web",
    });
  })
);

router.get(
  "/documents",
  requirePermission("documents.query"),
  handle(async (req) => archivos.listArchivos({ entidadTipo: req.query.entidad_tipo, entidadId: req.query.entidad_id }))
);

router.delete(
  "/documents/:id",
  requirePermission("documents.manage"),
  handle(async (req) => archivos.eliminarArchivo({ archivoId: req.params.id, usuarioId: req.user.usuario_id, canal: req.query.channel || "web" }))
);

// -------- Panel: tableros agregados --------

router.get(
  "/dashboard/cashflow",
  requirePermission("accounting.query"),
  handle(async (req) => dashboard.getCashflowSummary({ months: req.query.months ? Number(req.query.months) : 6 }))
);

router.get(
  "/dashboard/expenses-by-category",
  requirePermission("accounting.query"),
  handle(async (req) => dashboard.getExpensesByCategory({ days: req.query.days ? Number(req.query.days) : 30 }))
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

// -------- Roles y permisos / Integraciones (solo ADMIN vía wildcard '*') --------

router.get(
  "/admin/role-permissions",
  requirePermission("users.manage"),
  handle(async () => admin.getRolePermissions())
);

router.get(
  "/admin/integrations-status",
  requirePermission("users.manage"),
  handle(async () => admin.getIntegrationsStatus())
);

// -------- Tokens de servicio para integraciones (N8N y similares, solo ADMIN) --------

router.get(
  "/admin/api-tokens",
  requirePermission("users.manage"),
  handle(async () => admin.listApiTokens())
);

router.post(
  "/admin/api-tokens",
  requirePermission("users.manage"),
  handle(async (req) => {
    const b = req.body;
    return admin.crearApiToken({
      actuaComoUsuarioId: b.usuario_id, etiqueta: b.etiqueta, expiraDias: b.expira_dias ? Number(b.expira_dias) : null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/admin/api-tokens/:id/revoke",
  requirePermission("users.manage"),
  handle(async (req) => admin.revocarApiToken({
    apiTokenId: req.params.id, usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

// -------- Asistente de IA (consulta del ERP, Gemini) --------

router.post(
  "/ai/chat",
  requirePermission("ai.chat"),
  handle(async (req) => {
    const b = req.body;
    return aiChat.chat({
      mensaje: b.mensaje, historial: b.historial || [],
      usuarioId: req.user.usuario_id, rolCodigo: req.user.rol_codigo, canal: b.channel || "web",
    });
  })
);

// -------- Calendario (agenda unificada de solo lectura) --------

router.get(
  "/calendar/events",
  requirePermission("calendar.query"),
  handle(async (req) => calendario.getEventos({
    desde: req.query.desde || null,
    hasta: req.query.hasta || null,
    tipos: req.query.tipos ? String(req.query.tipos).split(",") : null,
  }))
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

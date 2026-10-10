const express = require("express");
const multer = require("multer");
const router = express.Router();
const { AppError, translatePgError } = require("./errors");
const { requireAuth } = require("./auth");

// Cada dominio de negocio vive en su propio archivo bajo routes/ (mismo
// criterio que services/) — este archivo solo arma el orden: rutas
// públicas primero, el candado de sesión después, y el resto de los
// dominios ya protegidos por ese candado. Ver routes/_shared.js para los
// helpers comunes (handle/handleBinary/loginLimiter) y MIGRATIONS.md para
// el criterio equivalente del lado de la base de datos.
const publicRoutes = require("./routes/public");

const miscRoutes = require("./routes/misc");
const inventoryRoutes = require("./routes/inventory");
const comprasRoutes = require("./routes/compras");
const proyectosRoutes = require("./routes/proyectos");
const contabilidadRoutes = require("./routes/contabilidad");
const rrhhRoutes = require("./routes/rrhh");
const ventasRoutes = require("./routes/ventas");
const tiendaRoutes = require("./routes/tienda");
const gastosRoutes = require("./routes/gastos");
const ingresosCajaRoutes = require("./routes/ingresosCaja");
const payablesRoutes = require("./routes/payables");
const cotizacionesRoutes = require("./routes/cotizaciones");
const assetsRoutes = require("./routes/assets");
const crmRoutes = require("./routes/crm");
const tiendaAuthRoutes = require("./routes/tiendaAuth");
const chatbotRoutes = require("./routes/chatbot");
const documentosRoutes = require("./routes/documentos");
const dashboardRoutes = require("./routes/dashboard");
const usuariosRoutes = require("./routes/usuarios");
const moduleAccessRoutes = require("./routes/moduleAccess");
const adminRoutes = require("./routes/admin");
const n8nWebhooksRoutes = require("./routes/n8nWebhooks");
const aiChatRoutes = require("./routes/aiChat");
const calendarioRoutes = require("./routes/calendario");
const settingsRoutes = require("./routes/settings");

router.use(publicRoutes);

// A partir de aquí, todo comando requiere sesión válida (Authorization: Bearer <token>)
router.use(requireAuth);

router.use(miscRoutes);
router.use(inventoryRoutes);
router.use(comprasRoutes);
router.use(proyectosRoutes);
router.use(contabilidadRoutes);
router.use(rrhhRoutes);
router.use(ventasRoutes);
router.use(tiendaRoutes);
router.use(gastosRoutes);
router.use(ingresosCajaRoutes);
router.use(payablesRoutes);
router.use(cotizacionesRoutes);
router.use(assetsRoutes);
router.use(crmRoutes);
router.use(tiendaAuthRoutes);
router.use(chatbotRoutes);
router.use(documentosRoutes);
router.use(dashboardRoutes);
router.use(usuariosRoutes);
router.use(moduleAccessRoutes);
router.use(adminRoutes);
router.use(n8nWebhooksRoutes);
router.use(aiChatRoutes);
router.use(calendarioRoutes);
router.use(settingsRoutes);

// Maneja errores de multer (tamaño/tipo de archivo) con el mismo formato de respuesta que `handle()`
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "El archivo supera el tamaño máximo permitido (3MB)" : err.message;
    return res.status(400).json({ status: "error", data: null, error: { code: "UPLOAD_ERROR", message } });
  }
  const translated = err instanceof AppError ? err : translatePgError(err);
  if (translated) {
    return res.status(translated.status).json({ status: "error", data: null, error: { code: translated.code, message: translated.message, details: translated.details } });
  }
  console.error(err);
  res.status(500).json({ status: "error", data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
});

module.exports = router;

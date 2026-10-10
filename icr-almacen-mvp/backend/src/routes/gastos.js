const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const { AppError } = require("../errors");
const { requirePermission } = require("../auth");
const { uploadSpreadsheet } = require("../uploads");
const gastos = require("../services/gastosService");
const reportesPdf = require("../services/reportesPdfService");
const whatsapp = require("../services/whatsappService");

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
      personaTexto: b.persona_texto || null, ciudad: b.ciudad || null,
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

router.post(
  "/expenses/:id/send-whatsapp",
  requirePermission("expenses.register"),
  handle(async (req) => {
    const gasto = await gastos.getGasto(req.params.id);
    const buffer = await reportesPdf.buildGastoPdf(gasto);
    await whatsapp.enviarDocumentoPorWhatsapp({
      to: req.body?.to,
      caption: `Gasto (${gasto.categoria}): ${gasto.descripcion}`,
      filename: `gasto-${gasto.gasto_id}.pdf`,
      buffer,
    });
    return { enviado_a: req.body?.to };
  })
);

router.post(
  "/expenses/import-xlsx",
  requirePermission("expenses.register"),
  uploadSpreadsheet.single("file"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    return gastos.importGastosXlsx(req.file.buffer, { usuarioId: req.user.usuario_id, canal: req.body?.channel || "web" });
  })
);

router.get(
  "/expenses/import-template",
  requirePermission("expenses.register"),
  handleBinary(async () => {
    const buffer = await gastos.buildImportTemplate();
    return { buffer, filename: "plantilla-gastos.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  })
);

module.exports = router;

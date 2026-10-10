const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const { requirePermission } = require("../auth");
const cotizaciones = require("../services/cotizacionesService");
const reportesPdf = require("../services/reportesPdfService");
const mail = require("../services/mailService");
const whatsapp = require("../services/whatsappService");

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

router.get(
  "/quotes/:codigo/pdf",
  requirePermission("quotes.query"),
  handleBinary(async (req) => {
    const cotizacion = await cotizaciones.getCotizacion(req.params.codigo);
    const buffer = await reportesPdf.buildCotizacionPdf(cotizacion);
    return { buffer, filename: `${cotizacion.codigo}.pdf`, contentType: "application/pdf" };
  })
);

router.post(
  "/quotes/:codigo/send-email",
  requirePermission("quotes.manage"),
  handle(async (req) => {
    const cotizacion = await cotizaciones.getCotizacion(req.params.codigo);
    const to = req.body?.to || cotizacion.cliente_contacto;
    const buffer = await reportesPdf.buildCotizacionPdf(cotizacion);
    await mail.enviarDocumentoPorCorreo({
      to,
      subject: `Cotización ${cotizacion.codigo} — Inversiones ICR`,
      text: `Estimado(a) ${cotizacion.cliente_nombre || ""},\n\nAdjuntamos la cotización ${cotizacion.codigo}.\n\nSaludos,\nInversiones ICR`,
      filename: `${cotizacion.codigo}.pdf`,
      buffer,
    });
    return { enviado_a: to };
  })
);

router.post(
  "/quotes/:codigo/send-whatsapp",
  requirePermission("quotes.manage"),
  handle(async (req) => {
    const cotizacion = await cotizaciones.getCotizacion(req.params.codigo);
    const to = req.body?.to || cotizacion.cliente_telefono;
    const buffer = await reportesPdf.buildCotizacionPdf(cotizacion);
    await whatsapp.enviarDocumentoPorWhatsapp({
      to,
      caption: `Cotización ${cotizacion.codigo} — Inversiones ICR`,
      filename: `${cotizacion.codigo}.pdf`,
      buffer,
    });
    return { enviado_a: to };
  })
);

module.exports = router;

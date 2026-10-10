const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const { requirePermission } = require("../auth");
const ventas = require("../services/ventasService");
const reportesPdf = require("../services/reportesPdfService");
const mail = require("../services/mailService");
const whatsapp = require("../services/whatsappService");

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
  "/sales/contracts/:codigo/pdf",
  requirePermission("sales.query"),
  handleBinary(async (req) => {
    const contrato = await ventas.getContrato(req.params.codigo);
    const buffer = await reportesPdf.buildContratoPdf(contrato);
    return { buffer, filename: `${contrato.codigo_contrato}.pdf`, contentType: "application/pdf" };
  })
);

router.post(
  "/sales/contracts/:codigo/send-email",
  requirePermission("sales.contract.manage"),
  handle(async (req) => {
    const contrato = await ventas.getContrato(req.params.codigo);
    const to = req.body?.to || contrato.cliente_contacto;
    const buffer = await reportesPdf.buildContratoPdf(contrato);
    await mail.enviarDocumentoPorCorreo({
      to,
      subject: `Contrato ${contrato.codigo_contrato} — Inversiones ICR`,
      text: `Estimado(a) ${contrato.cliente_nombre || ""},\n\nAdjuntamos el contrato ${contrato.codigo_contrato}.\n\nSaludos,\nInversiones ICR`,
      filename: `${contrato.codigo_contrato}.pdf`,
      buffer,
    });
    return { enviado_a: to };
  })
);

router.post(
  "/sales/contracts/:codigo/send-whatsapp",
  requirePermission("sales.contract.manage"),
  handle(async (req) => {
    const contrato = await ventas.getContrato(req.params.codigo);
    const to = req.body?.to || contrato.cliente_telefono;
    const buffer = await reportesPdf.buildContratoPdf(contrato);
    await whatsapp.enviarDocumentoPorWhatsapp({
      to,
      caption: `Contrato ${contrato.codigo_contrato} — Inversiones ICR`,
      filename: `${contrato.codigo_contrato}.pdf`,
      buffer,
    });
    return { enviado_a: to };
  })
);

router.get(
  "/sales-receivables",
  requirePermission("sales.query"),
  handle(async (req) => ventas.listCuentasPorCobrar({ estado: req.query.estado || null }))
);

module.exports = router;

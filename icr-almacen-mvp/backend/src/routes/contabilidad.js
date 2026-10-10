const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const { requirePermission } = require("../auth");
const contabilidad = require("../services/contabilidadService");
const reportesPdf = require("../services/reportesPdfService");

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

router.get(
  "/accounting/reports/cash-flow",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.getFlujoCaja({
    fechaDesde: req.query.fecha_desde || null, fechaHasta: req.query.fecha_hasta || null, agrupacion: req.query.agrupacion || null,
  }))
);

router.get(
  "/accounting/reports/cash-flow/movimientos",
  requirePermission("accounting.query"),
  handle(async (req) => contabilidad.getMovimientosCaja({
    fechaDesde: req.query.fecha_desde || null, fechaHasta: req.query.fecha_hasta || null,
  }))
);

router.get(
  "/accounting/reports/income-statement/pdf",
  requirePermission("accounting.query"),
  handleBinary(async (req) => {
    const data = await contabilidad.getEstadoResultados({ fechaDesde: req.query.fecha_desde || null, fechaHasta: req.query.fecha_hasta || null });
    const buffer = await reportesPdf.buildEstadoResultadosPdf(data);
    return { buffer, filename: "estado-de-resultados.pdf", contentType: "application/pdf" };
  })
);

router.get(
  "/accounting/reports/balance-sheet/pdf",
  requirePermission("accounting.query"),
  handleBinary(async (req) => {
    const data = await contabilidad.getBalanceGeneral({ fechaCorte: req.query.fecha_corte || null });
    const buffer = await reportesPdf.buildBalanceGeneralPdf(data);
    return { buffer, filename: "balance-general.pdf", contentType: "application/pdf" };
  })
);

module.exports = router;

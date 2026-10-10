const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const { requirePermission } = require("../auth");
const proyectos = require("../services/proyectosService");
const reportesPdf = require("../services/reportesPdfService");

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

// Vincula la carpeta de Drive ya existente de este proyecto (no crea una
// carpeta nueva) — a partir de ahí, subir un documento a Drive para este
// proyecto va a esa carpeta en vez de la global GOOGLE_DRIVE_FOLDER_ID.
router.post(
  "/projects/:codigo/drive-folder",
  requirePermission("projects.update_status"),
  handle(async (req) => proyectos.setDriveFolderId({
    codigoProyecto: req.params.codigo, driveFolderLink: req.body?.drive_folder_link || null,
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

// -------- Hitos de ejecución (avance físico de la obra) --------

router.post(
  "/projects/:codigo/hitos",
  requirePermission("projects.update_status"),
  handle(async (req) => {
    const b = req.body;
    return proyectos.crearHitoProyecto({
      codigoProyecto: req.params.codigo, descripcion: b.descripcion,
      orden: b.orden ? Number(b.orden) : null, fechaPlanificada: b.fecha_planificada || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.patch(
  "/projects/hitos/:hitoId",
  requirePermission("projects.update_status"),
  handle(async (req) => {
    const b = req.body;
    return proyectos.actualizarHitoProyecto({
      hitoId: req.params.hitoId, estado: b.estado, fechaReal: b.fecha_real || null, observaciones: b.observaciones || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
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
    return proyectos.crearCliente({ ruc: b.ruc || null, dni: b.dni || null, telefono: b.telefono || null, razonSocial: b.razon_social, contacto: b.contacto || null, usuarioId: req.user.usuario_id, canal: b.channel || "web" });
  })
);

router.post(
  "/projects-clients/:identificador",
  requirePermission("projects.create"),
  handle(async (req) => {
    const b = req.body;
    return proyectos.actualizarCliente({
      identificador: req.params.identificador, razonSocial: b.razon_social || null, telefono: b.telefono || null, contacto: b.contacto || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/projects-profitability-report",
  requirePermission("projects.query"),
  handle(async (req) => proyectos.getReporteRentabilidad({ estado: req.query.estado }))
);

router.get(
  "/projects-profitability-report/pdf",
  requirePermission("projects.query"),
  handleBinary(async (req) => {
    const reporte = await proyectos.getReporteRentabilidad({ estado: req.query.estado });
    const buffer = await reportesPdf.buildRentabilidadPdf(reporte, { estado: req.query.estado });
    return { buffer, filename: "rentabilidad-proyectos.pdf", contentType: "application/pdf" };
  })
);

module.exports = router;

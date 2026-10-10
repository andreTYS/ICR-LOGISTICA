const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const rrhh = require("../services/rrhhService");

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

module.exports = router;

const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");

const TIPOS_CONTRATO_VALIDOS = ["PLANILLA", "LOCACION", "PRACTICANTE"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// -------------------- Comandos --------------------

async function crearEmpleado({ usuarioVinculadoId, nombreCompleto, dni, cargo, tipoContrato, fechaIngreso, costoHora, usuarioId, canal }) {
  if (!nombreCompleto) {
    throw new AppError("SCHEMA_INVALID", "nombreCompleto es obligatorio", 400);
  }
  if (tipoContrato && !TIPOS_CONTRATO_VALIDOS.includes(tipoContrato)) {
    throw new AppError("SCHEMA_INVALID", `tipoContrato debe ser uno de: ${TIPOS_CONTRATO_VALIDOS.join(", ")}`, 400);
  }
  if (costoHora != null && costoHora < 0) {
    throw new AppError("SCHEMA_INVALID", "costoHora no puede ser negativo", 400);
  }
  return withAuditedTransaction("rrhh.employee.create", usuarioId, canal, async (client) => {
    if (usuarioVinculadoId) {
      const u = await client.query("SELECT usuario_id FROM usuarios WHERE usuario_id=$1 AND activo=true", [usuarioVinculadoId]);
      if (u.rows.length === 0) throw new AppError("USER_NOT_FOUND", "El usuario a vincular no existe o está inactivo", 404);
    }
    const r = await client.query(
      `INSERT INTO empleados (usuario_id, nombre_completo, dni, cargo, tipo_contrato, fecha_ingreso, costo_hora)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0)) RETURNING *`,
      [usuarioVinculadoId || null, nombreCompleto, dni || null, cargo || null, tipoContrato || null, fechaIngreso || null, costoHora ?? null]
    );
    return { entidad: "empleados", entidadId: r.rows[0].empleado_id, valorNuevo: { nombreCompleto, dni }, empleado: r.rows[0] };
  });
}

async function actualizarEmpleado({ empleadoId, cargo, tipoContrato, costoHora, activo, usuarioId, canal }) {
  if (tipoContrato && !TIPOS_CONTRATO_VALIDOS.includes(tipoContrato)) {
    throw new AppError("SCHEMA_INVALID", `tipoContrato debe ser uno de: ${TIPOS_CONTRATO_VALIDOS.join(", ")}`, 400);
  }
  if (costoHora != null && costoHora < 0) {
    throw new AppError("SCHEMA_INVALID", "costoHora no puede ser negativo", 400);
  }
  return withAuditedTransaction("rrhh.employee.update", usuarioId, canal, async (client) => {
    const r = await client.query(
      `UPDATE empleados SET
         cargo = COALESCE($2, cargo),
         tipo_contrato = COALESCE($3, tipo_contrato),
         costo_hora = COALESCE($4, costo_hora),
         activo = COALESCE($5, activo)
       WHERE empleado_id = $1 RETURNING *`,
      [empleadoId, cargo || null, tipoContrato || null, costoHora ?? null, activo ?? null]
    );
    if (r.rows.length === 0) throw new AppError("EMPLOYEE_NOT_FOUND", "El empleado indicado no existe", 404);
    return { entidad: "empleados", entidadId: empleadoId, valorNuevo: { cargo, tipoContrato, costoHora, activo }, empleado: r.rows[0] };
  });
}

// Marca la entrada del día para un empleado. Un empleado solo puede tener
// una fila de asistencia por fecha (UNIQUE empleado_id+fecha), así que una
// segunda marcación de entrada el mismo día se rechaza en vez de pisar la
// primera.
async function marcarEntrada({ empleadoId, usuarioId, canal }) {
  if (!empleadoId) throw new AppError("SCHEMA_INVALID", "empleadoId es obligatorio", 400);
  return withAuditedTransaction("rrhh.attendance.check_in", usuarioId, canal, async (client) => {
    const emp = await client.query("SELECT empleado_id FROM empleados WHERE empleado_id=$1 AND activo=true", [empleadoId]);
    if (emp.rows.length === 0) throw new AppError("EMPLOYEE_NOT_FOUND", "El empleado indicado no existe o está inactivo", 404);

    const existing = await client.query(
      "SELECT asistencia_id FROM asistencias WHERE empleado_id=$1 AND fecha=CURRENT_DATE",
      [empleadoId]
    );
    if (existing.rows.length > 0) {
      throw new AppError("ATTENDANCE_ALREADY_MARKED", "Ya se registró la entrada de hoy para este empleado", 409);
    }

    const r = await client.query(
      `INSERT INTO asistencias (empleado_id, fecha, hora_entrada) VALUES ($1, CURRENT_DATE, now()) RETURNING *`,
      [empleadoId]
    );
    return { entidad: "asistencias", entidadId: r.rows[0].asistencia_id, valorNuevo: { empleadoId }, asistencia: r.rows[0] };
  });
}

async function marcarSalida({ empleadoId, observaciones, usuarioId, canal }) {
  if (!empleadoId) throw new AppError("SCHEMA_INVALID", "empleadoId es obligatorio", 400);
  return withAuditedTransaction("rrhh.attendance.check_out", usuarioId, canal, async (client) => {
    const abierta = await client.query(
      `SELECT * FROM asistencias WHERE empleado_id=$1 AND fecha=CURRENT_DATE AND hora_entrada IS NOT NULL AND hora_salida IS NULL`,
      [empleadoId]
    );
    if (abierta.rows.length === 0) {
      throw new AppError("ATTENDANCE_NOT_OPEN", "No hay una entrada abierta hoy para este empleado", 404);
    }
    const r = await client.query(
      `UPDATE asistencias
       SET hora_salida = now(),
           horas_trabajadas = ROUND(EXTRACT(EPOCH FROM (now() - hora_entrada)) / 3600.0, 2),
           observaciones = COALESCE($2, observaciones)
       WHERE asistencia_id = $1 RETURNING *`,
      [abierta.rows[0].asistencia_id, observaciones || null]
    );
    return { entidad: "asistencias", entidadId: r.rows[0].asistencia_id, valorNuevo: { empleadoId, horas_trabajadas: r.rows[0].horas_trabajadas }, asistencia: r.rows[0] };
  });
}

// -------------------- Consultas --------------------

async function listEmpleados({ activo, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (activo != null) { params.push(activo); conditions.push(`e.activo = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT e.*, u.email AS usuario_email, u.rol_codigo, COUNT(*) OVER() AS total_count
     FROM empleados e
     LEFT JOIN usuarios u ON u.usuario_id = e.usuario_id
     ${where}
     ORDER BY e.nombre_completo
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function listAsistencias({ empleadoId, fechaDesde, fechaHasta, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 30, 200);
  const conditions = [];
  const params = [];
  if (empleadoId) { params.push(empleadoId); conditions.push(`a.empleado_id = $${params.length}`); }
  if (fechaDesde) { params.push(fechaDesde); conditions.push(`a.fecha >= $${params.length}`); }
  if (fechaHasta) { params.push(fechaHasta); conditions.push(`a.fecha <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT a.*, e.nombre_completo AS empleado_nombre, COUNT(*) OVER() AS total_count
     FROM asistencias a
     JOIN empleados e ON e.empleado_id = a.empleado_id
     ${where}
     ORDER BY a.fecha DESC, e.nombre_completo
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

module.exports = {
  crearEmpleado, actualizarEmpleado, marcarEntrada, marcarSalida,
  listEmpleados, listAsistencias,
};

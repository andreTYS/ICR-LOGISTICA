const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");

const ESTADOS_ACTIVO_VALIDOS = ["OPERATIVO", "EN_MANTENIMIENTO", "FUERA_DE_SERVICIO", "RETIRADO"];
const TIPOS_MANTENIMIENTO_VALIDOS = ["PREVENTIVO", "CORRECTIVO"];
const ESTADOS_MANTENIMIENTO_VALIDOS = ["PROGRAMADO", "EN_PROCESO", "COMPLETADO", "CANCELADO"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Un equipo instalado en casa del cliente, con garantía y ciclo de
// mantenimiento. serieNumero es opcional (cierra el hueco de `series`, que
// ya guarda garantía pero no tenía UI); sku también opcional si el activo
// no viene de un producto con número de serie individual.
async function crearActivo({ serieNumero, sku, descripcion, clienteRuc, proyectoCodigo, fechaInstalacion, garantiaInicio, garantiaFin, usuarioId, canal }) {
  if (!descripcion) {
    throw new AppError("SCHEMA_INVALID", "descripcion es obligatoria", 400);
  }
  return withAuditedTransaction("assets.create", usuarioId, canal, async (client) => {
    let serieId = null;
    let productoId = null;
    if (serieNumero) {
      const s = await client.query("SELECT serie_id, producto_id FROM series WHERE numero_serie=$1", [serieNumero]);
      if (s.rows.length === 0) throw new AppError("SERIAL_NOT_FOUND", `El número de serie '${serieNumero}' no existe`, 404);
      serieId = s.rows[0].serie_id;
      productoId = s.rows[0].producto_id;
    } else if (sku) {
      const p = await client.query("SELECT producto_id FROM productos WHERE sku=$1 AND activo=true", [sku]);
      if (p.rows.length === 0) throw new AppError("PRODUCT_NOT_FOUND", `Producto con SKU '${sku}' no existe o está inactivo`, 404);
      productoId = p.rows[0].producto_id;
    }

    let clienteId = null;
    if (clienteRuc) {
      const c = await client.query("SELECT cliente_id FROM clientes WHERE ruc=$1 AND activo=true", [clienteRuc]);
      if (c.rows.length === 0) throw new AppError("CLIENT_NOT_FOUND", `Cliente con RUC '${clienteRuc}' no existe o está inactivo`, 404);
      clienteId = c.rows[0].cliente_id;
    }

    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${proyectoCodigo}' no existe o está inactivo`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }

    const r = await client.query(
      `INSERT INTO activos_instalados (serie_id, producto_id, descripcion, cliente_id, proyecto_id, fecha_instalacion, garantia_inicio, garantia_fin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [serieId, productoId, descripcion, clienteId, proyectoId, fechaInstalacion || null, garantiaInicio || null, garantiaFin || null]
    );
    return { entidad: "activos_instalados", entidadId: r.rows[0].activo_id, valorNuevo: { descripcion }, activo: r.rows[0] };
  });
}

async function actualizarEstadoActivo({ activoId, estado, usuarioId, canal }) {
  if (!ESTADOS_ACTIVO_VALIDOS.includes(estado)) {
    throw new AppError("SCHEMA_INVALID", `estado debe ser uno de: ${ESTADOS_ACTIVO_VALIDOS.join(", ")}`, 400);
  }
  return withAuditedTransaction("assets.update_status", usuarioId, canal, async (client) => {
    const r = await client.query("UPDATE activos_instalados SET estado=$1 WHERE activo_id=$2 RETURNING *", [estado, activoId]);
    if (r.rows.length === 0) throw new AppError("ASSET_NOT_FOUND", "El activo indicado no existe", 404);
    return { entidad: "activos_instalados", entidadId: activoId, valorNuevo: { estado }, activo: r.rows[0] };
  });
}

async function listActivos({ clienteRuc, proyectoCodigo, estado, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`a.estado = $${params.length}`); }
  if (clienteRuc) { params.push(clienteRuc); conditions.push(`c.ruc = $${params.length}`); }
  if (proyectoCodigo) { params.push(proyectoCodigo); conditions.push(`pr.codigo_proyecto = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT a.*, c.razon_social AS cliente_nombre, pr.codigo_proyecto, p.sku, p.nombre AS producto_nombre, s.numero_serie,
            COUNT(*) OVER() AS total_count
     FROM activos_instalados a
     LEFT JOIN clientes c ON c.cliente_id = a.cliente_id
     LEFT JOIN proyectos pr ON pr.proyecto_id = a.proyecto_id
     LEFT JOIN productos p ON p.producto_id = a.producto_id
     LEFT JOIN series s ON s.serie_id = a.serie_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getActivo(activoId) {
  const aR = await pool.query(
    `SELECT a.*, c.razon_social AS cliente_nombre, pr.codigo_proyecto, p.sku, p.nombre AS producto_nombre, s.numero_serie
     FROM activos_instalados a
     LEFT JOIN clientes c ON c.cliente_id = a.cliente_id
     LEFT JOIN proyectos pr ON pr.proyecto_id = a.proyecto_id
     LEFT JOIN productos p ON p.producto_id = a.producto_id
     LEFT JOIN series s ON s.serie_id = a.serie_id
     WHERE a.activo_id = $1`,
    [activoId]
  );
  if (aR.rows.length === 0) throw new AppError("ASSET_NOT_FOUND", "El activo indicado no existe", 404);
  const mantR = await pool.query(
    `SELECT m.*, u.nombre_completo AS tecnico_nombre
     FROM mantenimientos m LEFT JOIN usuarios u ON u.usuario_id = m.tecnico_id
     WHERE m.activo_id = $1 ORDER BY COALESCE(m.fecha_realizada, m.fecha_programada) DESC, m.created_at DESC`,
    [activoId]
  );
  return { ...aR.rows[0], mantenimientos: mantR.rows };
}

// Programar un mantenimiento marca el activo EN_MANTENIMIENTO — se libera
// (vuelve a OPERATIVO) al completarlo, salvo que ya esté FUERA_DE_SERVICIO
// o RETIRADO por otra razón.
async function programarMantenimiento({ activoId, tipo, descripcion, fechaProgramada, tecnicoId, usuarioId, canal }) {
  if (!activoId || !TIPOS_MANTENIMIENTO_VALIDOS.includes(tipo)) {
    throw new AppError("SCHEMA_INVALID", `activoId es obligatorio y tipo debe ser uno de: ${TIPOS_MANTENIMIENTO_VALIDOS.join(", ")}`, 400);
  }
  return withAuditedTransaction("assets.maintenance.schedule", usuarioId, canal, async (client) => {
    const act = await client.query("SELECT activo_id, estado FROM activos_instalados WHERE activo_id=$1", [activoId]);
    if (act.rows.length === 0) throw new AppError("ASSET_NOT_FOUND", "El activo indicado no existe", 404);

    const r = await client.query(
      `INSERT INTO mantenimientos (activo_id, tipo, descripcion, fecha_programada, tecnico_id, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [activoId, tipo, descripcion || null, fechaProgramada || null, tecnicoId || null, usuarioId]
    );
    if (act.rows[0].estado === "OPERATIVO") {
      await client.query("UPDATE activos_instalados SET estado='EN_MANTENIMIENTO' WHERE activo_id=$1", [activoId]);
    }
    return { entidad: "mantenimientos", entidadId: r.rows[0].mantenimiento_id, valorNuevo: { activoId, tipo }, mantenimiento: r.rows[0] };
  });
}

async function completarMantenimiento({ mantenimientoId, fechaRealizada, observaciones, usuarioId, canal }) {
  return withAuditedTransaction("assets.maintenance.complete", usuarioId, canal, async (client) => {
    const m = await client.query("SELECT * FROM mantenimientos WHERE mantenimiento_id=$1 FOR UPDATE", [mantenimientoId]);
    if (m.rows.length === 0) throw new AppError("MAINTENANCE_NOT_FOUND", "El mantenimiento indicado no existe", 404);
    if (m.rows[0].estado === "COMPLETADO" || m.rows[0].estado === "CANCELADO") {
      throw new AppError("MAINTENANCE_NOT_OPEN", `El mantenimiento ya está ${m.rows[0].estado.toLowerCase()}`, 400);
    }
    const r = await client.query(
      `UPDATE mantenimientos SET estado='COMPLETADO', fecha_realizada=COALESCE($2,CURRENT_DATE), observaciones=COALESCE($3, observaciones)
       WHERE mantenimiento_id=$1 RETURNING *`,
      [mantenimientoId, fechaRealizada || null, observaciones || null]
    );
    const activo = await client.query("SELECT estado FROM activos_instalados WHERE activo_id=$1", [m.rows[0].activo_id]);
    if (activo.rows[0]?.estado === "EN_MANTENIMIENTO") {
      await client.query("UPDATE activos_instalados SET estado='OPERATIVO' WHERE activo_id=$1", [m.rows[0].activo_id]);
    }
    return { entidad: "mantenimientos", entidadId: mantenimientoId, valorNuevo: { estado: "COMPLETADO" }, mantenimiento: r.rows[0] };
  });
}

async function listMantenimientos({ estado, activoId, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 30, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`m.estado = $${params.length}`); }
  if (activoId) { params.push(activoId); conditions.push(`m.activo_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT m.*, a.descripcion AS activo_descripcion, u.nombre_completo AS tecnico_nombre, COUNT(*) OVER() AS total_count
     FROM mantenimientos m
     JOIN activos_instalados a ON a.activo_id = m.activo_id
     LEFT JOIN usuarios u ON u.usuario_id = m.tecnico_id
     ${where}
     ORDER BY COALESCE(m.fecha_programada, m.created_at::date) DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

module.exports = {
  crearActivo, actualizarEstadoActivo, listActivos, getActivo,
  programarMantenimiento, completarMantenimiento, listMantenimientos,
};

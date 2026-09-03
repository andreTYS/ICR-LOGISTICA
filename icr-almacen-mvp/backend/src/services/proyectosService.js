const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");

const ESTADOS_VALIDOS = ["ACTIVO", "PAUSADO", "FINALIZADO", "CANCELADO"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// -------------------- Comandos --------------------

async function crearProyecto({ codigoProyecto, nombre, clienteRuc, responsableId, presupuesto, moneda, fechaInicio, fechaFin, usuarioId, canal }) {
  if (!codigoProyecto || !nombre) {
    throw new AppError("SCHEMA_INVALID", "codigoProyecto y nombre son obligatorios", 400);
  }
  return withAuditedTransaction("projects.create", usuarioId, canal, async (client) => {
    let clienteId = null;
    if (clienteRuc) {
      const r = await client.query("SELECT cliente_id FROM clientes WHERE ruc=$1 AND activo=true", [clienteRuc]);
      if (r.rows.length === 0) throw new AppError("CLIENT_NOT_FOUND", `Cliente con RUC '${clienteRuc}' no existe o está inactivo`, 404);
      clienteId = r.rows[0].cliente_id;
    }
    const r = await client.query(
      `INSERT INTO proyectos (codigo_proyecto, nombre, cliente_id, responsable_id, presupuesto, moneda, fecha_inicio, fecha_fin)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'PEN'),$7,$8) RETURNING *`,
      [codigoProyecto, nombre, clienteId, responsableId || usuarioId, presupuesto || null, moneda || null, fechaInicio || null, fechaFin || null]
    );
    return { entidad: "proyectos", entidadId: r.rows[0].proyecto_id, valorNuevo: { codigoProyecto, nombre }, proyecto: r.rows[0] };
  });
}

async function actualizarEstado({ codigoProyecto, estado, usuarioId, canal }) {
  if (!ESTADOS_VALIDOS.includes(estado)) {
    throw new AppError("SCHEMA_INVALID", `estado debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}`, 400);
  }
  return withAuditedTransaction("projects.update_status", usuarioId, canal, async (client) => {
    const r = await client.query(
      "UPDATE proyectos SET estado = $1 WHERE codigo_proyecto = $2 AND activo = true RETURNING *",
      [estado, codigoProyecto]
    );
    if (r.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${codigoProyecto}' no existe o está inactivo`, 404);
    return { entidad: "proyectos", entidadId: r.rows[0].proyecto_id, valorNuevo: { estado }, proyecto: r.rows[0] };
  });
}

// Registra horas de mano de obra de un técnico contra un proyecto. El
// costo/hora se ingresa por entrada (todavía no hay un módulo de RRHH que
// lo defina por técnico), igual que el costo unitario en inventory.receive.
async function registrarManoObra({ codigoProyecto, tecnicoId, fecha, horas, costoHora, descripcion, usuarioId, canal }) {
  if (!codigoProyecto || !tecnicoId || !horas || horas <= 0 || costoHora == null || costoHora < 0) {
    throw new AppError("SCHEMA_INVALID", "codigoProyecto, tecnicoId, horas (>0) y costoHora (>=0) son obligatorios", 400);
  }
  return withAuditedTransaction("projects.labor.register", usuarioId, canal, async (client) => {
    const pr = await client.query("SELECT proyecto_id, estado FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [codigoProyecto]);
    if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${codigoProyecto}' no existe o está inactivo`, 404);
    if (pr.rows[0].estado === "CANCELADO") {
      throw new AppError("PROJECT_NOT_ACTIVE", `El proyecto '${codigoProyecto}' está cancelado, no admite nuevas horas`, 400);
    }
    const tec = await client.query("SELECT usuario_id FROM usuarios WHERE usuario_id=$1 AND activo=true", [tecnicoId]);
    if (tec.rows.length === 0) throw new AppError("USER_NOT_FOUND", "El técnico indicado no existe o está inactivo", 404);

    const r = await client.query(
      `INSERT INTO proyecto_mano_obra (proyecto_id, tecnico_id, fecha, horas, costo_hora, descripcion, registrado_por)
       VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,
      [pr.rows[0].proyecto_id, tecnicoId, fecha || null, horas, costoHora, descripcion || null, usuarioId]
    );
    return {
      entidad: "proyecto_mano_obra", entidadId: r.rows[0].mano_obra_id,
      valorNuevo: { codigoProyecto, tecnicoId, horas, costoHora }, registro: r.rows[0],
    };
  });
}

// -------------------- Consultas --------------------

async function listProyectos({ estado, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = ["pr.activo = true"];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`pr.estado = $${params.length}`); }
  const where = `WHERE ${conditions.join(" AND ")}`;
  params.push(size, offset);
  const r = await pool.query(
    `SELECT pr.*, c.razon_social AS cliente_nombre, u.nombre_completo AS responsable_nombre,
            COUNT(*) OVER() AS total_count
     FROM proyectos pr
     LEFT JOIN clientes c ON c.cliente_id = pr.cliente_id
     LEFT JOIN usuarios u ON u.usuario_id = pr.responsable_id
     ${where}
     ORDER BY pr.fecha_inicio DESC NULLS LAST, pr.codigo_proyecto DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

// Detalle de un proyecto con su costeo real: materiales consumidos (vía
// movimientos de SALIDA con este proyecto como dimensión, valorizados al
// costo_unitario actual del producto — no es un AVCO histórico, es la misma
// aproximación que usa el resto del MVP) + horas de mano de obra registradas,
// contra el presupuesto.
async function getProyecto(codigoProyecto) {
  const pR = await pool.query(
    `SELECT pr.*, c.razon_social AS cliente_nombre, c.ruc AS cliente_ruc, u.nombre_completo AS responsable_nombre
     FROM proyectos pr
     LEFT JOIN clientes c ON c.cliente_id = pr.cliente_id
     LEFT JOIN usuarios u ON u.usuario_id = pr.responsable_id
     WHERE pr.codigo_proyecto = $1`,
    [codigoProyecto]
  );
  if (pR.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${codigoProyecto}' no existe`, 404);
  const proyecto = pR.rows[0];

  const materialesR = await pool.query(
    `SELECT p.sku, p.nombre AS producto_nombre, SUM(m.cantidad) AS cantidad_total,
            p.costo_unitario, SUM(m.cantidad) * p.costo_unitario AS subtotal
     FROM movimientos m
     JOIN productos p ON p.producto_id = m.producto_id
     WHERE m.proyecto_id = $1 AND m.tipo_movimiento = 'SALIDA'
     GROUP BY p.sku, p.nombre, p.costo_unitario
     ORDER BY p.nombre`,
    [proyecto.proyecto_id]
  );

  const manoObraR = await pool.query(
    `SELECT mo.*, u.nombre_completo AS tecnico_nombre
     FROM proyecto_mano_obra mo
     JOIN usuarios u ON u.usuario_id = mo.tecnico_id
     WHERE mo.proyecto_id = $1
     ORDER BY mo.fecha DESC, mo.created_at DESC`,
    [proyecto.proyecto_id]
  );

  const costoMateriales = materialesR.rows.reduce((sum, row) => sum + Number(row.subtotal), 0);
  const costoManoObra = manoObraR.rows.reduce((sum, row) => sum + Number(row.horas) * Number(row.costo_hora), 0);
  const costoTotal = costoMateriales + costoManoObra;
  const presupuesto = proyecto.presupuesto != null ? Number(proyecto.presupuesto) : null;
  const margen = presupuesto != null ? presupuesto - costoTotal : null;

  return {
    ...proyecto,
    materiales: materialesR.rows,
    mano_obra: manoObraR.rows,
    costeo: {
      costo_materiales: costoMateriales,
      costo_mano_obra: costoManoObra,
      costo_total: costoTotal,
      presupuesto,
      margen,
    },
  };
}

async function crearCliente({ ruc, razonSocial, contacto, usuarioId, canal }) {
  if (!ruc || !razonSocial) {
    throw new AppError("SCHEMA_INVALID", "ruc y razonSocial son obligatorios", 400);
  }
  return withAuditedTransaction("projects.client.create", usuarioId, canal, async (client) => {
    const r = await client.query(
      `INSERT INTO clientes (ruc, razon_social, contacto) VALUES ($1,$2,$3) RETURNING *`,
      [ruc, razonSocial, contacto || null]
    );
    return { entidad: "clientes", entidadId: r.rows[0].cliente_id, valorNuevo: { ruc, razonSocial }, cliente: r.rows[0] };
  });
}

async function listClientes() {
  const r = await pool.query("SELECT * FROM clientes WHERE activo = true ORDER BY razon_social");
  return r.rows;
}

async function listTecnicos() {
  const r = await pool.query(
    "SELECT usuario_id, nombre_completo, rol_codigo FROM usuarios WHERE activo = true ORDER BY nombre_completo"
  );
  return r.rows;
}

// Reporte de rentabilidad (PRD Fase 4): costo real de cada proyecto activo
// (materiales + mano de obra) contra su presupuesto, en una sola consulta
// agregada por proyecto — evita el N+1 de llamar getProyecto() por fila.
// Ordenado por margen ascendente: los proyectos con peor margen (o negativo)
// aparecen primero, para que salten a la vista.
async function getReporteRentabilidad({ estado } = {}) {
  const conditions = ["pr.activo = true"];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`pr.estado = $${params.length}`); }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const r = await pool.query(
    `SELECT pr.proyecto_id, pr.codigo_proyecto, pr.nombre, pr.estado, pr.presupuesto, pr.moneda,
            c.razon_social AS cliente_nombre,
            COALESCE(mat.costo_materiales, 0) AS costo_materiales,
            COALESCE(mo.costo_mano_obra, 0) AS costo_mano_obra,
            COALESCE(mat.costo_materiales, 0) + COALESCE(mo.costo_mano_obra, 0) AS costo_total,
            CASE WHEN pr.presupuesto IS NOT NULL
                 THEN pr.presupuesto - (COALESCE(mat.costo_materiales, 0) + COALESCE(mo.costo_mano_obra, 0))
                 ELSE NULL END AS margen,
            CASE WHEN pr.presupuesto IS NOT NULL AND pr.presupuesto <> 0
                 THEN ROUND((pr.presupuesto - (COALESCE(mat.costo_materiales, 0) + COALESCE(mo.costo_mano_obra, 0))) / pr.presupuesto * 100, 2)
                 ELSE NULL END AS margen_pct
     FROM proyectos pr
     LEFT JOIN clientes c ON c.cliente_id = pr.cliente_id
     LEFT JOIN (
       SELECT m.proyecto_id, SUM(m.cantidad * p.costo_unitario) AS costo_materiales
       FROM movimientos m
       JOIN productos p ON p.producto_id = m.producto_id
       WHERE m.tipo_movimiento = 'SALIDA' AND m.proyecto_id IS NOT NULL
       GROUP BY m.proyecto_id
     ) mat ON mat.proyecto_id = pr.proyecto_id
     LEFT JOIN (
       SELECT proyecto_id, SUM(horas * costo_hora) AS costo_mano_obra
       FROM proyecto_mano_obra
       GROUP BY proyecto_id
     ) mo ON mo.proyecto_id = pr.proyecto_id
     ${where}
     ORDER BY margen ASC NULLS LAST, pr.codigo_proyecto`,
    params
  );

  const totales = r.rows.reduce(
    (acc, row) => ({
      presupuesto: acc.presupuesto + (row.presupuesto != null ? Number(row.presupuesto) : 0),
      costo_total: acc.costo_total + Number(row.costo_total),
      margen: acc.margen + (row.margen != null ? Number(row.margen) : 0),
      con_presupuesto: acc.con_presupuesto + (row.presupuesto != null ? 1 : 0),
    }),
    { presupuesto: 0, costo_total: 0, margen: 0, con_presupuesto: 0 }
  );

  return { items: r.rows, totales };
}

module.exports = {
  crearProyecto, actualizarEstado, registrarManoObra,
  listProyectos, getProyecto, listTecnicos, crearCliente, listClientes, getReporteRentabilidad,
};

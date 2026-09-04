const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const contabilidad = require("./contabilidadService");

const CATEGORIAS_VALIDAS = [
  "COMBUSTIBLE", "VIATICOS", "ALQUILER", "SERVICIOS", "SOFTWARE",
  "MANTENIMIENTO", "HONORARIOS", "REEMBOLSO", "OTROS",
];
const TIPOS_COMPROBANTE_VALIDOS = ["FACTURA", "BOLETA", "RECIBO"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Un gasto opcionalmente ligado a un proyecto entra a su costeo real (junto
// a materiales y mano de obra); uno ligado a un empleado es un reembolso.
// Dispara, best-effort después del commit, el asiento contable automático
// para el evento 'expenses.register' — mismo patrón que Compras y Ventas.
async function registrarGasto({ categoria, descripcion, monto, moneda, fecha, proyectoCodigo, empleadoId, comprobante, usuarioId, canal }) {
  if (!categoria || !CATEGORIAS_VALIDAS.includes(categoria)) {
    throw new AppError("SCHEMA_INVALID", `categoria debe ser una de: ${CATEGORIAS_VALIDAS.join(", ")}`, 400);
  }
  if (!descripcion || !monto || monto <= 0) {
    throw new AppError("SCHEMA_INVALID", "descripcion y monto (>0) son obligatorios", 400);
  }
  if (comprobante && !TIPOS_COMPROBANTE_VALIDOS.includes(comprobante.tipo)) {
    throw new AppError("SCHEMA_INVALID", `el tipo de comprobante debe ser uno de: ${TIPOS_COMPROBANTE_VALIDOS.join(", ")}`, 400);
  }

  const result = await withAuditedTransaction("expenses.register", usuarioId, canal, async (client) => {
    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${proyectoCodigo}' no existe o está inactivo`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }
    if (empleadoId) {
      const emp = await client.query("SELECT empleado_id FROM empleados WHERE empleado_id=$1 AND activo=true", [empleadoId]);
      if (emp.rows.length === 0) throw new AppError("EMPLOYEE_NOT_FOUND", "El empleado indicado no existe o está inactivo", 404);
    }

    const r = await client.query(
      `INSERT INTO gastos (categoria, descripcion, monto, moneda, fecha, proyecto_id, empleado_id, comprobante_tipo, comprobante_serie_numero, registrado_por)
       VALUES ($1,$2,$3,COALESCE($4,'PEN'),COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10) RETURNING *`,
      [categoria, descripcion, monto, moneda || null, fecha || null, proyectoId, empleadoId || null,
        comprobante?.tipo || null, comprobante?.serie_numero || null, usuarioId]
    );
    return { entidad: "gastos", entidadId: r.rows[0].gasto_id, valorNuevo: { categoria, monto }, gasto: r.rows[0] };
  });

  try {
    await contabilidad.generarAsientoAutomatico({
      evento: "expenses.register", monto: Number(result.gasto.monto),
      glosa: `Gasto (${categoria}): ${descripcion}`, origenId: result.gasto.gasto_id,
      usuarioId, canal,
    });
  } catch (err) {
    console.error(`No se pudo generar el asiento automático para el gasto '${descripcion}'`, err);
  }

  return result;
}

async function listGastos({ categoria, proyectoCodigo, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 30, 200);
  const conditions = [];
  const params = [];
  if (categoria) { params.push(categoria); conditions.push(`g.categoria = $${params.length}`); }
  if (proyectoCodigo) { params.push(proyectoCodigo); conditions.push(`pr.codigo_proyecto = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT g.*, pr.codigo_proyecto, e.nombre_completo AS empleado_nombre, COUNT(*) OVER() AS total_count
     FROM gastos g
     LEFT JOIN proyectos pr ON pr.proyecto_id = g.proyecto_id
     LEFT JOIN empleados e ON e.empleado_id = g.empleado_id
     ${where}
     ORDER BY g.fecha DESC, g.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

module.exports = { registrarGasto, listGastos, CATEGORIAS_VALIDAS };

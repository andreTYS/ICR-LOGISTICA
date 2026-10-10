const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const contabilidad = require("./contabilidadService");

// Contraparte de gastosService para el lado de ingresos de caja manuales
// (ICR Finanzas / Caja de Obra): dinero que entra en efectivo o por
// Yape/transferencia sin pasar por un hito de contrato (Proyectos) ni una
// venta de mostrador (Tienda).
const TIPOS_VALIDOS = ["OBRA_PROYECTO", "VENTA", "OTRO"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Igual que registrarGasto: un ingreso opcionalmente ligado a un proyecto no
// entra a su costeo (eso es solo para costos), pero sí queda trazable. Best-
// effort después del commit, el asiento contable automático para el evento
// 'income.register' — mismo patrón que Gastos, Compras y Ventas.
async function registrarIngreso({ tipo, detalle, monto, moneda, fecha, proyectoCodigo, usuarioId, canal }) {
  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    throw new AppError("SCHEMA_INVALID", `tipo debe ser uno de: ${TIPOS_VALIDOS.join(", ")}`, 400);
  }
  if (!detalle || !monto || monto <= 0) {
    throw new AppError("SCHEMA_INVALID", "detalle y monto (>0) son obligatorios", 400);
  }

  const result = await withAuditedTransaction("income.register", usuarioId, canal, async (client) => {
    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${proyectoCodigo}' no existe o está inactivo`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }

    const r = await client.query(
      `INSERT INTO ingresos_caja (tipo, detalle, monto, moneda, fecha, proyecto_id, registrado_por)
       VALUES ($1,$2,$3,COALESCE($4,'PEN'),COALESCE($5,CURRENT_DATE),$6,$7) RETURNING *`,
      [tipo, detalle, monto, moneda || null, fecha || null, proyectoId, usuarioId]
    );
    return { entidad: "ingresos_caja", entidadId: r.rows[0].ingreso_id, valorNuevo: { tipo, monto }, ingreso: r.rows[0] };
  });

  try {
    await contabilidad.generarAsientoAutomatico({
      evento: "income.register", monto: Number(result.ingreso.monto),
      glosa: `Ingreso de caja (${tipo}): ${detalle}`, origenId: result.ingreso.ingreso_id,
      usuarioId, canal,
    });
  } catch (err) {
    console.error(`No se pudo generar el asiento automático para el ingreso '${detalle}'`, err);
  }

  return result;
}

async function listIngresos({ tipo, proyectoCodigo, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 30, 200);
  const conditions = [];
  const params = [];
  if (tipo) { params.push(tipo); conditions.push(`i.tipo = $${params.length}`); }
  if (proyectoCodigo) { params.push(proyectoCodigo); conditions.push(`pr.codigo_proyecto = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT i.*, pr.codigo_proyecto, COUNT(*) OVER() AS total_count
     FROM ingresos_caja i
     LEFT JOIN proyectos pr ON pr.proyecto_id = i.proyecto_id
     ${where}
     ORDER BY i.fecha DESC, i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getIngreso(ingresoId) {
  const r = await pool.query(
    `SELECT i.*, pr.codigo_proyecto
     FROM ingresos_caja i
     LEFT JOIN proyectos pr ON pr.proyecto_id = i.proyecto_id
     WHERE i.ingreso_id = $1`,
    [ingresoId]
  );
  if (r.rows.length === 0) throw new AppError("INCOME_NOT_FOUND", "El ingreso indicado no existe", 404);
  return r.rows[0];
}

module.exports = { registrarIngreso, listIngresos, getIngreso, TIPOS_VALIDOS };

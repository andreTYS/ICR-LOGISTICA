const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const ventas = require("./ventasService");

const ESTADOS_VALIDOS = ["BORRADOR", "ENVIADA", "ACEPTADA", "RECHAZADA", "CONVERTIDA"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

function totalCotizacion(items) {
  return items.reduce((sum, it) => sum + Number(it.cantidad) * Number(it.precio_unitario), 0);
}

// Etapa previa al contrato de Ventas: cotizar antes de que el cliente
// firme. No es CRM — es un documento con ítems que, aceptado, se convierte
// en contrato con un clic.
async function crearCotizacion({ clienteRuc, proyectoCodigo, moneda, fechaEmision, validezDias, items, usuarioId, canal }) {
  if (!clienteRuc || !Array.isArray(items) || items.length === 0) {
    throw new AppError("SCHEMA_INVALID", "clienteRuc y al menos un ítem son obligatorios", 400);
  }
  return withAuditedTransaction("quotes.create", usuarioId, canal, async (client) => {
    const cli = await client.query("SELECT cliente_id FROM clientes WHERE ruc=$1 AND activo=true", [clienteRuc]);
    if (cli.rows.length === 0) throw new AppError("CLIENT_NOT_FOUND", `Cliente con RUC '${clienteRuc}' no existe o está inactivo`, 404);

    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${proyectoCodigo}' no existe o está inactivo`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }

    const numR = await client.query("SELECT 'COT-' || to_char(nextval('cotizacion_numero_seq'), 'FM00000') AS codigo");
    const codigo = numR.rows[0].codigo;

    const r = await client.query(
      `INSERT INTO cotizaciones (codigo, cliente_id, proyecto_id, moneda, fecha_emision, validez_dias, responsable_id)
       VALUES ($1,$2,$3,COALESCE($4,'PEN'),COALESCE($5,CURRENT_DATE),COALESCE($6,15),$7) RETURNING *`,
      [codigo, cli.rows[0].cliente_id, proyectoId, moneda || null, fechaEmision || null, validezDias || null, usuarioId]
    );
    const cotizacion = r.rows[0];

    for (const [i, it] of items.entries()) {
      if (!it.descripcion || !it.cantidad || it.cantidad <= 0 || it.precio_unitario == null || it.precio_unitario < 0) {
        throw new AppError("SCHEMA_INVALID", "cada ítem requiere descripcion, cantidad (>0) y precio_unitario (>=0)", 400);
      }
      await client.query(
        `INSERT INTO cotizacion_items (cotizacion_id, descripcion, cantidad, precio_unitario, orden) VALUES ($1,$2,$3,$4,$5)`,
        [cotizacion.cotizacion_id, it.descripcion, it.cantidad, it.precio_unitario, i + 1]
      );
    }

    return { entidad: "cotizaciones", entidadId: cotizacion.cotizacion_id, valorNuevo: { codigo }, cotizacion };
  });
}

async function actualizarEstado({ codigo, estado, usuarioId, canal }) {
  if (!ESTADOS_VALIDOS.includes(estado) || estado === "CONVERTIDA") {
    throw new AppError("SCHEMA_INVALID", `estado debe ser uno de: BORRADOR, ENVIADA, ACEPTADA, RECHAZADA`, 400);
  }
  return withAuditedTransaction("quotes.update_status", usuarioId, canal, async (client) => {
    const cot = await client.query("SELECT * FROM cotizaciones WHERE codigo=$1 FOR UPDATE", [codigo]);
    if (cot.rows.length === 0) throw new AppError("QUOTE_NOT_FOUND", `Cotización '${codigo}' no existe`, 404);
    if (cot.rows[0].estado === "CONVERTIDA") {
      throw new AppError("QUOTE_ALREADY_CONVERTED", `La cotización '${codigo}' ya fue convertida en contrato`, 400);
    }
    const r = await client.query("UPDATE cotizaciones SET estado=$1 WHERE codigo=$2 RETURNING *", [estado, codigo]);
    return { entidad: "cotizaciones", entidadId: r.rows[0].cotizacion_id, valorNuevo: { estado }, cotizacion: r.rows[0] };
  });
}

// Convierte una cotización ACEPTADA en un contrato de Ventas (monto total =
// suma de ítems, sin hitos todavía — se agregan después con el flujo normal
// de Ventas). Reusa ventasService.crearContrato para no duplicar lógica.
async function convertirAContrato({ codigo, fechaFirma, usuarioId, canal }) {
  const detalle = await getCotizacion(codigo);
  if (detalle.estado !== "ACEPTADA") {
    throw new AppError("QUOTE_NOT_ACCEPTED", `La cotización '${codigo}' debe estar ACEPTADA para convertirse en contrato (estado actual: ${detalle.estado})`, 400);
  }

  const numR = await pool.query("SELECT 'CONT-' || to_char(nextval('contrato_numero_seq'), 'FM00000') AS codigo");
  const codigoContrato = numR.rows[0].codigo;

  const clienteR = await pool.query("SELECT ruc FROM clientes WHERE cliente_id=$1", [detalle.cliente_id]);
  const proyectoR = detalle.proyecto_id ? await pool.query("SELECT codigo_proyecto FROM proyectos WHERE proyecto_id=$1", [detalle.proyecto_id]) : null;

  const resultado = await ventas.crearContrato({
    codigoContrato, clienteRuc: clienteR.rows[0].ruc, proyectoCodigo: proyectoR?.rows[0]?.codigo_proyecto || null,
    montoTotal: detalle.total, moneda: detalle.moneda, fechaFirma: fechaFirma || null,
    usuarioId, canal,
  });

  return withAuditedTransaction("quotes.convert", usuarioId, canal, async (client) => {
    const r = await client.query(
      "UPDATE cotizaciones SET estado='CONVERTIDA', contrato_id=$1 WHERE codigo=$2 RETURNING *",
      [resultado.contrato.contrato_id, codigo]
    );
    return { entidad: "cotizaciones", entidadId: r.rows[0].cotizacion_id, valorNuevo: { estado: "CONVERTIDA", codigoContrato }, cotizacion: r.rows[0], contrato: resultado.contrato };
  });
}

async function listCotizaciones({ estado, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`co.estado = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT co.*, c.razon_social AS cliente_nombre, pr.codigo_proyecto,
            COUNT(*) OVER() AS total_count,
            (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) FROM cotizacion_items WHERE cotizacion_id = co.cotizacion_id) AS total
     FROM cotizaciones co
     LEFT JOIN clientes c ON c.cliente_id = co.cliente_id
     LEFT JOIN proyectos pr ON pr.proyecto_id = co.proyecto_id
     ${where}
     ORDER BY co.fecha_emision DESC, co.codigo DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getCotizacion(codigo) {
  const coR = await pool.query(
    `SELECT co.*, c.razon_social AS cliente_nombre, c.ruc AS cliente_ruc, pr.codigo_proyecto
     FROM cotizaciones co
     LEFT JOIN clientes c ON c.cliente_id = co.cliente_id
     LEFT JOIN proyectos pr ON pr.proyecto_id = co.proyecto_id
     WHERE co.codigo = $1`,
    [codigo]
  );
  if (coR.rows.length === 0) throw new AppError("QUOTE_NOT_FOUND", `Cotización '${codigo}' no existe`, 404);
  const cotizacion = coR.rows[0];

  const itemsR = await pool.query("SELECT * FROM cotizacion_items WHERE cotizacion_id=$1 ORDER BY orden", [cotizacion.cotizacion_id]);
  return { ...cotizacion, items: itemsR.rows, total: totalCotizacion(itemsR.rows) };
}

module.exports = { crearCotizacion, actualizarEstado, convertirAContrato, listCotizaciones, getCotizacion };

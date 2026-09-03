const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const contabilidad = require("./contabilidadService");

const ESTADOS_CONTRATO_VALIDOS = ["BORRADOR", "VIGENTE", "FINALIZADO", "CANCELADO"];
const TIPOS_COMPROBANTE_VALIDOS = ["FACTURA", "BOLETA", "RECIBO"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// -------------------- Comandos --------------------

// Ventas "básicas" (PRD §4.1): un contrato con un cronograma de cobro
// (hitos), no un CRM ni facturación electrónica SUNAT. Los hitos iniciales
// son opcionales — se pueden agregar después con agregarHito().
async function crearContrato({ codigoContrato, clienteRuc, proyectoCodigo, montoTotal, moneda, fechaFirma, responsableId, hitos, usuarioId, canal }) {
  if (!codigoContrato || !clienteRuc || montoTotal == null || montoTotal < 0) {
    throw new AppError("SCHEMA_INVALID", "codigoContrato, clienteRuc y montoTotal (>=0) son obligatorios", 400);
  }
  return withAuditedTransaction("sales.contract.create", usuarioId, canal, async (client) => {
    const cli = await client.query("SELECT cliente_id FROM clientes WHERE ruc=$1 AND activo=true", [clienteRuc]);
    if (cli.rows.length === 0) throw new AppError("CLIENT_NOT_FOUND", `Cliente con RUC '${clienteRuc}' no existe o está inactivo`, 404);

    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${proyectoCodigo}' no existe o está inactivo`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }

    const r = await client.query(
      `INSERT INTO contratos (codigo_contrato, cliente_id, proyecto_id, monto_total, moneda, fecha_firma, responsable_id)
       VALUES ($1,$2,$3,$4,COALESCE($5,'PEN'),COALESCE($6,CURRENT_DATE),$7) RETURNING *`,
      [codigoContrato, cli.rows[0].cliente_id, proyectoId, montoTotal, moneda || null, fechaFirma || null, responsableId || usuarioId]
    );
    const contrato = r.rows[0];

    for (const [i, h] of (hitos || []).entries()) {
      if (!h.descripcion || !h.monto || h.monto <= 0) {
        throw new AppError("SCHEMA_INVALID", "cada hito requiere descripcion y monto (>0)", 400);
      }
      await client.query(
        `INSERT INTO contrato_hitos (contrato_id, descripcion, monto, fecha_esperada, orden) VALUES ($1,$2,$3,$4,$5)`,
        [contrato.contrato_id, h.descripcion, h.monto, h.fecha_esperada || null, i + 1]
      );
    }

    return { entidad: "contratos", entidadId: contrato.contrato_id, valorNuevo: { codigoContrato, montoTotal }, contrato };
  });
}

async function agregarHito({ codigoContrato, descripcion, monto, fechaEsperada, usuarioId, canal }) {
  if (!codigoContrato || !descripcion || !monto || monto <= 0) {
    throw new AppError("SCHEMA_INVALID", "codigoContrato, descripcion y monto (>0) son obligatorios", 400);
  }
  return withAuditedTransaction("sales.milestone.add", usuarioId, canal, async (client) => {
    const cont = await client.query("SELECT contrato_id, estado FROM contratos WHERE codigo_contrato=$1", [codigoContrato]);
    if (cont.rows.length === 0) throw new AppError("CONTRACT_NOT_FOUND", `Contrato '${codigoContrato}' no existe`, 404);
    if (cont.rows[0].estado === "CANCELADO" || cont.rows[0].estado === "FINALIZADO") {
      throw new AppError("CONTRACT_NOT_ACTIVE", `El contrato '${codigoContrato}' está ${cont.rows[0].estado.toLowerCase()}, no admite nuevos hitos`, 400);
    }
    const ordenR = await client.query("SELECT COALESCE(MAX(orden),0) + 1 AS siguiente FROM contrato_hitos WHERE contrato_id=$1", [cont.rows[0].contrato_id]);
    const r = await client.query(
      `INSERT INTO contrato_hitos (contrato_id, descripcion, monto, fecha_esperada, orden) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [cont.rows[0].contrato_id, descripcion, monto, fechaEsperada || null, ordenR.rows[0].siguiente]
    );
    return { entidad: "contrato_hitos", entidadId: r.rows[0].hito_id, valorNuevo: { codigoContrato, descripcion, monto }, hito: r.rows[0] };
  });
}

// Marca un hito como PAGADO, opcionalmente registra el comprobante emitido
// por fuera del sistema, y dispara (best-effort, después del commit) el
// asiento contable automático — mismo patrón que comprasService.recibirOrdenCompra.
async function registrarPagoHito({ codigoContrato, hitoId, fechaPago, montoPagado, comprobante, usuarioId, canal }) {
  if (!codigoContrato || !hitoId) {
    throw new AppError("SCHEMA_INVALID", "codigoContrato y hitoId son obligatorios", 400);
  }
  if (comprobante && !TIPOS_COMPROBANTE_VALIDOS.includes(comprobante.tipo)) {
    throw new AppError("SCHEMA_INVALID", `el tipo de comprobante debe ser uno de: ${TIPOS_COMPROBANTE_VALIDOS.join(", ")}`, 400);
  }

  const result = await withAuditedTransaction("sales.milestone.pay", usuarioId, canal, async (client) => {
    const cont = await client.query("SELECT contrato_id FROM contratos WHERE codigo_contrato=$1", [codigoContrato]);
    if (cont.rows.length === 0) throw new AppError("CONTRACT_NOT_FOUND", `Contrato '${codigoContrato}' no existe`, 404);

    const hitoR = await client.query(
      "SELECT * FROM contrato_hitos WHERE hito_id=$1 AND contrato_id=$2 FOR UPDATE",
      [hitoId, cont.rows[0].contrato_id]
    );
    if (hitoR.rows.length === 0) throw new AppError("MILESTONE_NOT_FOUND", "El hito indicado no existe en este contrato", 404);
    const hito = hitoR.rows[0];
    if (hito.estado === "PAGADO") throw new AppError("MILESTONE_ALREADY_PAID", "Este hito ya fue registrado como pagado", 409);
    if (hito.estado === "ANULADO") throw new AppError("MILESTONE_VOID", "Este hito está anulado, no se puede cobrar", 400);

    const monto = montoPagado != null ? Number(montoPagado) : Number(hito.monto);
    const upd = await client.query(
      `UPDATE contrato_hitos SET estado='PAGADO', fecha_pago=COALESCE($2,CURRENT_DATE), monto_pagado=$3
       WHERE hito_id=$1 RETURNING *`,
      [hitoId, fechaPago || null, monto]
    );

    let comprobanteRow = null;
    if (comprobante) {
      const compR = await client.query(
        `INSERT INTO comprobantes (hito_id, tipo, serie_numero, fecha_emision, monto, registrado_por)
         VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6) RETURNING *`,
        [hitoId, comprobante.tipo, comprobante.serie_numero, comprobante.fecha_emision || null, comprobante.monto ?? monto, usuarioId]
      );
      comprobanteRow = compR.rows[0];
    }

    return {
      entidad: "contrato_hitos", entidadId: hitoId, valorNuevo: { estado: "PAGADO", monto },
      hito: upd.rows[0], comprobante: comprobanteRow, monto_cobrado: monto, descripcion: hito.descripcion,
    };
  });

  try {
    await contabilidad.generarAsientoAutomatico({
      evento: "sales.milestone_paid", monto: result.monto_cobrado,
      glosa: `Cobro de hito "${result.descripcion}" — contrato ${codigoContrato}`, origenId: result.hito.hito_id,
      usuarioId, canal,
    });
  } catch (err) {
    console.error(`No se pudo generar el asiento automático para el cobro del hito del contrato '${codigoContrato}'`, err);
  }

  return result;
}

async function actualizarEstadoContrato({ codigoContrato, estado, usuarioId, canal }) {
  if (!ESTADOS_CONTRATO_VALIDOS.includes(estado)) {
    throw new AppError("SCHEMA_INVALID", `estado debe ser uno de: ${ESTADOS_CONTRATO_VALIDOS.join(", ")}`, 400);
  }
  return withAuditedTransaction("sales.contract.update_status", usuarioId, canal, async (client) => {
    const r = await client.query(
      "UPDATE contratos SET estado=$1 WHERE codigo_contrato=$2 RETURNING *",
      [estado, codigoContrato]
    );
    if (r.rows.length === 0) throw new AppError("CONTRACT_NOT_FOUND", `Contrato '${codigoContrato}' no existe`, 404);
    return { entidad: "contratos", entidadId: r.rows[0].contrato_id, valorNuevo: { estado }, contrato: r.rows[0] };
  });
}

// -------------------- Consultas --------------------

async function listContratos({ estado, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`co.estado = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT co.*, c.razon_social AS cliente_nombre, pr.codigo_proyecto,
            COUNT(*) OVER() AS total_count,
            (SELECT COALESCE(SUM(monto),0) FROM contrato_hitos WHERE contrato_id = co.contrato_id AND estado='PAGADO') AS monto_cobrado
     FROM contratos co
     LEFT JOIN clientes c ON c.cliente_id = co.cliente_id
     LEFT JOIN proyectos pr ON pr.proyecto_id = co.proyecto_id
     ${where}
     ORDER BY co.fecha_firma DESC, co.codigo_contrato DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getContrato(codigoContrato) {
  const coR = await pool.query(
    `SELECT co.*, c.razon_social AS cliente_nombre, c.ruc AS cliente_ruc, pr.codigo_proyecto, u.nombre_completo AS responsable_nombre
     FROM contratos co
     LEFT JOIN clientes c ON c.cliente_id = co.cliente_id
     LEFT JOIN proyectos pr ON pr.proyecto_id = co.proyecto_id
     LEFT JOIN usuarios u ON u.usuario_id = co.responsable_id
     WHERE co.codigo_contrato = $1`,
    [codigoContrato]
  );
  if (coR.rows.length === 0) throw new AppError("CONTRACT_NOT_FOUND", `Contrato '${codigoContrato}' no existe`, 404);
  const contrato = coR.rows[0];

  const hitosR = await pool.query(
    `SELECT h.*, (SELECT json_agg(cp ORDER BY cp.fecha_emision) FROM comprobantes cp WHERE cp.hito_id = h.hito_id) AS comprobantes
     FROM contrato_hitos h WHERE h.contrato_id = $1 ORDER BY h.orden`,
    [contrato.contrato_id]
  );

  const montoCobrado = hitosR.rows.filter((h) => h.estado === "PAGADO").reduce((s, h) => s + Number(h.monto_pagado ?? h.monto), 0);
  return {
    ...contrato,
    hitos: hitosR.rows.map((h) => ({ ...h, comprobantes: h.comprobantes || [] })),
    monto_cobrado: montoCobrado,
    saldo_pendiente: Number(contrato.monto_total) - montoCobrado,
  };
}

// Cuentas por cobrar (PRD §4.1): hitos PENDIENTE/VENCIDO agregados. Antes de
// leer, vence automáticamente los hitos PENDIENTE cuya fecha esperada ya
// pasó — así el estado en base coincide con lo que muestra el reporte sin
// necesitar un cron aparte.
async function listCuentasPorCobrar({ estado } = {}) {
  await pool.query(
    "UPDATE contrato_hitos SET estado='VENCIDO' WHERE estado='PENDIENTE' AND fecha_esperada IS NOT NULL AND fecha_esperada < CURRENT_DATE"
  );

  const conditions = ["h.estado IN ('PENDIENTE','VENCIDO')"];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`h.estado = $${params.length}`); }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const r = await pool.query(
    `SELECT h.hito_id, h.descripcion, h.monto, h.fecha_esperada, h.estado,
            co.codigo_contrato, c.razon_social AS cliente_nombre
     FROM contrato_hitos h
     JOIN contratos co ON co.contrato_id = h.contrato_id
     LEFT JOIN clientes c ON c.cliente_id = co.cliente_id
     ${where}
     ORDER BY h.fecha_esperada ASC NULLS LAST`,
    params
  );

  const totales = r.rows.reduce(
    (acc, row) => ({
      pendiente: acc.pendiente + (row.estado === "PENDIENTE" ? Number(row.monto) : 0),
      vencido: acc.vencido + (row.estado === "VENCIDO" ? Number(row.monto) : 0),
    }),
    { pendiente: 0, vencido: 0 }
  );

  return { items: r.rows, totales };
}

module.exports = {
  crearContrato, agregarHito, registrarPagoHito, actualizarEstadoContrato,
  listContratos, getContrato, listCuentasPorCobrar,
};

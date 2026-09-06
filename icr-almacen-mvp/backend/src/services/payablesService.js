const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const contabilidad = require("./contabilidadService");

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Cuentas por pagar (simétrico a Cuentas por cobrar de Ventas, del lado del
// proveedor): registrar la factura que llega, opcionalmente ligada a una
// orden de compra ya recibida, y sus pagos parciales o totales.
async function registrarFactura({ proveedorRuc, ordenCompraNumero, numeroProveedor, montoTotal, moneda, fechaEmision, fechaVencimiento, usuarioId, canal }) {
  if (!proveedorRuc || montoTotal == null || montoTotal < 0) {
    throw new AppError("SCHEMA_INVALID", "proveedorRuc y montoTotal (>=0) son obligatorios", 400);
  }
  return withAuditedTransaction("payables.invoice.create", usuarioId, canal, async (client) => {
    const prov = await client.query("SELECT proveedor_id FROM proveedores WHERE ruc=$1 AND activo=true", [proveedorRuc]);
    if (prov.rows.length === 0) throw new AppError("SUPPLIER_NOT_FOUND", `Proveedor con RUC '${proveedorRuc}' no existe o está inactivo`, 404);

    let ordenCompraId = null;
    if (ordenCompraNumero) {
      const oc = await client.query("SELECT orden_compra_id FROM ordenes_compra WHERE numero=$1", [ordenCompraNumero]);
      if (oc.rows.length === 0) throw new AppError("PURCHASE_ORDER_NOT_FOUND", `Orden de compra '${ordenCompraNumero}' no existe`, 404);
      ordenCompraId = oc.rows[0].orden_compra_id;
    }

    const numR = await client.query("SELECT 'FP-' || to_char(nextval('factura_proveedor_numero_seq'), 'FM00000') AS codigo");
    const codigo = numR.rows[0].codigo;

    const r = await client.query(
      `INSERT INTO facturas_proveedor (codigo, numero_proveedor, proveedor_id, orden_compra_id, monto_total, moneda, fecha_emision, fecha_vencimiento, registrado_por)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'PEN'),COALESCE($7,CURRENT_DATE),$8,$9) RETURNING *`,
      [codigo, numeroProveedor || null, prov.rows[0].proveedor_id, ordenCompraId, montoTotal, moneda || null, fechaEmision || null, fechaVencimiento || null, usuarioId]
    );
    return { entidad: "facturas_proveedor", entidadId: r.rows[0].factura_proveedor_id, valorNuevo: { codigo, montoTotal }, factura: r.rows[0] };
  });
}

// Registra un pago (parcial o total) contra una factura y recalcula su
// estado. Dispara, best-effort igual que Ventas/Gastos, el asiento
// automático payables.invoice_paid por el monto del pago.
async function registrarPago({ codigo, monto, fechaPago, metodo, usuarioId, canal }) {
  if (!codigo || !monto || monto <= 0) {
    throw new AppError("SCHEMA_INVALID", "codigo y monto (>0) son obligatorios", 400);
  }
  const result = await withAuditedTransaction("payables.invoice.pay", usuarioId, canal, async (client) => {
    const facR = await client.query("SELECT * FROM facturas_proveedor WHERE codigo=$1 FOR UPDATE", [codigo]);
    if (facR.rows.length === 0) throw new AppError("INVOICE_NOT_FOUND", `Factura '${codigo}' no existe`, 404);
    const factura = facR.rows[0];
    if (factura.estado === "PAGADA") throw new AppError("INVOICE_ALREADY_PAID", `La factura '${codigo}' ya está pagada`, 409);
    if (factura.estado === "ANULADA") throw new AppError("INVOICE_VOID", `La factura '${codigo}' está anulada, no admite pagos`, 400);

    const pagoR = await client.query(
      `INSERT INTO pagos_proveedor (factura_proveedor_id, monto, fecha_pago, metodo, registrado_por)
       VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5) RETURNING *`,
      [factura.factura_proveedor_id, monto, fechaPago || null, metodo || null, usuarioId]
    );

    const sumaR = await client.query(
      "SELECT COALESCE(SUM(monto),0) AS pagado FROM pagos_proveedor WHERE factura_proveedor_id=$1",
      [factura.factura_proveedor_id]
    );
    const pagado = Number(sumaR.rows[0].pagado);
    const nuevoEstado = pagado >= Number(factura.monto_total) ? "PAGADA" : "PARCIAL";
    const facUpd = await client.query(
      "UPDATE facturas_proveedor SET estado=$1 WHERE factura_proveedor_id=$2 RETURNING *",
      [nuevoEstado, factura.factura_proveedor_id]
    );

    return {
      entidad: "pagos_proveedor", entidadId: pagoR.rows[0].pago_proveedor_id, valorNuevo: { codigo, monto },
      pago: pagoR.rows[0], factura: facUpd.rows[0], monto_pagado: monto,
    };
  });

  try {
    await contabilidad.generarAsientoAutomatico({
      evento: "payables.invoice_paid", monto: Number(result.monto_pagado),
      glosa: `Pago de factura de proveedor ${codigo}`, origenId: result.pago.pago_proveedor_id,
      usuarioId, canal,
    });
  } catch (err) {
    console.error(`No se pudo generar el asiento automático para el pago de la factura '${codigo}'`, err);
  }

  return result;
}

async function listFacturas({ proveedorRuc, estado, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`f.estado = $${params.length}`); }
  if (proveedorRuc) { params.push(proveedorRuc); conditions.push(`pv.ruc = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT f.*, pv.razon_social AS proveedor_nombre, pv.ruc AS proveedor_ruc, oc.numero AS orden_compra_numero,
            COUNT(*) OVER() AS total_count,
            (SELECT COALESCE(SUM(monto),0) FROM pagos_proveedor WHERE factura_proveedor_id = f.factura_proveedor_id) AS monto_pagado
     FROM facturas_proveedor f
     JOIN proveedores pv ON pv.proveedor_id = f.proveedor_id
     LEFT JOIN ordenes_compra oc ON oc.orden_compra_id = f.orden_compra_id
     ${where}
     ORDER BY f.fecha_emision DESC, f.codigo DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getFactura(codigo) {
  const facR = await pool.query(
    `SELECT f.*, pv.razon_social AS proveedor_nombre, pv.ruc AS proveedor_ruc, oc.numero AS orden_compra_numero
     FROM facturas_proveedor f
     JOIN proveedores pv ON pv.proveedor_id = f.proveedor_id
     LEFT JOIN ordenes_compra oc ON oc.orden_compra_id = f.orden_compra_id
     WHERE f.codigo = $1`,
    [codigo]
  );
  if (facR.rows.length === 0) throw new AppError("INVOICE_NOT_FOUND", `Factura '${codigo}' no existe`, 404);
  const factura = facR.rows[0];

  const pagosR = await pool.query(
    "SELECT * FROM pagos_proveedor WHERE factura_proveedor_id=$1 ORDER BY fecha_pago DESC, created_at DESC",
    [factura.factura_proveedor_id]
  );
  const montoPagado = pagosR.rows.reduce((s, p) => s + Number(p.monto), 0);
  return { ...factura, pagos: pagosR.rows, monto_pagado: montoPagado, saldo_pendiente: Number(factura.monto_total) - montoPagado };
}

// Cuentas por pagar: facturas PENDIENTE/PARCIAL/VENCIDA agregadas. Vence
// automáticamente las PENDIENTE/PARCIAL cuya fecha de vencimiento ya pasó,
// mismo criterio que usa Ventas para sus cuentas por cobrar.
async function listCuentasPorPagar({ estado } = {}) {
  await pool.query(
    `UPDATE facturas_proveedor SET estado='VENCIDA'
     WHERE estado IN ('PENDIENTE','PARCIAL') AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURRENT_DATE`
  );

  const conditions = ["f.estado IN ('PENDIENTE','PARCIAL','VENCIDA')"];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`f.estado = $${params.length}`); }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const r = await pool.query(
    `SELECT f.codigo, f.monto_total, f.fecha_vencimiento, f.estado,
            pv.razon_social AS proveedor_nombre,
            COALESCE((SELECT SUM(monto) FROM pagos_proveedor WHERE factura_proveedor_id = f.factura_proveedor_id), 0) AS monto_pagado
     FROM facturas_proveedor f
     JOIN proveedores pv ON pv.proveedor_id = f.proveedor_id
     ${where}
     ORDER BY f.fecha_vencimiento ASC NULLS LAST`,
    params
  );

  const items = r.rows.map((row) => ({ ...row, saldo_pendiente: Number(row.monto_total) - Number(row.monto_pagado) }));
  const totales = items.reduce(
    (acc, row) => ({
      pendiente: acc.pendiente + (row.estado !== "VENCIDA" ? row.saldo_pendiente : 0),
      vencido: acc.vencido + (row.estado === "VENCIDA" ? row.saldo_pendiente : 0),
    }),
    { pendiente: 0, vencido: 0 }
  );

  return { items, totales };
}

module.exports = { registrarFactura, registrarPago, listFacturas, getFactura, listCuentasPorPagar };

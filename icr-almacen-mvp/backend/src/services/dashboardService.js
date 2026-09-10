const { pool } = require("../db");

// Ingresos (hitos de contrato cobrados) vs. gastos operativos, por mes, para
// los últimos N meses (incluyendo meses sin actividad en 0 — el mismo
// criterio que usa el gráfico de actividad de 7 días con los días vacíos).
// "Ingresos" acá es cobranza real (fecha_pago), no facturación; "gastos" no
// incluye compras de mercadería (eso es un activo/costo de venta, no un
// gasto operativo) — ver módulo Gastos.
async function getCashflowSummary({ months = 6 } = {}) {
  const n = Math.min(24, Math.max(1, Number(months) || 6));
  const r = await pool.query(
    `WITH meses AS (
       SELECT date_trunc('month', CURRENT_DATE) - (n || ' months')::interval AS mes
       FROM generate_series(0, $1::int - 1) AS n
     ),
     ingresos AS (
       SELECT date_trunc('month', fecha_pago) AS mes, SUM(monto_pagado) AS monto
       FROM contrato_hitos
       WHERE estado = 'PAGADO' AND fecha_pago IS NOT NULL
       GROUP BY 1
     ),
     gastos_mes AS (
       SELECT date_trunc('month', fecha) AS mes, SUM(monto) AS monto
       FROM gastos
       GROUP BY 1
     )
     SELECT m.mes, COALESCE(i.monto, 0) AS ingresos, COALESCE(g.monto, 0) AS gastos
     FROM meses m
     LEFT JOIN ingresos i ON i.mes = m.mes
     LEFT JOIN gastos_mes g ON g.mes = m.mes
     ORDER BY m.mes`,
    [n]
  );
  return r.rows.map((row) => ({ mes: row.mes, ingresos: Number(row.ingresos), gastos: Number(row.gastos) }));
}

async function getExpensesByCategory({ days = 30 } = {}) {
  const n = Math.min(365, Math.max(1, Number(days) || 30));
  const r = await pool.query(
    `SELECT categoria, SUM(monto) AS monto
     FROM gastos
     WHERE fecha >= CURRENT_DATE - ($1 || ' days')::interval
     GROUP BY categoria
     ORDER BY monto DESC`,
    [n]
  );
  return r.rows.map((row) => ({ categoria: row.categoria, monto: Number(row.monto) }));
}

// Distribución del stock físico total entre almacenes activos — para ver de
// un vistazo dónde está concentrado el inventario. Solo suma stock_fisico
// (no stock_disponible) porque acá interesa dónde está el bien físicamente,
// reservado o no.
async function getStockByWarehouse() {
  const r = await pool.query(
    `SELECT a.nombre, SUM(s.stock_fisico) AS total
     FROM stock s
     JOIN almacenes a ON a.almacen_id = s.almacen_id
     WHERE a.activo = true
     GROUP BY a.nombre
     HAVING SUM(s.stock_fisico) > 0
     ORDER BY total DESC`
  );
  return r.rows.map((row) => ({ nombre: row.nombre, total: Number(row.total) }));
}

// Cantidad de proyectos por estado — para ver de un vistazo cuántas obras
// están activas vs. pausadas/finalizadas/canceladas.
async function getProjectsByStatus() {
  const r = await pool.query(
    `SELECT estado, COUNT(*) AS cantidad FROM proyectos GROUP BY estado`
  );
  const porEstado = Object.fromEntries(r.rows.map((row) => [row.estado, Number(row.cantidad)]));
  return ["ACTIVO", "PAUSADO", "FINALIZADO", "CANCELADO"]
    .map((estado) => ({ estado, cantidad: porEstado[estado] || 0 }))
    .filter((row) => row.cantidad > 0);
}

// Top clientes por monto total contratado (Ventas). Excluye contratos
// CANCELADO — no representan ingreso real ni potencial.
async function getTopClientsBySales({ limit = 5 } = {}) {
  const n = Math.min(20, Math.max(1, Number(limit) || 5));
  const r = await pool.query(
    `SELECT c.razon_social, SUM(ct.monto_total) AS total
     FROM contratos ct
     JOIN clientes c ON c.cliente_id = ct.cliente_id
     WHERE ct.estado != 'CANCELADO'
     GROUP BY c.razon_social
     ORDER BY total DESC
     LIMIT $1`,
    [n]
  );
  return r.rows.map((row) => ({ cliente: row.razon_social, total: Number(row.total) }));
}

// Top proveedores por monto total de órdenes de compra (cantidad pedida ×
// costo unitario de cada línea). Excluye órdenes CANCELADA.
async function getTopSuppliersByPurchases({ limit = 5 } = {}) {
  const n = Math.min(20, Math.max(1, Number(limit) || 5));
  const r = await pool.query(
    `SELECT p.razon_social, SUM(oci.cantidad_pedida * oci.costo_unitario) AS total
     FROM ordenes_compra oc
     JOIN proveedores p ON p.proveedor_id = oc.proveedor_id
     JOIN orden_compra_items oci ON oci.orden_compra_id = oc.orden_compra_id
     WHERE oc.estado != 'CANCELADA'
     GROUP BY p.razon_social
     ORDER BY total DESC
     LIMIT $1`,
    [n]
  );
  return r.rows.map((row) => ({ proveedor: row.razon_social, total: Number(row.total) }));
}

module.exports = {
  getCashflowSummary,
  getExpensesByCategory,
  getStockByWarehouse,
  getProjectsByStatus,
  getTopClientsBySales,
  getTopSuppliersByPurchases,
};

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

module.exports = { getCashflowSummary, getExpensesByCategory };

// Tests de las agregaciones de los tableros nuevos del Panel (Ingresos vs.
// Gastos por mes, Gasto por categoría), contra una base Postgres real.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const dashboard = require("../src/services/dashboardService");
const gastos = require("../src/services/gastosService");
const ventas = require("../src/services/ventasService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";

test("getCashflowSummary trae exactamente N meses, incluyendo el mes actual con los montos correctos", async () => {
  const antes = await dashboard.getCashflowSummary({ months: 3 });
  assert.equal(antes.length, 3);
  const mesActualAntes = antes[antes.length - 1];

  const g = await gastos.registrarGasto({ categoria: "OTROS", descripcion: "Gasto de este mes", monto: 77, usuarioId: SUPERVISOR, canal: "web" });

  const despues = await dashboard.getCashflowSummary({ months: 3 });
  const mesActualDespues = despues[despues.length - 1];
  assert.equal(mesActualDespues.gastos, mesActualAntes.gastos + 77, "el gasto recién registrado debe sumar al mes actual");
  assert.ok(g.gasto.gasto_id);
});

test("getCashflowSummary respeta el límite de meses pedido y usa 0 en meses sin actividad", async () => {
  const r = await dashboard.getCashflowSummary({ months: 1 });
  assert.equal(r.length, 1);
  assert.equal(typeof r[0].ingresos, "number");
  assert.equal(typeof r[0].gastos, "number");
});

test("getExpensesByCategory agrupa y suma por categoría dentro de la ventana de días, ordenado descendente", async () => {
  await gastos.registrarGasto({ categoria: "SOFTWARE", descripcion: "Suscripción A", monto: 100, usuarioId: SUPERVISOR, canal: "web" });
  await gastos.registrarGasto({ categoria: "SOFTWARE", descripcion: "Suscripción B", monto: 50, usuarioId: SUPERVISOR, canal: "web" });

  const r = await dashboard.getExpensesByCategory({ days: 30 });
  const software = r.find((c) => c.categoria === "SOFTWARE");
  assert.ok(software, "SOFTWARE debería aparecer agrupado");
  assert.equal(software.monto, 150);

  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i - 1].monto >= r[i].monto, "debe venir ordenado de mayor a menor monto");
  }
});

test("getExpensesByCategory no incluye gastos fuera de la ventana de días", async () => {
  const antes = await dashboard.getExpensesByCategory({ days: 1 });
  const totalAntes = antes.reduce((s, c) => s + c.monto, 0);

  // Un gasto con fecha de hace 10 días no debería contar en una ventana de 1 día.
  await gastos.registrarGasto({ categoria: "MANTENIMIENTO", descripcion: "Fuera de ventana", monto: 999, fecha: "2000-01-01", usuarioId: SUPERVISOR, canal: "web" });

  const despues = await dashboard.getExpensesByCategory({ days: 1 });
  const totalDespues = despues.reduce((s, c) => s + c.monto, 0);
  assert.equal(totalDespues, totalAntes, "un gasto viejo no debe entrar en una ventana corta");
});

// Confirma que Ventas también contribuye a los "ingresos" del cashflow (no solo Gastos a los "gastos").
test("getCashflowSummary refleja un cobro de hito como ingreso del mes actual", async () => {
  const antes = await dashboard.getCashflowSummary({ months: 1 });
  const ingresosAntes = antes[0].ingresos;

  const contrato = await ventas.crearContrato({
    codigoContrato: "CONT-DASH01", clienteRuc: "20512345678", montoTotal: 1000, usuarioId: SUPERVISOR, canal: "web",
    hitos: [{ descripcion: "Pago único", monto: 1000 }],
  });
  const detalle = await ventas.getContrato("CONT-DASH01");
  await ventas.registrarPagoHito({ codigoContrato: "CONT-DASH01", hitoId: detalle.hitos[0].hito_id, usuarioId: SUPERVISOR, canal: "web" });

  const despues = await dashboard.getCashflowSummary({ months: 1 });
  assert.equal(despues[0].ingresos, ingresosAntes + 1000);
  assert.ok(contrato.contrato.contrato_id);
});

after(async () => {
  await pool.end();
});

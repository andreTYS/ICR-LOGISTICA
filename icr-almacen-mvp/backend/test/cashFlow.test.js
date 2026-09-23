// Tests de integración de getFlujoCaja: control de caja real (no devengado)
// que junta las dos fuentes de ingreso — cobros de hitos de contrato
// (Proyectos) y ventas de Tienda — contra los dos tipos de egreso — gastos
// operativos y pagos a proveedor — agrupado por semana o mes.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const contabilidad = require("../src/services/contabilidadService");
const ventas = require("../src/services/ventasService");
const tienda = require("../src/services/tiendaService");
const gastos = require("../src/services/gastosService");
const payables = require("../src/services/payablesService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)
const PROVEEDOR_RUC = "20100047218"; // JA Solar Perú Distribuidora S.A.C. (seed.sql)
const HOY = new Date().toISOString().slice(0, 10);

test("getFlujoCaja suma ingresos de proyectos y tienda, y egresos de gastos y pagos a proveedor, en el mismo período", async () => {
  // Ingreso 1: cobro de un hito de contrato (Proyectos)
  await ventas.crearContrato({
    codigoContrato: "CONT-CF01", clienteRuc: CLIENTE_RUC, montoTotal: 3000, usuarioId: SUPERVISOR, canal: "web",
    hitos: [{ descripcion: "Pago único", monto: 3000, fecha_esperada: null }],
  });
  const contratoDetalle = await ventas.getContrato("CONT-CF01");
  await ventas.registrarPagoHito({
    codigoContrato: "CONT-CF01", hitoId: contratoDetalle.hitos[0].hito_id, montoPagado: 3000,
    usuarioId: SUPERVISOR, canal: "web",
  });

  // Ingreso 2: venta directa de tienda (sin proyecto)
  await tienda.registrarVenta({
    descripcion: "Multímetro de mostrador", cantidad: 1, precioUnitario: 500,
    usuarioId: SUPERVISOR, canal: "web",
  });

  // Egreso 1: gasto operativo
  await gastos.registrarGasto({
    categoria: "COMBUSTIBLE", descripcion: "Movilidad a obra", monto: 150,
    usuarioId: SUPERVISOR, canal: "web",
  });

  // Egreso 2: pago a proveedor
  const factura = await payables.registrarFactura({
    proveedorRuc: PROVEEDOR_RUC, montoTotal: 800, usuarioId: SUPERVISOR, canal: "web",
  });
  await payables.registrarPago({ codigo: factura.factura.codigo, monto: 800, usuarioId: SUPERVISOR, canal: "web" });

  const flujo = await contabilidad.getFlujoCaja({ fechaDesde: HOY, fechaHasta: HOY, agrupacion: "semana" });
  assert.equal(flujo.items.length, 1, "todos los movimientos de hoy caen en un único período");
  const periodo = flujo.items[0];
  assert.equal(periodo.ingresos_proyectos, 3000);
  assert.equal(periodo.ingresos_tienda, 500);
  assert.equal(periodo.ingresos_total, 3500);
  assert.equal(periodo.egresos_gastos, 150);
  assert.equal(periodo.egresos_compras, 800);
  assert.equal(periodo.egresos_total, 950);
  assert.equal(periodo.neto, 3500 - 950);

  assert.equal(flujo.totales.ingresos_total, 3500);
  assert.equal(flujo.totales.egresos_total, 950);
  assert.equal(flujo.totales.neto, 3500 - 950);
});

test("getFlujoCaja agrupado por mes junta todo el rango en un solo período", async () => {
  const flujo = await contabilidad.getFlujoCaja({ fechaDesde: "2020-01-01", fechaHasta: HOY, agrupacion: "mes" });
  assert.equal(flujo.agrupacion, "mes");
  assert.ok(flujo.items.length >= 1);
  assert.ok(flujo.totales.ingresos_total >= 3500);
});

test("getFlujoCaja fuera de rango de fechas no trae nada", async () => {
  const flujo = await contabilidad.getFlujoCaja({ fechaDesde: "2000-01-01", fechaHasta: "2000-01-31", agrupacion: "semana" });
  assert.equal(flujo.items.length, 0);
  assert.equal(flujo.totales.neto, 0);
});

after(async () => {
  await pool.end();
});

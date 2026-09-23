// Tests de integración de tiendaService: segunda fuente de ingresos, venta
// directa de equipos sin proyecto ni cronograma de cobro. Mismo enfoque que
// el resto de la suite (Postgres real, no mocks).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const inventory = require("../src/services/inventoryService");
const tienda = require("../src/services/tiendaService");
const contabilidad = require("../src/services/contabilidadService");

const VENTAS_USER = "00000000-0000-0000-0000-000000000005";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)

async function stockOf(sku, warehouseCode) {
  const { items } = await inventory.getStock({ sku, warehouseCode });
  return items[0];
}

test("registrar una venta libre (sin sku) no descuenta stock y genera código VT-", async () => {
  const r = await tienda.registrarVenta({
    descripcion: "Instalación de accesorios varios", cantidad: 2, precioUnitario: 45,
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.match(r.venta.codigo, /^VT-\d{5}$/);
  assert.equal(Number(r.venta.monto_total), 90);
  assert.equal(r.venta.producto_id, null);
  assert.equal(r.venta.movimiento_id, null);
});

test("registrar una venta con sku descuenta stock real y la liga a un movimiento SALIDA", async () => {
  await inventory.receive({ sku: "HERR-MULTIMETRO", quantity: 5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  const antes = await stockOf("HERR-MULTIMETRO", "ALM-001");

  const r = await tienda.registrarVenta({
    sku: "HERR-MULTIMETRO", warehouseCode: "ALM-001", descripcion: "Multímetro Fluke CL120", cantidad: 1, precioUnitario: 250,
    clienteRuc: CLIENTE_RUC, usuarioId: VENTAS_USER, canal: "web",
  });
  assert.ok(r.venta.producto_id);
  assert.ok(r.venta.movimiento_id);
  assert.ok(r.venta.cliente_id);

  const despues = await stockOf("HERR-MULTIMETRO", "ALM-001");
  assert.equal(Number(despues.stock_fisico), Number(antes.stock_fisico) - 1);

  const movimiento = await pool.query("SELECT tipo_movimiento FROM movimientos WHERE movimiento_id=$1", [r.venta.movimiento_id]);
  assert.equal(movimiento.rows[0].tipo_movimiento, "SALIDA");
});

test("registrar una venta con sku pero sin stock suficiente se rechaza y no crea la venta", async () => {
  await assert.rejects(
    tienda.registrarVenta({
      sku: "HERR-MULTIMETRO", warehouseCode: "ALM-001", descripcion: "Multímetro", cantidad: 9999, precioUnitario: 250,
      usuarioId: VENTAS_USER, canal: "web",
    }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
  const ventas = await tienda.listVentas({});
  assert.equal(ventas.items.length, 2, "la venta rechazada no debe quedar registrada");
});

test("sku sin warehouseCode (o viceversa) se rechaza", async () => {
  await assert.rejects(
    tienda.registrarVenta({ sku: "HERR-MULTIMETRO", descripcion: "X", cantidad: 1, precioUnitario: 10, usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un cliente con RUC/DNI inexistente se rechaza", async () => {
  await assert.rejects(
    tienda.registrarVenta({ descripcion: "X", cantidad: 1, precioUnitario: 10, clienteRuc: "99999999999", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "CLIENT_NOT_FOUND"
  );
});

test("listVentas pagina y filtra por rango de fechas", async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await tienda.listVentas({ desde: hoy, hasta: hoy });
  assert.ok(r.items.length >= 2);
  assert.equal(typeof r.total, "number");

  const futuro = await tienda.listVentas({ desde: "2099-01-01", hasta: "2099-12-31" });
  assert.equal(futuro.items.length, 0);
});

test("una venta registrada genera un asiento automático en BORRADOR", async () => {
  const asientos = await contabilidad.listAsientos({ estado: "BORRADOR" });
  const generado = asientos.items.find((a) => a.origen_evento === "store.sale.registered");
  assert.ok(generado, "debería existir un asiento generado automáticamente para la venta de tienda");
});

after(async () => {
  await pool.end();
});

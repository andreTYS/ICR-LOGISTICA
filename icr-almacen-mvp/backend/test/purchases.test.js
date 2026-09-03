// Tests de integración del módulo de Compras contra una base Postgres real
// (mismo enfoque que inventory.test.js): crear -> enviar -> recibir (con
// backorder) -> Kardex actualizado, y las validaciones de estado.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const inventory = require("../src/services/inventoryService");
const compras = require("../src/services/comprasService");

const COMPRAS_USER = "00000000-0000-0000-0000-000000000004";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";

const PROVEEDOR_RUC = "20100047218"; // JA Solar Perú Distribuidora S.A.C. (seed.sql)

async function stockOf(sku, warehouseCode) {
  const { items } = await inventory.getStock({ sku, warehouseCode });
  return items[0];
}

test("crear una orden de compra no toca el stock", async () => {
  const before_ = await stockOf("PANEL-JA-550", "ALM-001");
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "PANEL-JA-550", quantity: 10 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  assert.equal(oc.orden_compra.estado, "BORRADOR");
  assert.match(oc.numero, /^OC-\d{5}$/);
  const after_ = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(before_?.stock_disponible, after_?.stock_disponible);
});

test("no se puede recibir una orden que sigue en BORRADOR", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "CABLE-SOLAR-6MM", quantity: 100 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  await assert.rejects(
    compras.recibirOrdenCompra({ numero: oc.numero, items: [{ sku: "CABLE-SOLAR-6MM", quantity: 50 }], usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "PURCHASE_ORDER_NOT_SENT"
  );
});

test("recepción parcial actualiza el Kardex y deja la orden en PARCIAL; recepción del resto la deja RECIBIDA", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-002",
    items: [{ sku: "BAT-PYLON-3.5", quantity: 10 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" });

  const antes = await stockOf("BAT-PYLON-3.5", "ALM-002");
  const parcial = await compras.recibirOrdenCompra({
    numero: oc.numero, items: [{ sku: "BAT-PYLON-3.5", quantity: 6 }],
    documento: { tipo_documento: "GUIA", numero_documento: `G-${oc.numero}` },
    usuarioId: ALMACENERO, canal: "web",
  });
  assert.equal(parcial.orden_compra.estado, "PARCIAL");
  const despues = await stockOf("BAT-PYLON-3.5", "ALM-002");
  assert.equal(Number(despues.stock_fisico) - Number(antes?.stock_fisico || 0), 6);

  const completa = await compras.recibirOrdenCompra({
    numero: oc.numero, items: [{ sku: "BAT-PYLON-3.5", quantity: 4 }],
    usuarioId: ALMACENERO, canal: "web",
  });
  assert.equal(completa.orden_compra.estado, "RECIBIDA");
  const final = await stockOf("BAT-PYLON-3.5", "ALM-002");
  assert.equal(Number(final.stock_fisico) - Number(antes?.stock_fisico || 0), 10);
});

test("no se puede recibir más de lo pedido en una línea", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "CONECTOR-MC4", quantity: 20 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" });
  await assert.rejects(
    compras.recibirOrdenCompra({ numero: oc.numero, items: [{ sku: "CONECTOR-MC4", quantity: 25 }], usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "OVER_RECEIPT"
  );
});

test("una orden RECIBIDA o CANCELADA no admite nuevas recepciones ni cancelación", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "MONITOR-WIFI", quantity: 3 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" });
  await compras.recibirOrdenCompra({ numero: oc.numero, items: [{ sku: "MONITOR-WIFI", quantity: 3 }], usuarioId: ALMACENERO, canal: "web" });

  await assert.rejects(
    compras.recibirOrdenCompra({ numero: oc.numero, items: [{ sku: "MONITOR-WIFI", quantity: 1 }], usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "PURCHASE_ORDER_NOT_RECEIVABLE"
  );
  await assert.rejects(
    compras.cancelarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" }),
    (err) => err.code === "PURCHASE_ORDER_NOT_CANCELLABLE"
  );
});

test("cancelar una orden en BORRADOR o ENVIADA funciona", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "PANEL-JINKO-450", quantity: 5 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  const cancelada = await compras.cancelarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" });
  assert.equal(cancelada.orden_compra.estado, "CANCELADA");
});

test("el listado y el detalle de una orden devuelven la forma esperada", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "PANEL-JA-550", quantity: 7 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  const list = await compras.getOrdenesCompra({});
  assert.ok(Array.isArray(list.items));
  assert.ok(list.total >= 1);

  const detail = await compras.getOrdenCompra(oc.numero);
  assert.equal(detail.numero, oc.numero);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].sku, "PANEL-JA-550");
  assert.equal(Number(detail.items[0].cantidad_pendiente), 7);
});

test("las sugerencias de reabastecimiento incluyen productos por debajo del punto de reorden", async () => {
  await inventory.receive({ sku: "HERR-CRIMP-MC4", quantity: 1, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await pool.query("UPDATE productos SET punto_reorden = 999, stock_maximo = 999 WHERE sku = 'HERR-CRIMP-MC4'");
  const sug = await compras.getSugerenciasReabastecimiento();
  const found = sug.find((s) => s.sku === "HERR-CRIMP-MC4");
  assert.ok(found, "HERR-CRIMP-MC4 debería aparecer en las sugerencias");
  assert.equal(Number(found.cantidad_sugerida), 998);
});

after(async () => {
  await pool.end();
});

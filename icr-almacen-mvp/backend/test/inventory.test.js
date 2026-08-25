// Tests de integración contra una base Postgres real (no mocks): la lógica
// de negocio vive en transacciones con locking (ver inventoryService.js) y
// eso es justamente lo que un mock no puede validar. Requiere Postgres
// accesible con las credenciales PG* de siempre; ver README para correrlos.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const inventory = require("../src/services/inventoryService");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";
const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const VENTAS = "00000000-0000-0000-0000-000000000005";

async function stockOf(sku, warehouseCode) {
  const { items } = await inventory.getStock({ sku, warehouseCode });
  return items[0];
}

// -------------------- Los 5 casos de aceptación del PRD --------------------

test("consultar stock devuelve la forma paginada esperada", async () => {
  const r = await inventory.getStock({});
  assert.ok(Array.isArray(r.items));
  assert.equal(typeof r.total, "number");
  assert.equal(typeof r.page, "number");
});

test("ingresar stock incrementa stock_fisico", async () => {
  const r = await inventory.receive({
    sku: "PANEL-JA-550", quantity: 10, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web",
  });
  assert.equal(r.stock.stock_fisico, "10.00");
  const s = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(s.stock_disponible, "10.00");
});

test("retirar stock decrementa stock_fisico", async () => {
  await inventory.remove({
    sku: "PANEL-JA-550", quantity: 4, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web",
  });
  const s = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(s.stock_disponible, "6.00");
});

test("retiro rechazado por stock insuficiente no toca el stock", async () => {
  await assert.rejects(
    inventory.remove({ sku: "PANEL-JA-550", quantity: 9999, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
  const s = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(s.stock_disponible, "6.00", "el stock no debe cambiar cuando el retiro se rechaza");
});

test("transferencia atómica: el origen baja y el destino sube exactamente lo mismo", async () => {
  await inventory.transfer({
    sku: "PANEL-JA-550", quantity: 5, fromWarehouseCode: "ALM-001", toWarehouseCode: "ALM-002", usuarioId: ALMACENERO, canal: "web",
  });
  const origen = await stockOf("PANEL-JA-550", "ALM-001");
  const destino = await stockOf("PANEL-JA-550", "ALM-002");
  assert.equal(origen.stock_disponible, "1.00");
  assert.equal(destino.stock_disponible, "5.00");
});

// -------------------- Reservas --------------------

test("reservar aparta stock (sube reservado, baja disponible) sin tocar el físico", async () => {
  await inventory.receive({ sku: "BAT-PYLON-3.5", quantity: 20, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.reserve({ sku: "BAT-PYLON-3.5", quantity: 6, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  const s = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(s.stock_fisico, "20.00");
  assert.equal(s.stock_reservado, "6.00");
  assert.equal(s.stock_disponible, "14.00");
});

test("liberar una reserva devuelve el stock a disponible", async () => {
  const created = await inventory.reserve({ sku: "BAT-PYLON-3.5", quantity: 3, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  await inventory.releaseReservation({ reservaId: created.reserva_id, usuarioId: VENTAS, canal: "web" });
  const reservations = await inventory.getReservations({});
  const found = reservations.find((r) => r.reserva_id === created.reserva_id);
  assert.equal(found.estado, "CANCELADA");
});

test("reservar más de lo disponible se rechaza", async () => {
  await assert.rejects(
    inventory.reserve({ sku: "BAT-PYLON-3.5", quantity: 9999, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
});

// -------------------- Ajustes con aprobación --------------------

test("un ajuste queda PENDIENTE y no toca el stock hasta que se aprueba", async () => {
  const before_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  const adj = await inventory.adjustCreate({
    sku: "BAT-PYLON-3.5", warehouseCode: "ALM-001", cantidadFisica: 5, motivo: "test", usuarioId: ALMACENERO, canal: "web",
  });
  const mid = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(mid.stock_fisico, before_.stock_fisico, "el stock no cambia hasta aprobar");

  await inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "APROBADO", aprobadoPor: SUPERVISOR, canal: "web" });
  const after_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(after_.stock_fisico, "5.00");
});

test("rechazar un ajuste lo descarta sin tocar el stock", async () => {
  const before_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  const adj = await inventory.adjustCreate({
    sku: "BAT-PYLON-3.5", warehouseCode: "ALM-001", cantidadFisica: 999, motivo: "test", usuarioId: ALMACENERO, canal: "web",
  });
  await inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "RECHAZADO", aprobadoPor: SUPERVISOR, canal: "web" });
  const after_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(after_.stock_fisico, before_.stock_fisico);
});

test("no se puede decidir dos veces el mismo ajuste", async () => {
  const adj = await inventory.adjustCreate({
    sku: "BAT-PYLON-3.5", warehouseCode: "ALM-001", cantidadFisica: 1, motivo: "test", usuarioId: ALMACENERO, canal: "web",
  });
  await inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "APROBADO", aprobadoPor: SUPERVISOR, canal: "web" });
  await assert.rejects(
    inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "APROBADO", aprobadoPor: SUPERVISOR, canal: "web" }),
    (err) => err.code === "ADJUSTMENT_NOT_PENDING"
  );
});

// -------------------- Kits --------------------

test("agregar un item convierte el producto en kit; quitar el último lo revierte", async () => {
  await inventory.addKitItem({ kitSku: "ESTRUCTURA-TECHO", itemSku: "CONECTOR-MC4", quantity: 4 });
  let items = await inventory.getKitItems("ESTRUCTURA-TECHO");
  assert.equal(items.length, 1);
  assert.equal(items[0].sku, "CONECTOR-MC4");

  await inventory.removeKitItem({ kitSku: "ESTRUCTURA-TECHO", itemSku: "CONECTOR-MC4" });
  items = await inventory.getKitItems("ESTRUCTURA-TECHO");
  assert.equal(items.length, 0);
});

test("no se admiten kits anidados", async () => {
  await inventory.addKitItem({ kitSku: "ESTRUCTURA-TECHO", itemSku: "CONECTOR-MC4", quantity: 4 });
  await assert.rejects(
    inventory.addKitItem({ kitSku: "PANEL-JA-550", itemSku: "ESTRUCTURA-TECHO", quantity: 1 }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

after(async () => {
  await pool.end();
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { can } = require("../src/auth");

test("ADMIN tiene acceso a cualquier comando (wildcard)", () => {
  assert.equal(can("ADMIN", "inventory.receive"), true);
  assert.equal(can("ADMIN", "users.manage"), true);
  assert.equal(can("ADMIN", "algo.que.no.existe"), true);
});

test("CONSULTA solo puede consultar, no escribir", () => {
  assert.equal(can("CONSULTA", "inventory.stock.get"), true);
  assert.equal(can("CONSULTA", "inventory.query"), true);
  assert.equal(can("CONSULTA", "inventory.receive"), false);
  assert.equal(can("CONSULTA", "inventory.remove"), false);
  assert.equal(can("CONSULTA", "users.manage"), false);
});

test("ALMACENERO puede operar movimientos pero no aprobar ajustes ni gestionar usuarios", () => {
  assert.equal(can("ALMACENERO", "inventory.receive"), true);
  assert.equal(can("ALMACENERO", "inventory.remove"), true);
  assert.equal(can("ALMACENERO", "inventory.transfer"), true);
  assert.equal(can("ALMACENERO", "inventory.adjust.approve"), false);
  assert.equal(can("ALMACENERO", "users.manage"), false);
  assert.equal(can("ALMACENERO", "settings.manage"), false);
});

test("SUPERVISOR puede aprobar ajustes y ver auditoría, pero no gestionar usuarios", () => {
  assert.equal(can("SUPERVISOR", "inventory.adjust.approve"), true);
  assert.equal(can("SUPERVISOR", "inventory.audit.get"), true);
  assert.equal(can("SUPERVISOR", "users.manage"), false);
});

test("VENTAS puede reservar/liberar pero no ingresar ni retirar stock", () => {
  assert.equal(can("VENTAS", "inventory.reserve"), true);
  assert.equal(can("VENTAS", "inventory.release_reservation"), true);
  assert.equal(can("VENTAS", "inventory.receive"), false);
  assert.equal(can("VENTAS", "inventory.remove"), false);
});

test("un rol desconocido no tiene ningún permiso", () => {
  assert.equal(can("ROL_INVENTADO", "inventory.stock.get"), false);
});

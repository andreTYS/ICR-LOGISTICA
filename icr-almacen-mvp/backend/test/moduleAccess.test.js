// Tests del switch de módulos por rol (activación/desactivación desde
// Administración), contra una base Postgres real — mismo enfoque que el
// resto de la suite. A diferencia de auth.test.js (que no toca la base),
// acá sí necesitamos DB porque el switch vive en la tabla modulo_acceso.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const moduleAccess = require("../src/services/moduleAccessService");
const { requirePermission } = require("../src/auth");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const SUPERVISOR = "00000000-0000-0000-0000-000000000003";

// Simula el ciclo de vida de un middleware Express sin levantar un servidor:
// requirePermission() ya es puramente síncrono contra la cache en memoria.
function runMiddleware(action, rolCodigo) {
  const req = { user: { usuario_id: SUPERVISOR, rol_codigo: rolCodigo } };
  let statusCode = null;
  let body = null;
  let calledNext = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  requirePermission(action)(req, res, () => { calledNext = true; });
  return { calledNext, statusCode, body };
}

test("por defecto, sin filas en modulo_acceso, todos los módulos están habilitados para todos los roles", async () => {
  await moduleAccess.reloadModuleAccessCache();
  assert.equal(moduleAccess.isModuleEnabledForRole("purchases", "COMPRAS"), true);
  const r = runMiddleware("purchases.create", "COMPRAS");
  assert.equal(r.calledNext, true);
});

test("desactivar un módulo para un rol bloquea el request aunque el mapa de permisos lo permita", async () => {
  await moduleAccess.setModuleAccess({ modulo: "purchases", rolCodigo: "COMPRAS", habilitado: false, usuarioId: ADMIN, canal: "web" });

  const r = runMiddleware("purchases.create", "COMPRAS");
  assert.equal(r.calledNext, false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error.code, "MODULE_DISABLED");

  // otro rol con el mismo permiso no debería verse afectado
  const rSupervisor = runMiddleware("purchases.query", "SUPERVISOR");
  assert.equal(rSupervisor.calledNext, true);
});

test("ADMIN nunca se bloquea por el switch, incluso si el módulo está desactivado para todos los demás roles", async () => {
  const r = runMiddleware("purchases.create", "ADMIN");
  assert.equal(r.calledNext, true);
});

test("reactivar el módulo restaura el acceso", async () => {
  await moduleAccess.setModuleAccess({ modulo: "purchases", rolCodigo: "COMPRAS", habilitado: true, usuarioId: ADMIN, canal: "web" });
  const r = runMiddleware("purchases.create", "COMPRAS");
  assert.equal(r.calledNext, true);
});

test("listModuleAccess trae el catálogo completo de módulos y roles con su estado actual", async () => {
  await moduleAccess.setModuleAccess({ modulo: "sales", rolCodigo: "VENTAS", habilitado: false, usuarioId: ADMIN, canal: "web" });
  const listado = await moduleAccess.listModuleAccess();
  assert.ok(listado.modules.some((m) => m.code === "sales"));
  assert.ok(listado.roles.includes("VENTAS"));
  const salesRow = listado.access.find((a) => a.modulo === "sales");
  assert.equal(salesRow.roles.VENTAS, false);
  assert.equal(salesRow.roles.SUPERVISOR, true);
});

test("un módulo o rol inválido se rechaza", async () => {
  await assert.rejects(
    moduleAccess.setModuleAccess({ modulo: "no_existe", rolCodigo: "COMPRAS", habilitado: false, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
  await assert.rejects(
    moduleAccess.setModuleAccess({ modulo: "purchases", rolCodigo: "ADMIN", habilitado: false, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

after(async () => {
  await pool.end();
});

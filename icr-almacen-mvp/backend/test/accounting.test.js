// Tests de integración del módulo de Contabilidad contra una base Postgres
// real (mismo enfoque que el resto de la suite): motor de reglas de
// imputación + parámetros fiscales versionados (PRD §5.1, §5.2).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const contabilidad = require("../src/services/contabilidadService");
const compras = require("../src/services/comprasService");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const COMPRAS_USER = "00000000-0000-0000-0000-000000000004";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";

test("crear cuentas y listarlas", async () => {
  // 20/42/etc. ya vienen del plan de cuentas inicial en seed.sql — se usan
  // códigos nuevos acá para probar la creación sin chocar con esas filas.
  await contabilidad.crearCuenta({ codigo: "20.1", nombre: "Mercaderías — repuestos", tipo: "ACTIVO", cuentaPadreCodigo: "20", usuarioId: ADMIN, canal: "web" });
  await contabilidad.crearCuenta({ codigo: "75", nombre: "Otros ingresos de gestión", tipo: "INGRESO", usuarioId: ADMIN, canal: "web" });
  const cuentas = await contabilidad.listCuentas();
  assert.ok(cuentas.some((c) => c.codigo === "20.1" && c.cuenta_padre_codigo === "20"));
  assert.ok(cuentas.some((c) => c.codigo === "75"));
});

test("un parámetro fiscal versionado devuelve el valor vigente en una fecha dada", async () => {
  await contabilidad.crearParametroFiscal({ tipo: "IGV", valor: 18, vigenteDesde: "2020-01-01", vigenteHasta: "2025-12-31", usuarioId: ADMIN, canal: "web" });
  await contabilidad.crearParametroFiscal({ tipo: "IGV", valor: 19, vigenteDesde: "2026-01-01", usuarioId: ADMIN, canal: "web" });

  const antes = await contabilidad.getParametroFiscalVigente("IGV", "2024-06-01");
  assert.equal(Number(antes.valor), 18);
  const despues = await contabilidad.getParametroFiscalVigente("IGV", "2026-06-01");
  assert.equal(Number(despues.valor), 19);
});

test("un asiento manual desbalanceado se rechaza", async () => {
  await assert.rejects(
    contabilidad.crearAsientoManual({
      glosa: "Desbalanceado",
      lineas: [{ cuenta_codigo: "20", debe: 500, haber: 0 }, { cuenta_codigo: "42", debe: 0, haber: 400 }],
      usuarioId: ADMIN, canal: "web",
    }),
    (err) => err.code === "ASIENTO_DESBALANCEADO"
  );
});

test("un asiento manual balanceado se crea en BORRADOR y se puede contabilizar", async () => {
  const asiento = await contabilidad.crearAsientoManual({
    glosa: "Apertura",
    lineas: [{ cuenta_codigo: "20", debe: 1000, haber: 0 }, { cuenta_codigo: "42", debe: 0, haber: 1000 }],
    usuarioId: ADMIN, canal: "web",
  });
  assert.equal(asiento.asiento.estado, "BORRADOR");

  const contabilizado = await contabilidad.contabilizarAsiento({ numero: asiento.numero, usuarioId: ADMIN, canal: "web" });
  assert.equal(contabilizado.asiento.estado, "CONTABILIZADO");

  await assert.rejects(
    contabilidad.contabilizarAsiento({ numero: asiento.numero, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "ENTRY_NOT_DRAFT"
  );
});

test("anular un asiento dos veces se rechaza", async () => {
  const asiento = await contabilidad.crearAsientoManual({
    glosa: "Para anular",
    lineas: [{ cuenta_codigo: "20", debe: 200, haber: 0 }, { cuenta_codigo: "42", debe: 0, haber: 200 }],
    usuarioId: ADMIN, canal: "web",
  });
  await contabilidad.anularAsiento({ numero: asiento.numero, usuarioId: ADMIN, canal: "web" });
  await assert.rejects(
    contabilidad.anularAsiento({ numero: asiento.numero, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "ENTRY_ALREADY_VOID"
  );
});

test("recibir una compra genera un asiento automático en BORRADOR cuando hay una regla activa", async () => {
  await contabilidad.crearRegla({ evento: "purchases.receive", cuentaDebeCodigo: "20", cuentaHaberCodigo: "42", usuarioId: ADMIN, canal: "web" });

  const oc = await compras.crearOrdenCompra({
    proveedorRuc: "20100047218", warehouseCode: "ALM-001",
    items: [{ sku: "PANEL-JA-550", quantity: 5, unitCost: 650 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" });
  await compras.recibirOrdenCompra({ numero: oc.numero, items: [{ sku: "PANEL-JA-550", quantity: 5 }], usuarioId: ALMACENERO, canal: "web" });

  const asientos = await contabilidad.listAsientos({});
  const auto = asientos.items.find((a) => a.origen_evento === "purchases.receive");
  assert.ok(auto, "debería existir un asiento automático");
  assert.equal(auto.estado, "BORRADOR");
  assert.equal(Number(auto.total), 5 * 650);
});

test("sin una regla activa para el evento, no se genera ningún asiento (no rompe la recepción)", async () => {
  const oc = await compras.crearOrdenCompra({
    proveedorRuc: "20100047218", warehouseCode: "ALM-001",
    items: [{ sku: "CONECTOR-MC4", quantity: 10, unitCost: 4.5 }],
    usuarioId: COMPRAS_USER, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: oc.numero, usuarioId: COMPRAS_USER, canal: "web" });
  await contabilidad.setReglaActiva({ evento: "purchases.receive", activo: false, usuarioId: ADMIN, canal: "web" });

  const antes = (await contabilidad.listAsientos({})).total;
  await compras.recibirOrdenCompra({ numero: oc.numero, items: [{ sku: "CONECTOR-MC4", quantity: 10 }], usuarioId: ALMACENERO, canal: "web" });
  const despues = (await contabilidad.listAsientos({})).total;
  assert.equal(despues, antes, "no debería crearse un asiento nuevo con la regla desactivada");
});

after(async () => {
  await pool.end();
});

// Tests de integración del módulo de Cotizaciones (etapa previa al contrato
// de Ventas), mismo enfoque que sales.test.js.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const cotizaciones = require("../src/services/cotizacionesService");
const ventas = require("../src/services/ventasService");

const VENTAS_USER = "00000000-0000-0000-0000-000000000005"; // seed.sql
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)
const PROYECTO_CODIGO = "PROY-001"; // seed.sql

const ITEMS = [
  { descripcion: "Panel solar 550W x20", cantidad: 20, precio_unitario: 700 },
  { descripcion: "Instalación y mano de obra", cantidad: 1, precio_unitario: 4000 },
];

test("crear una cotización calcula el total a partir de sus ítems", async () => {
  const r = await cotizaciones.crearCotizacion({
    clienteRuc: CLIENTE_RUC, items: ITEMS, usuarioId: VENTAS_USER, canal: "web",
  });
  assert.match(r.cotizacion.codigo, /^COT-\d{5}$/);
  assert.equal(r.cotizacion.estado, "BORRADOR");

  const detalle = await cotizaciones.getCotizacion(r.cotizacion.codigo);
  assert.equal(detalle.items.length, 2);
  assert.equal(detalle.total, 20 * 700 + 4000);
});

test("una cotización sin ítems se rechaza", async () => {
  await assert.rejects(
    cotizaciones.crearCotizacion({ clienteRuc: CLIENTE_RUC, items: [], usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("una cotización con un cliente inexistente se rechaza", async () => {
  await assert.rejects(
    cotizaciones.crearCotizacion({ clienteRuc: "99999999999", items: ITEMS, usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "CLIENT_NOT_FOUND"
  );
});

test("un ítem inválido (cantidad o precio incorrectos) se rechaza", async () => {
  await assert.rejects(
    cotizaciones.crearCotizacion({
      clienteRuc: CLIENTE_RUC, items: [{ descripcion: "X", cantidad: 0, precio_unitario: 10 }], usuarioId: VENTAS_USER, canal: "web",
    }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("cambiar el estado de una cotización funciona, pero no se puede forzar a CONVERTIDA directamente", async () => {
  const { cotizacion } = await cotizaciones.crearCotizacion({ clienteRuc: CLIENTE_RUC, proyectoCodigo: PROYECTO_CODIGO, items: ITEMS, usuarioId: VENTAS_USER, canal: "web" });
  const r = await cotizaciones.actualizarEstado({ codigo: cotizacion.codigo, estado: "ENVIADA", usuarioId: VENTAS_USER, canal: "web" });
  assert.equal(r.cotizacion.estado, "ENVIADA");

  await assert.rejects(
    cotizaciones.actualizarEstado({ codigo: cotizacion.codigo, estado: "CONVERTIDA", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("convertir una cotización no ACEPTADA se rechaza", async () => {
  const { cotizacion } = await cotizaciones.crearCotizacion({ clienteRuc: CLIENTE_RUC, items: ITEMS, usuarioId: VENTAS_USER, canal: "web" });
  await assert.rejects(
    cotizaciones.convertirAContrato({ codigo: cotizacion.codigo, usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "QUOTE_NOT_ACCEPTED"
  );
});

test("convertir una cotización ACEPTADA crea un contrato de Ventas con el monto total de los ítems y la marca CONVERTIDA", async () => {
  const { cotizacion } = await cotizaciones.crearCotizacion({ clienteRuc: CLIENTE_RUC, proyectoCodigo: PROYECTO_CODIGO, items: ITEMS, usuarioId: VENTAS_USER, canal: "web" });
  await cotizaciones.actualizarEstado({ codigo: cotizacion.codigo, estado: "ENVIADA", usuarioId: VENTAS_USER, canal: "web" });
  await cotizaciones.actualizarEstado({ codigo: cotizacion.codigo, estado: "ACEPTADA", usuarioId: VENTAS_USER, canal: "web" });

  const r = await cotizaciones.convertirAContrato({ codigo: cotizacion.codigo, usuarioId: VENTAS_USER, canal: "web" });
  assert.equal(r.cotizacion.estado, "CONVERTIDA");
  assert.equal(Number(r.contrato.monto_total), 20 * 700 + 4000);

  const contrato = await ventas.getContrato(r.contrato.codigo_contrato);
  assert.equal(contrato.codigo_contrato, r.contrato.codigo_contrato);

  await assert.rejects(
    cotizaciones.actualizarEstado({ codigo: cotizacion.codigo, estado: "RECHAZADA", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "QUOTE_ALREADY_CONVERTED"
  );
});

test("el listado de cotizaciones pagina y filtra por estado", async () => {
  const r = await cotizaciones.listCotizaciones({ estado: "BORRADOR" });
  assert.ok(r.items.every((c) => c.estado === "BORRADOR"));
});

after(async () => {
  await pool.end();
});

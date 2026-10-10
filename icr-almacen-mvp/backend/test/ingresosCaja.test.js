// Tests de integración del módulo de Ingresos de caja (ICR Finanzas / Caja
// de Obra) contra una base Postgres real, mismo enfoque que expenses.test.js.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const ingresos = require("../src/services/ingresosCajaService");
const gastos = require("../src/services/gastosService");
const contabilidad = require("../src/services/contabilidadService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const PROYECTO_CODIGO = "PROY-001"; // seed.sql

test("registrar un ingreso de caja simple funciona y genera un asiento automático en BORRADOR", async () => {
  const r = await ingresos.registrarIngreso({
    tipo: "OTRO", detalle: "Adelanto cobrado en campo", monto: 300, usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.ingreso.tipo, "OTRO");
  assert.equal(Number(r.ingreso.monto), 300);

  const asientos = await contabilidad.listAsientos({ estado: "BORRADOR" });
  const generado = asientos.items.find((a) => a.origen_evento === "income.register" && a.origen_id === r.ingreso.ingreso_id);
  assert.ok(generado, "debería existir un asiento generado automáticamente para el ingreso");
  assert.equal(Number(generado.total), 300);
});

test("un tipo inválido se rechaza", async () => {
  await assert.rejects(
    ingresos.registrarIngreso({ tipo: "NO_EXISTE", detalle: "X", monto: 10, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un ingreso ligado a un proyecto inexistente se rechaza", async () => {
  await assert.rejects(
    ingresos.registrarIngreso({ tipo: "OBRA_PROYECTO", detalle: "X", monto: 10, proyectoCodigo: "PROY-NO-EXISTE", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "PROJECT_NOT_FOUND"
  );
});

test("getIngreso trae un ingreso por id con el código del proyecto, y rechaza uno inexistente", async () => {
  const r = await ingresos.registrarIngreso({
    tipo: "OBRA_PROYECTO", detalle: "Adelanto de obra", monto: 1200, proyectoCodigo: PROYECTO_CODIGO, usuarioId: SUPERVISOR, canal: "web",
  });
  const encontrado = await ingresos.getIngreso(r.ingreso.ingreso_id);
  assert.equal(encontrado.codigo_proyecto, PROYECTO_CODIGO);

  await assert.rejects(
    ingresos.getIngreso("00000000-0000-0000-0000-000000009999"),
    (err) => err.code === "INCOME_NOT_FOUND"
  );
});

test("el listado de ingresos pagina y filtra por tipo y proyecto", async () => {
  const r = await ingresos.listIngresos({ tipo: "OBRA_PROYECTO" });
  assert.ok(r.items.length >= 1);
  assert.ok(r.items.every((i) => i.tipo === "OBRA_PROYECTO"));

  const porProyecto = await ingresos.listIngresos({ proyectoCodigo: PROYECTO_CODIGO });
  assert.ok(porProyecto.items.some((i) => i.codigo_proyecto === PROYECTO_CODIGO));
});

test("un gasto puede guardar la persona y ciudad detectadas por OCR (ICR Finanzas)", async () => {
  const r = await gastos.registrarGasto({
    categoria: "MATERIAL", descripcion: "Cable solar 6mm", monto: 200,
    personaTexto: "Ferretería El Sol", ciudad: "Moquegua",
    usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.gasto.persona_texto, "Ferretería El Sol");
  assert.equal(r.gasto.ciudad, "Moquegua");
});

test("getFlujoCaja y getMovimientosCaja incluyen los ingresos de caja manuales como fuente propia", async () => {
  const HOY = new Date().toISOString().slice(0, 10);
  await ingresos.registrarIngreso({ tipo: "VENTA", detalle: "Venta de retazos", monto: 777, usuarioId: SUPERVISOR, canal: "web" });

  const flujo = await contabilidad.getFlujoCaja({ fechaDesde: HOY, fechaHasta: HOY, agrupacion: "semana" });
  const total = flujo.items.reduce((s, i) => s + i.ingresos_caja, 0);
  assert.ok(total >= 777, "ingresos_caja debe incluir el ingreso manual recién registrado");
  assert.equal(flujo.totales.ingresos_caja, total);

  const ledger = await contabilidad.getMovimientosCaja({ fechaDesde: HOY, fechaHasta: HOY });
  const fila = ledger.items.find((i) => i.descripcion === "Venta de retazos");
  assert.ok(fila, "el ingreso de caja debe aparecer en el ledger de movimientos");
  assert.equal(fila.tipo, "INGRESO");
  assert.equal(Number(fila.monto), 777);
});

after(async () => {
  await pool.end();
});

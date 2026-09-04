// Tests de integración del módulo de Gastos (gastos operativos) contra una
// base Postgres real, mismo enfoque que sales.test.js y rrhh.test.js.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const gastos = require("../src/services/gastosService");
const proyectos = require("../src/services/proyectosService");
const contabilidad = require("../src/services/contabilidadService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const PROYECTO_CODIGO = "PROY-001"; // seed.sql
const EMPLEADO_ID = "80000000-0000-0000-0000-000000000001"; // Operario Almacén (seed.sql)

test("registrar un gasto simple funciona y genera un asiento automático en BORRADOR", async () => {
  const r = await gastos.registrarGasto({
    categoria: "ALQUILER", descripcion: "Alquiler de prueba", monto: 500, usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.gasto.categoria, "ALQUILER");
  assert.equal(Number(r.gasto.monto), 500);

  const asientos = await contabilidad.listAsientos({ estado: "BORRADOR" });
  const generado = asientos.items.find((a) => a.origen_evento === "expenses.register" && a.origen_id === r.gasto.gasto_id);
  assert.ok(generado, "debería existir un asiento generado automáticamente para el gasto");
  assert.equal(Number(generado.total), 500);
});

test("una categoría inválida se rechaza", async () => {
  await assert.rejects(
    gastos.registrarGasto({ categoria: "NO_EXISTE", descripcion: "X", monto: 10, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un gasto ligado a un proyecto entra a su costeo real como tercera fuente de costo", async () => {
  const detalleAntes = await proyectos.getProyecto(PROYECTO_CODIGO);
  const costoGastosAntes = detalleAntes.costeo.costo_gastos;

  await gastos.registrarGasto({
    categoria: "COMBUSTIBLE", descripcion: "Combustible de prueba", monto: 120, proyectoCodigo: PROYECTO_CODIGO,
    usuarioId: SUPERVISOR, canal: "web",
  });

  const detalle = await proyectos.getProyecto(PROYECTO_CODIGO);
  assert.equal(detalle.gastos.length, detalleAntes.gastos.length + 1);
  assert.equal(detalle.costeo.costo_gastos, costoGastosAntes + 120);
  assert.equal(
    detalle.costeo.costo_total,
    detalle.costeo.costo_materiales + detalle.costeo.costo_mano_obra + detalle.costeo.costo_gastos
  );

  const reporte = await proyectos.getReporteRentabilidad({});
  const fila = reporte.items.find((p) => p.codigo_proyecto === PROYECTO_CODIGO);
  assert.equal(Number(fila.costo_gastos), detalle.costeo.costo_gastos);
});

test("un gasto ligado a un proyecto inexistente se rechaza", async () => {
  await assert.rejects(
    gastos.registrarGasto({ categoria: "OTROS", descripcion: "X", monto: 10, proyectoCodigo: "PROY-NO-EXISTE", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "PROJECT_NOT_FOUND"
  );
});

test("un gasto de tipo REEMBOLSO ligado a un empleado funciona", async () => {
  const r = await gastos.registrarGasto({
    categoria: "REEMBOLSO", descripcion: "Reembolso de prueba", monto: 45, empleadoId: EMPLEADO_ID,
    comprobante: { tipo: "BOLETA", serie_numero: "B999-00001" },
    usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.gasto.empleado_id, EMPLEADO_ID);
});

test("un gasto ligado a un empleado inexistente se rechaza", async () => {
  await assert.rejects(
    gastos.registrarGasto({ categoria: "REEMBOLSO", descripcion: "X", monto: 10, empleadoId: "00000000-0000-0000-0000-000000009999", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "EMPLOYEE_NOT_FOUND"
  );
});

test("el listado de gastos pagina y filtra por categoría y proyecto", async () => {
  const r = await gastos.listGastos({ categoria: "COMBUSTIBLE" });
  assert.ok(r.items.length >= 1);
  assert.ok(r.items.every((g) => g.categoria === "COMBUSTIBLE"));

  const porProyecto = await gastos.listGastos({ proyectoCodigo: PROYECTO_CODIGO });
  assert.ok(porProyecto.items.some((g) => g.codigo_proyecto === PROYECTO_CODIGO));
});

after(async () => {
  await pool.end();
});

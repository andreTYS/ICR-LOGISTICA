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
const xlsxService = require("../src/services/xlsxService");

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

test("getGasto trae un gasto por id con el nombre del proyecto y del empleado, y rechaza uno inexistente", async () => {
  const r = await gastos.registrarGasto({
    categoria: "COMBUSTIBLE", descripcion: "Gasolina camioneta", monto: 150, proyectoCodigo: PROYECTO_CODIGO, empleadoId: EMPLEADO_ID,
    comprobante: { tipo: "BOLETA", serie_numero: "B001-123" }, usuarioId: SUPERVISOR, canal: "web",
  });
  const encontrado = await gastos.getGasto(r.gasto.gasto_id);
  assert.equal(encontrado.categoria, "COMBUSTIBLE");
  assert.equal(encontrado.codigo_proyecto, PROYECTO_CODIGO);
  assert.ok(encontrado.empleado_nombre, "debe traer el nombre del empleado, no solo su id");

  await assert.rejects(
    gastos.getGasto("00000000-0000-0000-0000-000000009999"),
    (err) => err.code === "EXPENSE_NOT_FOUND"
  );
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

test("registrar un gasto acepta las categorías de campo/obra agregadas a pedido", async () => {
  const r = await gastos.registrarGasto({
    categoria: "EQUIPOS_OBRA", descripcion: "Rack de pared para obra", monto: 280, usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.gasto.categoria, "EQUIPOS_OBRA");
});

test("importGastosXlsx importa filas válidas de un .xlsx real y reporta errores por fila sin abortar el resto", async () => {
  const buffer = await xlsxService.buildWorkbookBuffer({
    sheetName: "Gastos",
    headers: ["fecha", "categoria", "descripcion", "monto", "proyecto_codigo"],
    rows: [
      ["2026-09-01", "MATERIAL", "Cable solar 6mm", 366, ""],
      ["2026-09-02", "CATEGORIA_QUE_NO_EXISTE", "Fila inválida", 100, ""],
      ["2026-09-03", "MOVILIDAD", "Taxi a obra", 45, PROYECTO_CODIGO],
    ],
  });
  const resultado = await gastos.importGastosXlsx(buffer, { usuarioId: SUPERVISOR, canal: "web" });
  assert.equal(resultado.total, 3);
  assert.equal(resultado.exitosos, 2);
  assert.equal(resultado.fallidos, 1);
  assert.equal(resultado.detalle[1].ok, false);

  const listado = await gastos.listGastos({ categoria: "MOVILIDAD" });
  assert.ok(listado.items.some((g) => g.descripcion === "Taxi a obra" && g.codigo_proyecto === PROYECTO_CODIGO));
});

test("buildImportTemplate genera una hoja de instrucciones y una de Gastos con listas desplegables y fila de ejemplo", async () => {
  const buffer = await gastos.buildImportTemplate();
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  assert.deepEqual(workbook.worksheets.map((s) => s.name), ["Instrucciones", "Gastos"]);

  const sheet = workbook.getWorksheet("Gastos");
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    "fecha", "categoria", "descripcion", "monto", "moneda", "proyecto_codigo", "comprobante_tipo", "comprobante_serie_numero",
  ]);
  assert.equal(sheet.getRow(2).getCell(2).value, "MATERIAL"); // fila de ejemplo

  const validacionCategoria = sheet.getCell("B2").dataValidation;
  assert.equal(validacionCategoria.type, "list");
  assert.ok(validacionCategoria.formulae[0].includes("EQUIPOS_OBRA"));
  assert.ok(validacionCategoria.formulae[0].includes("ALIMENTACION"));

  const validacionComprobante = sheet.getCell("G2").dataValidation;
  assert.equal(validacionComprobante.type, "list");
  assert.ok(validacionComprobante.formulae[0].includes("FACTURA"));
});

test("importGastosXlsx rechaza un archivo sin filas de datos", async () => {
  const buffer = await xlsxService.buildWorkbookBuffer({
    sheetName: "Gastos",
    headers: ["fecha", "categoria", "descripcion", "monto"],
    rows: [],
  });
  await assert.rejects(
    gastos.importGastosXlsx(buffer, { usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

after(async () => {
  await pool.end();
});

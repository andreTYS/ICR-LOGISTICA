// buildWorkbookBuffer no depende de la base de datos (arma el .xlsx a partir
// de {headers, rows} que ya vienen armados del frontend, igual que la
// exportación CSV existente), así que estos tests no tocan Postgres.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const xlsxService = require("../src/services/xlsxService");

test("buildWorkbookBuffer exige headers no vacío", async () => {
  await assert.rejects(
    xlsxService.buildWorkbookBuffer({ sheetName: "X", headers: [], rows: [] }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("buildWorkbookBuffer exige que rows sea un arreglo", async () => {
  await assert.rejects(
    xlsxService.buildWorkbookBuffer({ sheetName: "X", headers: ["A"], rows: "no es un arreglo" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("buildWorkbookBuffer rechaza más filas que el límite", async () => {
  const rows = Array.from({ length: xlsxService.MAX_ROWS + 1 }, (_, i) => [String(i)]);
  await assert.rejects(
    xlsxService.buildWorkbookBuffer({ sheetName: "X", headers: ["A"], rows }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("buildWorkbookBuffer produce un .xlsx válido con encabezado en negrita y las filas correctas", async () => {
  const buffer = await xlsxService.buildWorkbookBuffer({
    sheetName: "Stock",
    headers: ["SKU", "Producto", "Cantidad"],
    rows: [
      ["SKU-001", "Panel Solar 450W", "10"],
      ["SKU-002", "Inversor 5kW", "3"],
    ],
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, "Stock");
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["SKU", "Producto", "Cantidad"]);
  assert.equal(sheet.getRow(1).getCell(1).font.bold, true);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ["SKU-001", "Panel Solar 450W", "10"]);
  assert.deepEqual(sheet.getRow(3).values.slice(1), ["SKU-002", "Inversor 5kW", "3"]);
});

test("buildWorkbookBuffer sanea nombres de hoja inválidos (caracteres prohibidos, más de 31 caracteres)", async () => {
  const buffer = await xlsxService.buildWorkbookBuffer({
    sheetName: "Reporte: Cuentas/Por*Pagar [muy largo de verdad, mas de 31]",
    headers: ["A"],
    rows: [["1"]],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.ok(workbook.worksheets[0].name.length <= 31);
  assert.doesNotMatch(workbook.worksheets[0].name, /[\\/*?:[\]]/);
});

test("parseWorkbookBuffer lee la primera hoja usando la fila 1 como encabezado (en minúsculas)", async () => {
  const buffer = await xlsxService.buildWorkbookBuffer({
    sheetName: "Datos",
    headers: ["Fecha", "Categoria", "Monto"],
    rows: [["2026-09-01", "MATERIAL", 100]],
  });
  const rows = await xlsxService.parseWorkbookBuffer(buffer);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].categoria, "MATERIAL");
  assert.equal(rows[0].monto, 100);
});

test("parseWorkbookBuffer ignora filas completamente vacías", async () => {
  const buffer = await xlsxService.buildWorkbookBuffer({
    sheetName: "Datos",
    headers: ["a", "b"],
    rows: [["1", "2"], ["", ""], ["3", "4"]],
  });
  const rows = await xlsxService.parseWorkbookBuffer(buffer);
  assert.equal(rows.length, 2);
});

test("parseWorkbookBuffer rechaza un archivo que no es un .xlsx válido", async () => {
  await assert.rejects(
    xlsxService.parseWorkbookBuffer(Buffer.from("esto no es un excel")),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

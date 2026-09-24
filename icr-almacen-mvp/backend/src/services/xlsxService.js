const ExcelJS = require("exceljs");
const { AppError } = require("../errors");

// Límite defensivo: este endpoint recibe filas ya armadas por el frontend
// (los mismos datos que la exportación CSV existente), así que no hay una
// consulta a la base que limitar — el límite es solo para no dejar que un
// payload gigante se cuelgue generando un archivo enorme.
const MAX_ROWS = 5000;

function sanitizeSheetName(name) {
  const cleaned = String(name || "Reporte").replace(/[\\/*?:[\]]/g, " ").trim();
  return (cleaned || "Reporte").slice(0, 31);
}

async function buildWorkbookBuffer({ sheetName, headers, rows }) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new AppError("SCHEMA_INVALID", "headers es obligatorio y no puede estar vacío", 400);
  }
  if (!Array.isArray(rows)) {
    throw new AppError("SCHEMA_INVALID", "rows debe ser un arreglo", 400);
  }
  if (rows.length > MAX_ROWS) {
    throw new AppError("SCHEMA_INVALID", `No se pueden exportar más de ${MAX_ROWS} filas a la vez`, 400);
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sanitizeSheetName(sheetName));

  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00004C" } };
  });

  rows.forEach((row) => sheet.addRow(row));

  headers.forEach((header, i) => {
    const maxLen = rows.reduce((max, row) => Math.max(max, String(row[i] ?? "").length), String(header ?? "").length);
    sheet.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 10), 50);
  });

  return workbook.xlsx.writeBuffer();
}

// Extrae el valor "plano" de una celda de exceljs: texto/número/fecha tal
// cual, pero una fórmula o rich-text vienen como objeto ({result: ...} o
// {richText: [...]}) que hay que desenvolver antes de usarlos como dato.
function plainCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return value.result;
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return value.text;
  }
  return value;
}

// Lee la primera hoja de un .xlsx subido (Excel/LibreOffice real, no CSV) y
// la convierte en un arreglo de filas-objeto, usando la fila 1 como
// encabezado — mismo espíritu que parseCsv en inventoryService, pero para
// el formato binario que la gente ya usa día a día en sus planillas.
async function parseWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new AppError("SCHEMA_INVALID", "No se pudo leer el archivo — ¿es un .xlsx válido?", 400);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError("SCHEMA_INVALID", "El archivo no tiene ninguna hoja", 400);

  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(plainCellValue(cell.value) ?? "").trim().toLowerCase();
  });
  if (!headers.some(Boolean)) {
    throw new AppError("SCHEMA_INVALID", "El archivo no tiene fila de encabezado", 400);
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = {};
    let hasValue = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const value = plainCellValue(row.getCell(i + 1).value);
      if (value !== null && value !== undefined && value !== "") hasValue = true;
      data[h] = value;
    });
    if (hasValue) rows.push(data);
  });
  return rows;
}

module.exports = { buildWorkbookBuffer, parseWorkbookBuffer, MAX_ROWS };

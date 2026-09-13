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

module.exports = { buildWorkbookBuffer, MAX_ROWS };

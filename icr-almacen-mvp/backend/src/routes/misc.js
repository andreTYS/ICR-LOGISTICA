const express = require("express");
const router = express.Router();
const { handle, handleBinary } = require("./_shared");
const xlsxService = require("../services/xlsxService");
const rucService = require("../services/rucService");

// -------- Exportación genérica --------
// El frontend arma {headers, rows} con los mismos datos que ya usa para la
// exportación CSV (que es 100% del lado del cliente) y este endpoint solo
// los convierte a un .xlsx real con encabezado en negrita — no hay consulta
// nueva a la base, así que no necesita un permiso de dominio específico más
// allá de estar autenticado.
router.post(
  "/export/xlsx",
  handleBinary(async (req) => {
    const b = req.body || {};
    const buffer = await xlsxService.buildWorkbookBuffer({ sheetName: b.sheetName, headers: b.headers, rows: b.rows });
    return {
      buffer,
      filename: `${(b.filename || "reporte").replace(/[^a-zA-Z0-9_\-]/g, "_")}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  })
);

// Consulta de RUC/DNI (groundwork, ver rucService.js) — solo requiere sesión,
// no un permiso de dominio específico, porque se usa igual desde el
// formulario de Cliente (Ventas/Proyectos) que desde el de Lead (CRM).
router.get(
  "/clients/lookup/:numero",
  handle(async (req) => rucService.consultar(req.params.numero))
);

module.exports = router;

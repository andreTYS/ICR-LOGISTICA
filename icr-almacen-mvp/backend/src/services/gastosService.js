const ExcelJS = require("exceljs");
const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const contabilidad = require("./contabilidadService");
const { parseWorkbookBuffer } = require("./xlsxService");

// EQUIPOS_OBRA/MOVILIDAD/MATERIAL/SUELDO/OFICINA/FLETES/ALIMENTACION se
// agregaron a pedido, para reflejar cómo el negocio ya venía categorizando
// gastos a mano en su planilla de flujo de caja (equipos/obra, movilidad,
// material, sueldo, oficina, fletes, caja pizarro/menús) — antes todo eso
// cargaba forzado en "OTROS" porque el enum solo cubría gastos de oficina
// típicos (software, honorarios, etc.), no gastos de campo/obra.
const CATEGORIAS_VALIDAS = [
  "COMBUSTIBLE", "VIATICOS", "ALQUILER", "SERVICIOS", "SOFTWARE",
  "MANTENIMIENTO", "HONORARIOS", "REEMBOLSO",
  "EQUIPOS_OBRA", "MOVILIDAD", "MATERIAL", "SUELDO", "OFICINA", "FLETES", "ALIMENTACION",
  "OTROS",
];
const TIPOS_COMPROBANTE_VALIDOS = ["FACTURA", "BOLETA", "RECIBO"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Un gasto opcionalmente ligado a un proyecto entra a su costeo real (junto
// a materiales y mano de obra); uno ligado a un empleado es un reembolso.
// Dispara, best-effort después del commit, el asiento contable automático
// para el evento 'expenses.register' — mismo patrón que Compras y Ventas.
async function registrarGasto({ categoria, descripcion, monto, moneda, fecha, proyectoCodigo, empleadoId, comprobante, usuarioId, canal }) {
  if (!categoria || !CATEGORIAS_VALIDAS.includes(categoria)) {
    throw new AppError("SCHEMA_INVALID", `categoria debe ser una de: ${CATEGORIAS_VALIDAS.join(", ")}`, 400);
  }
  if (!descripcion || !monto || monto <= 0) {
    throw new AppError("SCHEMA_INVALID", "descripcion y monto (>0) son obligatorios", 400);
  }
  if (comprobante && !TIPOS_COMPROBANTE_VALIDOS.includes(comprobante.tipo)) {
    throw new AppError("SCHEMA_INVALID", `el tipo de comprobante debe ser uno de: ${TIPOS_COMPROBANTE_VALIDOS.join(", ")}`, 400);
  }

  const result = await withAuditedTransaction("expenses.register", usuarioId, canal, async (client) => {
    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1 AND activo=true", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${proyectoCodigo}' no existe o está inactivo`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }
    if (empleadoId) {
      const emp = await client.query("SELECT empleado_id FROM empleados WHERE empleado_id=$1 AND activo=true", [empleadoId]);
      if (emp.rows.length === 0) throw new AppError("EMPLOYEE_NOT_FOUND", "El empleado indicado no existe o está inactivo", 404);
    }

    const r = await client.query(
      `INSERT INTO gastos (categoria, descripcion, monto, moneda, fecha, proyecto_id, empleado_id, comprobante_tipo, comprobante_serie_numero, registrado_por)
       VALUES ($1,$2,$3,COALESCE($4,'PEN'),COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10) RETURNING *`,
      [categoria, descripcion, monto, moneda || null, fecha || null, proyectoId, empleadoId || null,
        comprobante?.tipo || null, comprobante?.serie_numero || null, usuarioId]
    );
    return { entidad: "gastos", entidadId: r.rows[0].gasto_id, valorNuevo: { categoria, monto }, gasto: r.rows[0] };
  });

  try {
    await contabilidad.generarAsientoAutomatico({
      evento: "expenses.register", monto: Number(result.gasto.monto),
      glosa: `Gasto (${categoria}): ${descripcion}`, origenId: result.gasto.gasto_id,
      usuarioId, canal,
    });
  } catch (err) {
    console.error(`No se pudo generar el asiento automático para el gasto '${descripcion}'`, err);
  }

  return result;
}

async function listGastos({ categoria, proyectoCodigo, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 30, 200);
  const conditions = [];
  const params = [];
  if (categoria) { params.push(categoria); conditions.push(`g.categoria = $${params.length}`); }
  if (proyectoCodigo) { params.push(proyectoCodigo); conditions.push(`pr.codigo_proyecto = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT g.*, pr.codigo_proyecto, e.nombre_completo AS empleado_nombre, COUNT(*) OVER() AS total_count
     FROM gastos g
     LEFT JOIN proyectos pr ON pr.proyecto_id = g.proyecto_id
     LEFT JOIN empleados e ON e.empleado_id = g.empleado_id
     ${where}
     ORDER BY g.fecha DESC, g.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getGasto(gastoId) {
  const r = await pool.query(
    `SELECT g.*, pr.codigo_proyecto, e.nombre_completo AS empleado_nombre
     FROM gastos g
     LEFT JOIN proyectos pr ON pr.proyecto_id = g.proyecto_id
     LEFT JOIN empleados e ON e.empleado_id = g.empleado_id
     WHERE g.gasto_id = $1`,
    [gastoId]
  );
  if (r.rows.length === 0) throw new AppError("EXPENSE_NOT_FOUND", "El gasto indicado no existe", 404);
  return r.rows[0];
}

// Importación masiva de gastos desde un .xlsx real (Excel/LibreOffice, no
// solo CSV) — columnas: fecha, categoria, descripcion, monto (obligatorias);
// moneda, proyecto_codigo, comprobante_tipo, comprobante_serie_numero
// (opcionales). Mismo criterio que importProductsCsv en inventoryService:
// cada fila pasa por registrarGasto de forma independiente (con su asiento
// automático best-effort incluido), un error en una no aborta el resto.
async function importGastosXlsx(buffer, { usuarioId, canal }) {
  const rows = await parseWorkbookBuffer(buffer);
  if (rows.length === 0) {
    throw new AppError("SCHEMA_INVALID", "El archivo no tiene filas de datos", 400);
  }

  const detalle = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fila = i + 2; // +1 por índice base 0, +1 por la fila de encabezado
    try {
      const fecha = r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : (r.fecha ? String(r.fecha).trim() : null);
      const comprobanteTipo = r.comprobante_tipo ? String(r.comprobante_tipo).trim().toUpperCase() : null;
      await registrarGasto({
        categoria: String(r.categoria || "").trim().toUpperCase(),
        descripcion: String(r.descripcion || "").trim(),
        monto: Number(r.monto),
        moneda: r.moneda ? String(r.moneda).trim() : null,
        fecha,
        proyectoCodigo: r.proyecto_codigo ? String(r.proyecto_codigo).trim() : null,
        comprobante: comprobanteTipo ? { tipo: comprobanteTipo, serie_numero: r.comprobante_serie_numero ? String(r.comprobante_serie_numero).trim() : null } : null,
        usuarioId, canal,
      });
      detalle.push({ fila, descripcion: r.descripcion || "", ok: true });
    } catch (err) {
      detalle.push({ fila, descripcion: r.descripcion || "", ok: false, error: err.message || "Error desconocido" });
    }
  }
  return {
    total: detalle.length,
    exitosos: detalle.filter((d) => d.ok).length,
    fallidos: detalle.filter((d) => !d.ok).length,
    detalle,
  };
}

const HEADER_STYLE = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF00004C" } } };

// Plantilla de importación pensada para que la llene directamente la
// persona de campo (no alguien técnico): hoja de instrucciones en español
// simple + listas desplegables en las columnas que tienen un valor fijo
// (categoría, tipo de comprobante) para que no se pueda escribir mal y la
// fila se rechace después al importar.
async function buildImportTemplate() {
  const workbook = new ExcelJS.Workbook();

  const instrucciones = workbook.addWorksheet("Instrucciones");
  instrucciones.columns = [{ width: 26 }, { width: 80 }];
  const tituloRow = instrucciones.addRow(["Columna", "Qué poner"]);
  tituloRow.eachCell((cell) => Object.assign(cell, HEADER_STYLE));
  [
    ["fecha", "Fecha en que se pagó el gasto. Formato día/mes/año, ej: 24/09/2026."],
    ["categoria", "Elige una opción de la lista (clic en la celda de la hoja \"Gastos\" y aparece una flechita a la derecha)."],
    ["descripcion", "Una frase corta que diga qué fue el gasto. Ej: \"Cable solar 6mm para obra Fundo Vilca\"."],
    ["monto", "Solo el número, sin \"S/\" ni comas. Ej: 366.50"],
    ["moneda (opcional)", "Déjalo vacío si fue en soles. Si fue en dólares, escribe USD."],
    ["proyecto_codigo (opcional)", "El código de la obra si el gasto es de un proyecto específico, ej. PROY-001. Si no aplica, déjalo vacío."],
    ["comprobante_tipo (opcional)", "FACTURA, BOLETA o RECIBO — elige de la lista, o déjalo vacío si no hay comprobante."],
    ["comprobante_serie_numero (opcional)", "El número que aparece en la factura/boleta/recibo, ej. B001-00456."],
  ].forEach((fila) => {
    const row = instrucciones.addRow(fila);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });
  instrucciones.addRow([]);
  const nota = instrucciones.addRow(["Importante", "No cambies los nombres de las columnas de la hoja \"Gastos\" (la primera fila) — el sistema los usa para saber qué es cada dato."]);
  nota.getCell(1).font = { bold: true };
  nota.getCell(2).alignment = { wrapText: true, vertical: "top" };

  const sheet = workbook.addWorksheet("Gastos");
  const headers = ["fecha", "categoria", "descripcion", "monto", "moneda", "proyecto_codigo", "comprobante_tipo", "comprobante_serie_numero"];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => Object.assign(cell, HEADER_STYLE));
  sheet.addRow(["24/09/2026", "MATERIAL", "Cable solar 6mm para obra Fundo Vilca", 366.5, "", "", "", ""]);
  sheet.getColumn(4).numFmt = "#,##0.00";
  sheet.getColumn(3).width = 45;
  headers.forEach((h, i) => { if (i !== 2) sheet.getColumn(i + 1).width = Math.max(h.length + 4, 16); });

  const LAST_ROW = 200; // margen amplio para varias jornadas de carga sin tener que repetir el dropdown a mano
  const categoriasFormula = `"${CATEGORIAS_VALIDAS.join(",")}"`;
  const comprobantesFormula = `"${TIPOS_COMPROBANTE_VALIDOS.join(",")}"`;
  for (let row = 2; row <= LAST_ROW; row++) {
    sheet.getCell(`B${row}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [categoriasFormula],
      showErrorMessage: true, errorStyle: "stop", errorTitle: "Categoría no válida", error: "Elige una opción de la lista desplegable.",
    };
    sheet.getCell(`G${row}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [comprobantesFormula],
    };
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { registrarGasto, listGastos, getGasto, importGastosXlsx, buildImportTemplate, CATEGORIAS_VALIDAS };

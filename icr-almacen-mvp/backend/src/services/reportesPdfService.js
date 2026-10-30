// Arma los PDF de los reportes/documentos del ERP a partir de los datos que
// ya devuelven los services de cada dominio (contabilidadService,
// cotizacionesService, ventasService, proyectosService, comprasService,
// gastosService) — este archivo solo se encarga del formato visual, reusando
// los helpers de marca de pdfService.js. Todos los documentos emitidos usan
// el mismo fondo de marca (franjas navy + logo ICR Energy, ver
// assets/fondo-marca.png) — el bloque de datos de pago al pie solo aparece
// en los que el cliente paga a ICR (Cotización, Contrato de Venta); una
// Orden de Compra es al revés (ICR le paga al proveedor) y los reportes
// internos (Balance, Estado de Resultados, Rentabilidad) no llevan pago.
const {
  crearDocumentoMarca, renderEncabezadoMarca, renderFilaEntidadMonto, renderInfoBlock, renderTabla,
  renderTotalLine, renderPieDatosPago, finalizarBuffer, COLORS,
} = require("./pdfService");
const { getSettings } = require("./settingsService");

function money(n) {
  return Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fecha(d) {
  return d ? new Date(d).toLocaleDateString("es-PE") : "-";
}

async function buildBalanceGeneralPdf(data) {
  const doc = crearDocumentoMarca();
  let y = renderEncabezadoMarca(doc, { titulo: "Balance General", subtitulo: `Al ${fecha(data.fecha_corte)}` });

  const activos = data.cuentas.filter((c) => c.tipo === "ACTIVO");
  const pasivos = data.cuentas.filter((c) => c.tipo === "PASIVO");
  const patrimonio = data.cuentas.filter((c) => c.tipo === "PATRIMONIO");

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text("ACTIVO", doc.page.margins.left, y);
  y = doc.y + 4;
  y = await renderTabla(doc, {
    headers: ["Código", "Cuenta", "Saldo (S/)"],
    rows: activos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100], alignRight: [2], y, conMarca: true,
  });
  y = renderTotalLine(doc, "Total Activo", `S/ ${money(data.total_activo)}`, { y: y + 6 });

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text("PASIVO", doc.page.margins.left, y + 12);
  y = doc.y + 4;
  y = await renderTabla(doc, {
    headers: ["Código", "Cuenta", "Saldo (S/)"],
    rows: pasivos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100], alignRight: [2], y, conMarca: true,
  });
  y = renderTotalLine(doc, "Total Pasivo", `S/ ${money(data.total_pasivo)}`, { y: y + 6 });

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text("PATRIMONIO", doc.page.margins.left, y + 12);
  y = doc.y + 4;
  y = await renderTabla(doc, {
    headers: ["Código", "Cuenta", "Saldo (S/)"],
    rows: [...patrimonio.map((c) => [c.codigo, c.nombre, money(c.saldo)]), ["-", "Resultado del ejercicio", money(data.resultado_ejercicio)]],
    widths: [80, 300, 100], alignRight: [2], y, conMarca: true,
  });
  y = renderTotalLine(doc, "Total Patrimonio", `S/ ${money(data.total_patrimonio)}`, { y: y + 6 });
  renderTotalLine(doc, "Total Pasivo + Patrimonio", `S/ ${money(data.total_pasivo + data.total_patrimonio)}`, { y: y + 16 });

  return finalizarBuffer(doc);
}

async function buildEstadoResultadosPdf(data) {
  const doc = crearDocumentoMarca();
  let y = renderEncabezadoMarca(doc, { titulo: "Estado de Resultados", subtitulo: `Del ${fecha(data.fecha_desde)} al ${fecha(data.fecha_hasta)}` });

  const ingresos = data.cuentas.filter((c) => c.tipo === "INGRESO");
  const gastos = data.cuentas.filter((c) => c.tipo === "GASTO");

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text("INGRESOS", doc.page.margins.left, y);
  y = doc.y + 4;
  y = await renderTabla(doc, {
    headers: ["Código", "Cuenta", "Monto (S/)"],
    rows: ingresos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100], alignRight: [2], y, conMarca: true,
  });
  y = renderTotalLine(doc, "Total Ingresos", `S/ ${money(data.total_ingresos)}`, { y: y + 6 });

  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text("GASTOS", doc.page.margins.left, y + 12);
  y = doc.y + 4;
  y = await renderTabla(doc, {
    headers: ["Código", "Cuenta", "Monto (S/)"],
    rows: gastos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100], alignRight: [2], y, conMarca: true,
  });
  y = renderTotalLine(doc, "Total Gastos", `S/ ${money(data.total_gastos)}`, { y: y + 6 });
  renderTotalLine(doc, "Utilidad Neta", `S/ ${money(data.utilidad_neta)}`, { y: y + 16 });

  return finalizarBuffer(doc);
}

// Tabla de ítems con foto de producto, compartida por Cotización y Orden de
// Compra — ambas listan productos del catálogo uno por uno.
async function renderTablaItemsConFoto(doc, { y, filas }) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - left - doc.page.margins.right;
  const anchoFijo = 26 + 52 + 48 + 75; // N° + Imagen + Cant. + P.Unidad
  return renderTabla(doc, {
    headers: ["N°", "Imagen", "Descripción del artículo", "Cant.", "P.Unidad", "P. Final"],
    rows: filas,
    widths: [26, 52, usableWidth - anchoFijo - 80, 48, 75, 80],
    alignRight: [3, 4, 5],
    imageCol: 1,
    y,
    conMarca: true,
  });
}

// Formato con el estilo de marca que ya usa el equipo de ventas (fondo con
// las franjas superior/inferior de ICR Energy, tabla de ítems con foto de
// cada producto, bloque de datos de pago al pie) — ver assets/fondo-marca.png.
async function buildCotizacionPdf(cotizacion) {
  const doc = crearDocumentoMarca();
  const { empresa } = await getSettings();
  const left = doc.page.margins.left;

  const fechaVencimiento = new Date(cotizacion.fecha_emision);
  fechaVencimiento.setDate(fechaVencimiento.getDate() + cotizacion.validez_dias);

  renderEncabezadoMarca(doc, { titulo: "COTIZACIÓN", subtitulo: `N° ${cotizacion.codigo}`, empresa });
  let y = renderFilaEntidadMonto(doc, {
    y: 172,
    tituloIzq: cotizacion.cliente_nombre, notaIzq: `RUC/DNI: ${cotizacion.cliente_ruc || "-"}`,
    tituloDer: `Total: ${cotizacion.moneda || "PEN"} ${money(cotizacion.total)}`, notaDer: `(Válido hasta ${fecha(fechaVencimiento)})`,
  });

  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Vendedor: ", left, y, { continued: true });
  doc.font("Helvetica").text(cotizacion.responsable_nombre || "-");
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Correo: ", left, doc.y + 2, { continued: true });
  doc.font("Helvetica").text(cotizacion.responsable_email || empresa?.correo || "-");
  y = doc.y + 16;

  const filas = cotizacion.items.map((it, i) => [
    String(i + 1), it.producto_imagen_url, it.descripcion,
    Number(it.cantidad).toLocaleString("es-PE"), money(it.precio_unitario), money(it.cantidad * it.precio_unitario),
  ]);
  y = await renderTablaItemsConFoto(doc, { y, filas });

  y = renderTotalLine(doc, "Precio final (inc. IGV)", `${cotizacion.moneda || "PEN"} ${money(cotizacion.total)}`, { y: y + 12 });
  renderPieDatosPago(doc, { y: y + 24, empresa });

  return finalizarBuffer(doc);
}

async function buildContratoPdf(contrato) {
  const doc = crearDocumentoMarca();
  const { empresa } = await getSettings();

  renderEncabezadoMarca(doc, { titulo: "CONTRATO DE VENTA", subtitulo: `N° ${contrato.codigo_contrato}`, empresa });
  let y = renderFilaEntidadMonto(doc, {
    y: 172,
    tituloIzq: contrato.cliente_nombre, notaIzq: `RUC/DNI: ${contrato.cliente_ruc || "-"}`,
    tituloDer: `Monto total: ${contrato.moneda || "PEN"} ${money(contrato.monto_total)}`, notaDer: `Estado: ${contrato.estado}`,
  });
  y += 10;

  y = await renderTabla(doc, {
    headers: ["Hito", "Monto", "Fecha esperada", "Estado"],
    rows: contrato.hitos.map((h) => [h.descripcion, money(h.monto), fecha(h.fecha_esperada), h.estado]),
    widths: [200, 85, 105, 100], alignRight: [1], y, conMarca: true,
  });

  y = renderTotalLine(doc, "Monto Cobrado", `${contrato.moneda || "PEN"} ${money(contrato.monto_cobrado)}`, { y: y + 10 });
  y = renderTotalLine(doc, "Saldo Pendiente", `${contrato.moneda || "PEN"} ${money(contrato.saldo_pendiente)}`, { y: y + 2 });
  renderPieDatosPago(doc, { y: y + 24, empresa });

  return finalizarBuffer(doc);
}

async function buildRentabilidadPdf({ items, totales }, { estado } = {}) {
  const doc = crearDocumentoMarca();
  let y = renderEncabezadoMarca(doc, { titulo: "RENTABILIDAD DE PROYECTOS", subtitulo: estado ? `Filtro: ${estado}` : "Todos los estados" });

  y = await renderTabla(doc, {
    headers: ["Código", "Proyecto", "Cliente", "Presupuesto", "Costo Total", "Margen", "Margen %"],
    rows: items.map((p) => [
      p.codigo_proyecto, p.nombre, p.cliente_nombre || "-",
      p.presupuesto != null ? money(p.presupuesto) : "-", money(p.costo_total),
      p.margen != null ? money(p.margen) : "-", p.margen_pct != null ? `${p.margen_pct}%` : "-",
    ]),
    widths: [55, 95, 80, 70, 70, 65, 55], alignRight: [3, 4, 5, 6], y, conMarca: true,
  });

  if (totales) {
    y = renderTotalLine(doc, "Presupuesto Total", money(totales.presupuesto), { y: y + 10 });
    y = renderTotalLine(doc, "Costo Total", money(totales.costo_total), { y: y + 2 });
    renderTotalLine(doc, "Margen Total", money(totales.margen), { y: y + 2 });
  }

  return finalizarBuffer(doc);
}

// Orden de Compra: ICR le paga al proveedor (al revés que Cotización/
// Contrato), así que no lleva el bloque de datos de pago propio al pie —
// esa cuenta es la del proveedor, no la de ICR.
async function buildOrdenCompraPdf(orden) {
  const doc = crearDocumentoMarca();
  const { empresa } = await getSettings();
  const left = doc.page.margins.left;

  const total = orden.items.reduce((sum, it) => sum + Number(it.cantidad_pedida) * Number(it.costo_unitario), 0);

  renderEncabezadoMarca(doc, { titulo: "ORDEN DE COMPRA", subtitulo: `N° ${orden.numero}`, empresa });
  let y = renderFilaEntidadMonto(doc, {
    y: 172,
    tituloIzq: orden.proveedor_nombre, notaIzq: `RUC: ${orden.proveedor_ruc || "-"}`,
    tituloDer: `Total: ${orden.moneda || "PEN"} ${money(total)}`, notaDer: `Estado: ${orden.estado}`,
  });

  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Almacén destino: ", left, y, { continued: true });
  doc.font("Helvetica").text(orden.almacen_nombre || "-");
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Fecha esperada: ", left, doc.y + 2, { continued: true });
  doc.font("Helvetica").text(fecha(orden.fecha_esperada));
  y = doc.y + 16;

  const filas = orden.items.map((it, i) => [
    String(i + 1), it.producto_imagen_url, `${it.producto_nombre} (${it.sku})`,
    Number(it.cantidad_pedida).toLocaleString("es-PE"), money(it.costo_unitario), money(it.cantidad_pedida * it.costo_unitario),
  ]);
  y = await renderTablaItemsConFoto(doc, { y, filas });
  y = renderTotalLine(doc, "Total", `${orden.moneda || "PEN"} ${money(total)}`, { y: y + 12 });

  if (orden.observaciones) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.navy).text("Observaciones", left, y + 16);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.text).text(orden.observaciones, left, doc.y + 2, { width: doc.page.width - left - doc.page.margins.right });
  }

  return finalizarBuffer(doc);
}

async function buildGastoPdf(gasto) {
  const doc = crearDocumentoMarca();
  const { empresa } = await getSettings();
  let y = renderEncabezadoMarca(doc, { titulo: "COMPROBANTE DE GASTO", subtitulo: fecha(gasto.fecha), empresa });

  y = renderInfoBlock(doc, [
    ["Categoría", gasto.categoria],
    ["Descripción", gasto.descripcion],
    ["Fecha", fecha(gasto.fecha)],
    ["Proyecto", gasto.codigo_proyecto || "-"],
    ["Reembolso a", gasto.empleado_nombre || "-"],
    ["Comprobante", gasto.comprobante_tipo ? `${gasto.comprobante_tipo} ${gasto.comprobante_serie_numero || ""}` : "-"],
  ], { y: y + 10 });

  renderTotalLine(doc, "Monto", `${gasto.moneda || "PEN"} ${money(gasto.monto)}`, { y: y + 10 });

  return finalizarBuffer(doc);
}

module.exports = {
  buildBalanceGeneralPdf, buildEstadoResultadosPdf, buildCotizacionPdf, buildContratoPdf, buildRentabilidadPdf,
  buildOrdenCompraPdf, buildGastoPdf,
};

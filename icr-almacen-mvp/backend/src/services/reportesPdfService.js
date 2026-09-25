// Arma los PDF de los reportes/documentos del ERP a partir de los datos que
// ya devuelven los services de cada dominio (contabilidadService,
// cotizacionesService, ventasService, proyectosService) — este archivo solo
// se encarga del formato visual, reusando los helpers de pdfService.js.
const { crearDocumento, renderEncabezado, renderInfoBlock, renderTabla, renderTotalLine, finalizarBuffer } = require("./pdfService");
const { getSettings } = require("./settingsService");

function money(n) {
  return Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fecha(d) {
  return d ? new Date(d).toLocaleDateString("es-PE") : "-";
}

async function buildBalanceGeneralPdf(data) {
  const doc = crearDocumento();
  renderEncabezado(doc, { titulo: "Balance General", subtitulo: `Al ${fecha(data.fecha_corte)}` });

  const activos = data.cuentas.filter((c) => c.tipo === "ACTIVO");
  const pasivos = data.cuentas.filter((c) => c.tipo === "PASIVO");
  const patrimonio = data.cuentas.filter((c) => c.tipo === "PATRIMONIO");

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#00004C").text("ACTIVO");
  doc.moveDown(0.3);
  renderTabla(doc, {
    headers: ["Código", "Cuenta", "Saldo (S/)"],
    rows: activos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100],
    alignRight: [2],
  });
  renderTotalLine(doc, "Total Activo", `S/ ${money(data.total_activo)}`);

  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#00004C").text("PASIVO");
  doc.moveDown(0.3);
  renderTabla(doc, {
    headers: ["Código", "Cuenta", "Saldo (S/)"],
    rows: pasivos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100],
    alignRight: [2],
  });
  renderTotalLine(doc, "Total Pasivo", `S/ ${money(data.total_pasivo)}`);

  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#00004C").text("PATRIMONIO");
  doc.moveDown(0.3);
  renderTabla(doc, {
    headers: ["Código", "Cuenta", "Saldo (S/)"],
    rows: [...patrimonio.map((c) => [c.codigo, c.nombre, money(c.saldo)]), ["-", "Resultado del ejercicio", money(data.resultado_ejercicio)]],
    widths: [80, 300, 100],
    alignRight: [2],
  });
  renderTotalLine(doc, "Total Patrimonio", `S/ ${money(data.total_patrimonio)}`);

  doc.moveDown(1);
  renderTotalLine(doc, "Total Pasivo + Patrimonio", `S/ ${money(data.total_pasivo + data.total_patrimonio)}`);

  return finalizarBuffer(doc);
}

async function buildEstadoResultadosPdf(data) {
  const doc = crearDocumento();
  renderEncabezado(doc, { titulo: "Estado de Resultados", subtitulo: `Del ${fecha(data.fecha_desde)} al ${fecha(data.fecha_hasta)}` });

  const ingresos = data.cuentas.filter((c) => c.tipo === "INGRESO");
  const gastos = data.cuentas.filter((c) => c.tipo === "GASTO");

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#00004C").text("INGRESOS");
  doc.moveDown(0.3);
  renderTabla(doc, {
    headers: ["Código", "Cuenta", "Monto (S/)"],
    rows: ingresos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100],
    alignRight: [2],
  });
  renderTotalLine(doc, "Total Ingresos", `S/ ${money(data.total_ingresos)}`);

  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#00004C").text("GASTOS");
  doc.moveDown(0.3);
  renderTabla(doc, {
    headers: ["Código", "Cuenta", "Monto (S/)"],
    rows: gastos.map((c) => [c.codigo, c.nombre, money(c.saldo)]),
    widths: [80, 300, 100],
    alignRight: [2],
  });
  renderTotalLine(doc, "Total Gastos", `S/ ${money(data.total_gastos)}`);

  doc.moveDown(1);
  renderTotalLine(doc, "Utilidad Neta", `S/ ${money(data.utilidad_neta)}`);

  return finalizarBuffer(doc);
}

async function buildCotizacionPdf(cotizacion) {
  const doc = crearDocumento();
  const { empresa } = await getSettings();
  renderEncabezado(doc, { titulo: "Cotización", subtitulo: cotizacion.codigo, empresa });

  const fechaVencimiento = new Date(cotizacion.fecha_emision);
  fechaVencimiento.setDate(fechaVencimiento.getDate() + cotizacion.validez_dias);

  renderInfoBlock(doc, [
    ["Cliente", cotizacion.cliente_nombre],
    ["RUC", cotizacion.cliente_ruc || "-"],
    ["Fecha de emisión", fecha(cotizacion.fecha_emision)],
    ["Válida hasta", fecha(fechaVencimiento)],
    ["Estado", cotizacion.estado],
  ]);

  renderTabla(doc, {
    headers: ["Descripción", "Cantidad", "P. Unitario", "Subtotal"],
    rows: cotizacion.items.map((it) => [
      it.descripcion,
      Number(it.cantidad).toLocaleString("es-PE"),
      money(it.precio_unitario),
      money(it.cantidad * it.precio_unitario),
    ]),
    widths: [235, 70, 90, 90],
    alignRight: [1, 2, 3],
  });

  renderTotalLine(doc, "Total", `${cotizacion.moneda || "PEN"} ${money(cotizacion.total)}`);

  return finalizarBuffer(doc);
}

async function buildContratoPdf(contrato) {
  const doc = crearDocumento();
  const { empresa } = await getSettings();
  renderEncabezado(doc, { titulo: "Contrato de Venta", subtitulo: contrato.codigo_contrato, empresa });

  renderInfoBlock(doc, [
    ["Cliente", contrato.cliente_nombre],
    ["RUC", contrato.cliente_ruc || "-"],
    ["Fecha de firma", fecha(contrato.fecha_firma)],
    ["Estado", contrato.estado],
    ["Monto total", `${contrato.moneda || "PEN"} ${money(contrato.monto_total)}`],
  ]);

  renderTabla(doc, {
    headers: ["Hito", "Monto", "Fecha esperada", "Estado"],
    rows: contrato.hitos.map((h) => [h.descripcion, money(h.monto), fecha(h.fecha_esperada), h.estado]),
    widths: [200, 85, 105, 100],
    alignRight: [1],
  });

  renderTotalLine(doc, "Monto Cobrado", `${contrato.moneda || "PEN"} ${money(contrato.monto_cobrado)}`);
  renderTotalLine(doc, "Saldo Pendiente", `${contrato.moneda || "PEN"} ${money(contrato.saldo_pendiente)}`);

  return finalizarBuffer(doc);
}

async function buildRentabilidadPdf({ items, totales }, { estado } = {}) {
  const doc = crearDocumento();
  renderEncabezado(doc, { titulo: "Rentabilidad de Proyectos", subtitulo: estado ? `Filtro: ${estado}` : "Todos los estados" });

  renderTabla(doc, {
    headers: ["Código", "Proyecto", "Cliente", "Presupuesto", "Costo Total", "Margen", "Margen %"],
    rows: items.map((p) => [
      p.codigo_proyecto,
      p.nombre,
      p.cliente_nombre || "-",
      p.presupuesto != null ? money(p.presupuesto) : "-",
      money(p.costo_total),
      p.margen != null ? money(p.margen) : "-",
      p.margen_pct != null ? `${p.margen_pct}%` : "-",
    ]),
    widths: [55, 95, 80, 70, 70, 65, 55],
    alignRight: [3, 4, 5, 6],
  });

  if (totales) {
    renderTotalLine(doc, "Presupuesto Total", money(totales.presupuesto));
    renderTotalLine(doc, "Costo Total", money(totales.costo_total));
    renderTotalLine(doc, "Margen Total", money(totales.margen));
  }

  return finalizarBuffer(doc);
}

async function buildOrdenCompraPdf(orden) {
  const doc = crearDocumento();
  const { empresa } = await getSettings();
  renderEncabezado(doc, { titulo: "Orden de Compra", subtitulo: orden.numero, empresa });

  renderInfoBlock(doc, [
    ["Proveedor", orden.proveedor_nombre],
    ["RUC", orden.proveedor_ruc || "-"],
    ["Almacén destino", orden.almacen_nombre],
    ["Fecha de emisión", fecha(orden.fecha_emision)],
    ["Fecha esperada", fecha(orden.fecha_esperada)],
    ["Estado", orden.estado],
  ]);

  const total = orden.items.reduce((sum, it) => sum + Number(it.cantidad_pedida) * Number(it.costo_unitario), 0);

  renderTabla(doc, {
    headers: ["Producto", "SKU", "Cantidad", "Costo Unit.", "Subtotal"],
    rows: orden.items.map((it) => [
      it.producto_nombre,
      it.sku,
      Number(it.cantidad_pedida).toLocaleString("es-PE"),
      money(it.costo_unitario),
      money(it.cantidad_pedida * it.costo_unitario),
    ]),
    widths: [175, 80, 60, 85, 90],
    alignRight: [2, 3, 4],
  });

  renderTotalLine(doc, "Total", `${orden.moneda || "PEN"} ${money(total)}`);

  if (orden.observaciones) {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#00004C").text("Observaciones");
    doc.font("Helvetica").fontSize(9).fillColor("#1e293b").text(orden.observaciones);
  }

  return finalizarBuffer(doc);
}

async function buildGastoPdf(gasto) {
  const doc = crearDocumento();
  const { empresa } = await getSettings();
  renderEncabezado(doc, { titulo: "Comprobante de Gasto", subtitulo: fecha(gasto.fecha), empresa });

  renderInfoBlock(doc, [
    ["Categoría", gasto.categoria],
    ["Descripción", gasto.descripcion],
    ["Fecha", fecha(gasto.fecha)],
    ["Proyecto", gasto.codigo_proyecto || "-"],
    ["Reembolso a", gasto.empleado_nombre || "-"],
    ["Comprobante", gasto.comprobante_tipo ? `${gasto.comprobante_tipo} ${gasto.comprobante_serie_numero || ""}` : "-"],
  ]);

  renderTotalLine(doc, "Monto", `${gasto.moneda || "PEN"} ${money(gasto.monto)}`);

  return finalizarBuffer(doc);
}

module.exports = {
  buildBalanceGeneralPdf, buildEstadoResultadosPdf, buildCotizacionPdf, buildContratoPdf, buildRentabilidadPdf,
  buildOrdenCompraPdf, buildGastoPdf,
};

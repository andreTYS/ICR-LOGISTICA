// Arma los PDF de los reportes/documentos del ERP a partir de los datos que
// ya devuelven los services de cada dominio (contabilidadService,
// cotizacionesService, ventasService, proyectosService) — este archivo solo
// se encarga del formato visual, reusando los helpers de pdfService.js.
const {
  crearDocumento, renderEncabezado, renderInfoBlock, renderTabla, renderTotalLine, finalizarBuffer, COLORS,
  renderFondoCotizacion, cargarImagenProducto,
} = require("./pdfService");
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

// Formato con el estilo de marca que ya usa el equipo de ventas (fondo con
// las franjas superior/inferior de ICR Energy, tabla de ítems con foto de
// cada producto, bloque de datos de pago al pie) — ver assets/cotizacion-fondo.png
// y el informe de arquitectura para el porqué de este rediseño.
async function buildCotizacionPdf(cotizacion) {
  // top/bottom despejan las franjas navy del fondo (~80pt arriba, ~72pt abajo
  // — ver assets/cotizacion-fondo.png, franjas medidas en 194px/1874px de 2048 a 842pt de alto).
  const doc = crearDocumento({ margins: { top: 95, bottom: 72, left: 50, right: 50 } });
  renderFondoCotizacion(doc);
  const { empresa } = await getSettings();

  const left = doc.page.margins.left; // 50
  const right = doc.page.width - doc.page.margins.right; // 545.28
  const usableWidth = right - left;

  const fechaVencimiento = new Date(cotizacion.fecha_emision);
  fechaVencimiento.setDate(fechaVencimiento.getDate() + cotizacion.validez_dias);

  // -------- Franja superior (navy, ya dibujada por el fondo): RUC --------
  if (empresa?.ruc) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(`RUC: ${empresa.ruc}`, left, 34, { width: usableWidth, align: "right" });
  }

  // -------- Título --------
  doc.font("Helvetica-Bold").fontSize(20).fillColor(COLORS.navy).text("COTIZACIÓN", left, 106, { width: usableWidth, align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(`N° ${cotizacion.codigo}`, left, 132, { width: usableWidth, align: "center" });

  // -------- Cliente (izquierda) / Total (derecha) --------
  const filaInfoY = 172;
  const mitad = usableWidth / 2;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.text).text(cotizacion.cliente_nombre || "-", left, filaInfoY, { width: mitad - 10 });
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.muted).text(`RUC/DNI: ${cotizacion.cliente_ruc || "-"}`, left, doc.y + 2, { width: mitad - 10 });

  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.navy).text(
    `Total: ${cotizacion.moneda || "PEN"} ${money(cotizacion.total)}`, left + mitad + 10, filaInfoY, { width: mitad - 10, align: "right" }
  );
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.muted).text(
    `(Válido hasta ${fecha(fechaVencimiento)})`, left + mitad + 10, doc.y + 2, { width: mitad - 10, align: "right" }
  );

  // -------- Vendedor / correo --------
  const filaVendedorY = 222;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Vendedor: ", left, filaVendedorY, { continued: true });
  doc.font("Helvetica").text(cotizacion.responsable_nombre || "-");
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Correo: ", left, doc.y + 2, { continued: true });
  doc.font("Helvetica").text(cotizacion.responsable_email || empresa?.correo || "-");

  // -------- Tabla de ítems, con foto de cada producto --------
  const cols = [
    { titulo: "N°", w: 26 },
    { titulo: "Imagen", w: 52 },
    { titulo: "Descripción del artículo", w: 210 },
    { titulo: "Cant.", w: 48 },
    { titulo: "P.Unidad", w: 75 },
    { titulo: "P. Final", w: usableWidth - (26 + 52 + 210 + 48 + 75) },
  ];
  const colX = [left];
  cols.forEach((c, i) => colX.push(colX[i] + c.w));

  let y = 254;
  const headerH = 22;
  doc.rect(left, y, usableWidth, headerH).fill(COLORS.navy);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  cols.forEach((c, i) => doc.text(c.titulo, colX[i] + 4, y + 6, { width: c.w - 8, align: i >= 3 ? "right" : "left" }));
  y += headerH;

  const rowH = 50;
  const imgBox = 40; // caja cuadrada para la foto, centrada en la columna "Imagen"
  for (let i = 0; i < cotizacion.items.length; i++) {
    const it = cotizacion.items[i];
    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      renderFondoCotizacion(doc);
      y = 60;
    }
    doc.strokeColor(COLORS.line).lineWidth(0.5).moveTo(left, y + rowH).lineTo(right, y + rowH).stroke();
    doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(9).text(String(i + 1), colX[0], y + rowH / 2 - 5, { width: cols[0].w, align: "center" });

    // eslint-disable-next-line no-await-in-loop
    const foto = await cargarImagenProducto(it.producto_imagen_url);
    if (foto) {
      try {
        doc.image(foto, colX[1] + (cols[1].w - imgBox) / 2, y + (rowH - imgBox) / 2, { fit: [imgBox, imgBox], align: "center", valign: "center" });
      } catch {
        // Foto en un formato que PDFKit no soporta (raro, pero no debe tumbar el PDF) — celda en blanco.
      }
    }

    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text(it.descripcion, colX[2] + 4, y + 8, { width: cols[2].w - 8 });
    doc.font("Helvetica").fontSize(9).text(Number(it.cantidad).toLocaleString("es-PE"), colX[3] + 4, y + rowH / 2 - 5, { width: cols[3].w - 8, align: "right" });
    doc.text(money(it.precio_unitario), colX[4] + 4, y + rowH / 2 - 5, { width: cols[4].w - 8, align: "right" });
    doc.font("Helvetica-Bold").text(money(it.cantidad * it.precio_unitario), colX[5] + 4, y + rowH / 2 - 5, { width: cols[5].w - 8, align: "right" });

    y += rowH;
  }

  // -------- Precio final --------
  y += 16;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.navy).text(
    `Precio final (inc. IGV): ${cotizacion.moneda || "PEN"} ${money(cotizacion.total)}`, left, y, { width: usableWidth, align: "right" }
  );

  // -------- Datos de pago (si están configurados en Administración → Configuración) --------
  if (empresa?.razon_social || empresa?.banco) {
    y += 40;
    const mitadPago = usableWidth / 2;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Razón social: ", left, y, { continued: true });
    doc.font("Helvetica").text(empresa.razon_social || "-");
    if (empresa.banco) {
      doc.font("Helvetica-Bold").text("Banco: ", left, doc.y + 2, { continued: true });
      doc.font("Helvetica").text(empresa.banco);
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Número de cuenta: ", left + mitadPago, y, { continued: true });
    doc.font("Helvetica").text(empresa.numero_cuenta || "-");
    if (empresa.cci) {
      doc.font("Helvetica-Bold").text("CCI: ", left + mitadPago, doc.y + 2, { continued: true });
      doc.font("Helvetica").text(empresa.cci);
    }
  }

  return finalizarBuffer(doc, { sinPiePagina: true });
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

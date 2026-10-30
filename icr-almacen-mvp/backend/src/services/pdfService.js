const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { uploadsDir } = require("../uploads");

// Paleta compartida con el resto del panel (#00004C / #000073 / #00B7C2)
const COLORS = { navy: "#00004C", text: "#1e293b", muted: "#64748b", line: "#cbd5e1", zebra: "#f1f5f9" };

// Fondo de página (franjas navy superior/inferior + textura + logo) con el
// formato de marca de ICR Energy que ya circula a los clientes — extraído
// de una cotización real (ver assets/fondo-marca.png). Todos los
// documentos emitidos lo usan; las franjas dejan libre el área entre
// ~95pt y ~770pt de los 842pt de una página A4 (ver MARGENES_MARCA).
const FONDO_MARCA = path.join(__dirname, "..", "..", "assets", "fondo-marca.png");
const MARGENES_MARCA = { top: 95, bottom: 72, left: 50, right: 50 };

/** Dibuja el fondo a página completa (A4) — llamarlo ANTES de cualquier otro contenido de esa página. */
function renderFondoMarca(doc) {
  doc.image(FONDO_MARCA, 0, 0, { width: doc.page.width, height: doc.page.height });
}

/** Documento A4 con el fondo de marca ya dibujado y los márgenes que dejan libres sus franjas. */
function crearDocumentoMarca() {
  const doc = new PDFDocument({ size: "A4", margins: MARGENES_MARCA, bufferPages: true });
  renderFondoMarca(doc);
  return doc;
}

// Trae la foto de un producto como Buffer para incrustarla en el PDF — local
// (/uploads/..., la mayoría) vía disco, o una URL externa vía fetch. Nunca
// lanza: una foto que no carga deja esa celda en blanco en vez de romper
// todo el documento (puede ser un archivo borrado, una URL caída, un
// formato que PDFKit no soporta, etc.).
async function cargarImagenProducto(url) {
  if (!url) return null;
  try {
    if (url.startsWith("/uploads/")) {
      return await fs.promises.readFile(path.join(uploadsDir, path.basename(url)));
    }
    if (/^https?:\/\//.test(url)) {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    }
  } catch {
    return null;
  }
  return null;
}

// -------- Encabezado de marca: RUC (en la franja navy) + título + subtítulo --------
// `empresa` es opcional (viene de settingsService.getSettings().empresa):
// mientras nadie complete "Datos de la empresa" en Administración →
// Configuración, el encabezado se ve igual (sin el RUC). Devuelve el y
// donde el contenido siguiente puede empezar a dibujarse.
function renderEncabezadoMarca(doc, { titulo, subtitulo, empresa }) {
  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (empresa?.ruc) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(`RUC: ${empresa.ruc}`, left, 34, { width: usableWidth, align: "right" });
  }
  doc.font("Helvetica-Bold").fontSize(20).fillColor(COLORS.navy).text(titulo, left, 106, { width: usableWidth, align: "center" });
  if (subtitulo) {
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(subtitulo, left, 132, { width: usableWidth, align: "center" });
  }
  return subtitulo ? 160 : 140;
}

// Fila de dos columnas bajo el encabezado — a la izquierda la entidad del
// documento (cliente/proveedor) con una nota chica debajo, a la derecha el
// monto principal con otra nota chica debajo (ej. validez, estado). Devuelve
// el y donde sigue el contenido.
function renderFilaEntidadMonto(doc, { y, tituloIzq, notaIzq, tituloDer, notaDer }) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const mitad = (right - left) / 2;

  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.text).text(tituloIzq || "-", left, y, { width: mitad - 10 });
  if (notaIzq) doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.muted).text(notaIzq, left, doc.y + 2, { width: mitad - 10 });

  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.navy).text(tituloDer || "-", left + mitad + 10, y, { width: mitad - 10, align: "right" });
  if (notaDer) doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.muted).text(notaDer, left + mitad + 10, doc.y + 2, { width: mitad - 10, align: "right" });

  return Math.max(doc.y, y + 34) + 14;
}

// pairs: [[etiqueta, valor], ...] — un dato por línea, etiqueta en negrita.
// Si se pasa `y`, se posiciona ahí (documentos de marca); si no, sigue el
// cursor normal de PDFKit (documentos sin marca).
function renderInfoBlock(doc, pairs, { y } = {}) {
  const left = doc.page.margins.left;
  doc.fontSize(9);
  pairs.forEach(([label, value], i) => {
    const yy = y !== undefined ? y + i * 15 : undefined;
    doc.font("Helvetica-Bold").fillColor(COLORS.text).text(`${label}: `, left, yy, { continued: true });
    doc.font("Helvetica").fillColor(COLORS.text).text(String(value ?? "-"));
  });
  if (y === undefined) doc.moveDown(1);
  return y !== undefined ? y + pairs.length * 15 + 10 : undefined;
}

// Tabla con encabezado navy. Si `imageCol` apunta a una columna, esa celda
// se trata como una URL de foto (vía cargarImagenProducto) en vez de texto,
// con una fila más alta para que la foto entre — así la reusan tanto las
// tablas simples (Balance, Rentabilidad) como las de ítems con foto
// (Cotización, Orden de Compra). Pagina sola, redibujando el fondo de marca
// y repitiendo el encabezado en cada página nueva.
async function renderTabla(doc, { headers, rows, widths, alignRight = [], imageCol = null, y, conMarca = false }) {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidths = widths || headers.map(() => usableWidth / headers.length);
  const minRowHeight = imageCol != null ? 50 : 20;
  const headerHeight = 22;
  const imgBox = 40;
  if (y !== undefined) doc.y = y;

  function nuevaPagina() {
    doc.addPage();
    if (conMarca) renderFondoMarca(doc);
    doc.y = doc.page.margins.top;
  }

  function drawHeaderRow() {
    const yy = doc.y;
    doc.rect(startX, yy, usableWidth, headerHeight).fill(COLORS.navy);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    let x = startX;
    headers.forEach((cell, i) => {
      doc.text(String(cell ?? ""), x + 4, yy + 6, { width: colWidths[i] - 8, align: alignRight.includes(i) ? "right" : "left" });
      x += colWidths[i];
    });
    doc.y = yy + headerHeight;
  }

  // Alto real que necesita cada celda de texto (una descripción larga puede
  // envolver a 2+ líneas) — sin esto, una fila fija de 20pt deja el texto de
  // una celda larga pisando la fila de abajo.
  function altoFila(cells) {
    doc.font("Helvetica").fontSize(9);
    let alto = 0;
    cells.forEach((cell, i) => {
      if (i === imageCol) return;
      alto = Math.max(alto, doc.heightOfString(String(cell ?? ""), { width: colWidths[i] - 8 }));
    });
    return Math.max(minRowHeight, alto + 10);
  }

  async function drawRow(cells, idx) {
    const rowHeight = altoFila(cells);
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      nuevaPagina();
      drawHeaderRow();
    }
    const yy = doc.y;
    if (imageCol == null && idx % 2 === 1) {
      doc.rect(startX, yy, usableWidth, rowHeight).fill(COLORS.zebra);
    } else if (imageCol != null) {
      doc.strokeColor(COLORS.line).lineWidth(0.5).moveTo(startX, yy + rowHeight).lineTo(startX + usableWidth, yy + rowHeight).stroke();
    }
    doc.fillColor(COLORS.text).font("Helvetica").fontSize(9);
    let x = startX;
    for (let i = 0; i < cells.length; i++) {
      if (i === imageCol) {
        // eslint-disable-next-line no-await-in-loop
        const foto = await cargarImagenProducto(cells[i]);
        if (foto) {
          try {
            doc.image(foto, x + (colWidths[i] - imgBox) / 2, yy + (rowHeight - imgBox) / 2, { fit: [imgBox, imgBox], align: "center", valign: "center" });
          } catch {
            // Formato que PDFKit no soporta — celda en blanco, no se rompe el documento.
          }
        }
      } else {
        const align = alignRight.includes(i) ? "right" : "left";
        doc.text(String(cells[i] ?? ""), x + 4, yy + 6, { width: colWidths[i] - 8, align });
      }
      x += colWidths[i];
    }
    doc.y = yy + rowHeight;
  }

  drawHeaderRow();
  for (let idx = 0; idx < rows.length; idx++) {
    // eslint-disable-next-line no-await-in-loop
    await drawRow(rows[idx], idx);
  }
  return doc.y;
}

// Línea de total, alineada a la derecha, debajo de una tabla. Recibe x/width
// explícitos (no el cursor `doc.x` que deja renderTabla, apuntando a la
// última columna) — si no, el texto queda encajado en un ancho angosto y
// PDFKit lo parte letra por letra en una cascada vertical.
function renderTotalLine(doc, label, value, { y } = {}) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const yy = y !== undefined ? y : doc.y + 8;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text(`${label}: ${value}`, x, yy, { width, align: "right" });
  return doc.y + 6;
}

// Bloque de datos de pago (razón social / banco / n° de cuenta / CCI) al
// pie de un documento que el cliente va a pagar (Cotización, Contrato de
// Venta) — se omite solo si no hay nada configurado en Administración →
// Configuración. No aplica a documentos donde ICR es quien paga (Orden de
// Compra) ni a reportes internos.
function renderPieDatosPago(doc, { y, empresa }) {
  if (!empresa?.razon_social && !empresa?.banco) return y;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const mitad = (right - left) / 2;
  let yy = y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Razón social: ", left, yy, { continued: true });
  doc.font("Helvetica").text(empresa.razon_social || "-");
  if (empresa.banco) {
    doc.font("Helvetica-Bold").text("Banco: ", left, doc.y + 2, { continued: true });
    doc.font("Helvetica").text(empresa.banco);
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Número de cuenta: ", left + mitad, yy, { continued: true });
  doc.font("Helvetica").text(empresa.numero_cuenta || "-");
  if (empresa.cci) {
    doc.font("Helvetica-Bold").text("CCI: ", left + mitad, doc.y + 2, { continued: true });
    doc.font("Helvetica").text(empresa.cci);
  }
  return doc.y;
}

function finalizarBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

module.exports = {
  crearDocumentoMarca, renderFondoMarca, renderEncabezadoMarca, renderFilaEntidadMonto, renderInfoBlock,
  renderTabla, renderTotalLine, renderPieDatosPago, cargarImagenProducto, finalizarBuffer, COLORS,
};

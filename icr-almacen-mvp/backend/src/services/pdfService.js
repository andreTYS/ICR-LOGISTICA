const PDFDocument = require("pdfkit");

// Paleta compartida con el resto del panel (#00004C / #000073 / #00B7C2)
const COLORS = { navy: "#00004C", text: "#1e293b", muted: "#64748b", line: "#cbd5e1", zebra: "#f1f5f9" };

function crearDocumento() {
  return new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
}

function renderEncabezado(doc, { titulo, subtitulo }) {
  doc.fillColor(COLORS.navy).font("Helvetica-Bold").fontSize(16).text("Inversiones ICR");
  doc.fillColor(COLORS.text).fontSize(13).text(titulo);
  if (subtitulo) doc.font("Helvetica").fillColor(COLORS.muted).fontSize(10).text(subtitulo);
  doc.moveDown(0.5);
  doc.strokeColor(COLORS.line).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(1);
}

// pairs: [[etiqueta, valor], ...] — un dato por línea, etiqueta en negrita
function renderInfoBlock(doc, pairs) {
  doc.fontSize(10);
  pairs.forEach(([label, value]) => {
    doc.font("Helvetica-Bold").fillColor(COLORS.text).text(`${label}: `, { continued: true });
    doc.font("Helvetica").fillColor(COLORS.text).text(String(value ?? "-"));
  });
  doc.moveDown(1);
}

// Tabla simple con encabezado resaltado y filas alternadas (zebra). Salta de
// página sola si una fila no entra en el espacio restante.
function renderTabla(doc, { headers, rows, widths, alignRight = [] }) {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidths = widths || headers.map(() => usableWidth / headers.length);
  const rowHeight = 20;

  function drawRow(cells, { bold = false, bg = null } = {}) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    if (bg) {
      doc.rect(startX, y, usableWidth, rowHeight).fill(bg);
      doc.fillColor(bg === COLORS.navy ? "#ffffff" : COLORS.text);
    } else {
      doc.fillColor(COLORS.text);
    }
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    let x = startX;
    cells.forEach((cell, i) => {
      doc.text(String(cell ?? ""), x + 4, y + 5, { width: colWidths[i] - 8, align: alignRight.includes(i) ? "right" : "left" });
      x += colWidths[i];
    });
    doc.y = y + rowHeight;
  }

  drawRow(headers, { bold: true, bg: COLORS.navy });
  rows.forEach((row, idx) => drawRow(row, { bg: idx % 2 === 1 ? COLORS.zebra : null }));
}

// Línea de total, alineada a la derecha, debajo de una tabla
function renderTotalLine(doc, label, value) {
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.navy).text(`${label}: ${value}`, { align: "right" });
}

function renderPiePagina(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text(
      `Página ${i + 1} de ${range.count} — generado el ${new Date().toLocaleString("es-PE")}`,
      doc.page.margins.left,
      doc.page.height - doc.page.margins.bottom + 10,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center" }
    );
  }
}

function finalizarBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    renderPiePagina(doc);
    doc.end();
  });
}

module.exports = { crearDocumento, renderEncabezado, renderInfoBlock, renderTabla, renderTotalLine, finalizarBuffer, COLORS };

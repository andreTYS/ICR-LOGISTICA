// Tests unitarios de la transformación del CSV real de la tienda hacia el
// formato de import-csv del ERP (sin red ni base de datos — ver
// scripts/import-productos-tienda.js para el flujo completo contra la API).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, transformar, buildCsvParaImport, slugCategoria } = require("../scripts/import-productos-tienda");

const CSV_EJEMPLO = [
  "costo,nombre,precio_venta,referencia_interna,unidad_medida,categoria_producto,archivo_imagen,imagen_url",
  '233.0,100/20 MPPT BLUESOLAR,390.0,MPPT 100/20,Unidades,CONTROLADORES,MPPT_100_20.jpg,http://x/MPPT_100_20.jpg',
  '410.0,100/30 MPPT BLUESOLAR,550.0,MPPT 100/30,Unidades,CONTROLADORES,MPPT_100_30.jpg,http://x/MPPT_100_30.jpg',
  '0.0,Panel sin código,360.0,,Unidades,PANELES,panel.jpg,http://x/panel.jpg',
  '0.0,Otro panel sin código,300.0,,Unidades,PANELES,panel2.jpg,http://x/panel2.jpg',
  '50.0,Cable por metro,80.0,CABLE-01,m,CABLES,cable.jpg,http://x/cable.jpg',
  '20.0,"Producto, con coma en el nombre",30.0,MPPT 100/20,Unidades,CONTROLADORES,dup.jpg,http://x/dup.jpg',
].join("\n");

test("slugCategoria normaliza acentos, espacios y símbolos", () => {
  assert.equal(slugCategoria("ALARMA RISCO"), "ALARMA-RISCO");
  assert.equal(slugCategoria("Cám. Inalámbricas"), "CAM-INALAMBRICAS");
  assert.equal(slugCategoria(""), "SIN-CATEGORIA");
  assert.equal(slugCategoria(undefined), "SIN-CATEGORIA");
});

test("transformar conserva el SKU real cuando existe", () => {
  const rows = parseCsv(CSV_EJEMPLO);
  const productos = transformar(rows);
  const mppt = productos.find((p) => p.nombre === "100/20 MPPT BLUESOLAR");
  assert.equal(mppt.sku, "MPPT 100/20");
});

test("transformar genera un SKU determinístico por categoría cuando falta la referencia", () => {
  const rows = parseCsv(CSV_EJEMPLO);
  const productos = transformar(rows);
  const sinCodigo = productos.filter((p) => p.nombre.includes("sin código"));
  assert.equal(sinCodigo.length, 2);
  assert.equal(sinCodigo[0].sku, "PANELES-001");
  assert.equal(sinCodigo[1].sku, "PANELES-002");
});

test("transformar desduplica un SKU real repetido con un sufijo", () => {
  const rows = parseCsv(CSV_EJEMPLO);
  const productos = transformar(rows);
  const conComa = productos.find((p) => p.nombre.includes("con coma"));
  assert.equal(conComa.sku, "MPPT 100/20-2");
});

test("transformar mapea unidad_medida Unidades->UND y m->M", () => {
  const rows = parseCsv(CSV_EJEMPLO);
  const productos = transformar(rows);
  assert.equal(productos.find((p) => p.sku === "MPPT 100/20").unidad_medida, "UND");
  assert.equal(productos.find((p) => p.sku === "CABLE-01").unidad_medida, "M");
});

test("transformar asigna tipo_control NORMAL y conserva categoría/costo/precio", () => {
  const rows = parseCsv(CSV_EJEMPLO);
  const productos = transformar(rows);
  const mppt = productos.find((p) => p.sku === "MPPT 100/20");
  assert.equal(mppt.tipo_control, "NORMAL");
  assert.equal(mppt.categoria, "CONTROLADORES");
  assert.equal(mppt.costo_unitario, "233.0");
  assert.equal(mppt.precio_venta, "390.0");
});

test("buildCsvParaImport produce un CSV válido que RFC4180-parsea de vuelta a los mismos datos", () => {
  const rows = parseCsv(CSV_EJEMPLO);
  const productos = transformar(rows);
  const csv = buildCsvParaImport(productos);
  const parsedBack = parseCsv(csv);
  assert.equal(parsedBack.length, productos.length + 1); // + encabezado
  assert.deepEqual(parsedBack[0], ["sku", "nombre", "tipo_control", "unidad_medida", "costo_unitario", "precio_venta", "categoria"]);
  const filaComa = parsedBack.find((r) => r[1] && r[1].includes("con coma"));
  assert.ok(filaComa, "la fila con coma en el nombre debe sobrevivir el roundtrip de comillas");
});

// Los builders de reportesPdfService toman exactamente lo que ya devuelven
// los services de cada dominio, así que estos tests corren contra datos
// reales del seed (misma filosofía que el resto de la suite: integración
// contra Postgres, no mocks de la capa de datos).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const contabilidad = require("../src/services/contabilidadService");
const cotizaciones = require("../src/services/cotizacionesService");
const ventas = require("../src/services/ventasService");
const proyectos = require("../src/services/proyectosService");
const compras = require("../src/services/comprasService");
const gastos = require("../src/services/gastosService");
const reportesPdf = require("../src/services/reportesPdfService");

const COMPRAS_USER = "00000000-0000-0000-0000-000000000004";
const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const PROVEEDOR_RUC = "20100047218"; // JA Solar Perú Distribuidora S.A.C. (seed.sql)

function assertEsPdfValido(buffer) {
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 100, "el PDF generado es sospechosamente chico");
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF", "debe empezar con la cabecera mágica de PDF");
}

test("buildBalanceGeneralPdf genera un PDF válido a partir de datos reales", async () => {
  const data = await contabilidad.getBalanceGeneral({});
  const buffer = await reportesPdf.buildBalanceGeneralPdf(data);
  assertEsPdfValido(buffer);
});

test("buildEstadoResultadosPdf genera un PDF válido a partir de datos reales", async () => {
  const data = await contabilidad.getEstadoResultados({});
  const buffer = await reportesPdf.buildEstadoResultadosPdf(data);
  assertEsPdfValido(buffer);
});

test("buildCotizacionPdf genera un PDF válido con los ítems de la cotización sembrada", async () => {
  const cotizacion = await cotizaciones.getCotizacion("COT-00001");
  assert.ok(cotizacion.items.length > 0, "el seed debe traer al menos un ítem para que el test sea representativo");
  const buffer = await reportesPdf.buildCotizacionPdf(cotizacion);
  assertEsPdfValido(buffer);
});

test("buildContratoPdf genera un PDF válido con los hitos del contrato sembrado", async () => {
  const contrato = await ventas.getContrato("CONT-00001");
  assert.ok(contrato.hitos.length > 0, "el seed debe traer al menos un hito para que el test sea representativo");
  const buffer = await reportesPdf.buildContratoPdf(contrato);
  assertEsPdfValido(buffer);
});

test("buildRentabilidadPdf genera un PDF válido con la lista de proyectos", async () => {
  const reporte = await proyectos.getReporteRentabilidad({});
  assert.ok(reporte.items.length > 0, "el seed debe traer al menos un proyecto para que el test sea representativo");
  const buffer = await reportesPdf.buildRentabilidadPdf(reporte, {});
  assertEsPdfValido(buffer);
});

test("buildRentabilidadPdf no revienta con una lista vacía (filtro sin resultados)", async () => {
  const reporte = await proyectos.getReporteRentabilidad({ estado: "ESTADO_INEXISTENTE" });
  assert.equal(reporte.items.length, 0);
  const buffer = await reportesPdf.buildRentabilidadPdf(reporte, { estado: "ESTADO_INEXISTENTE" });
  assertEsPdfValido(buffer);
});

test("buildOrdenCompraPdf genera un PDF válido con los ítems de una orden de compra real", async () => {
  const { numero } = await compras.crearOrdenCompra({
    proveedorRuc: PROVEEDOR_RUC, warehouseCode: "ALM-001",
    items: [{ sku: "PANEL-JA-550", quantity: 10, unitCost: 850 }],
    observaciones: "Entregar en el almacén principal antes de las 10am.",
    usuarioId: COMPRAS_USER, canal: "web",
  });
  const orden = await compras.getOrdenCompra(numero);
  assert.ok(orden.items.length > 0, "la orden recién creada debe traer al menos un ítem");
  const buffer = await reportesPdf.buildOrdenCompraPdf(orden);
  assertEsPdfValido(buffer);
});

test("buildGastoPdf genera un PDF válido a partir de un gasto real", async () => {
  const { gasto } = await gastos.registrarGasto({
    categoria: "COMBUSTIBLE", descripcion: "Gasolina camioneta", monto: 150,
    comprobante: { tipo: "BOLETA", serie_numero: "B001-123" }, usuarioId: SUPERVISOR, canal: "web",
  });
  const detalle = await gastos.getGasto(gasto.gasto_id);
  const buffer = await reportesPdf.buildGastoPdf(detalle);
  assertEsPdfValido(buffer);
});

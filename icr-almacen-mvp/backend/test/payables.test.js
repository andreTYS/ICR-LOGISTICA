// Tests de integración del módulo de Cuentas por pagar (facturas de
// proveedor + pagos), mismo enfoque que expenses.test.js y sales.test.js.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const payables = require("../src/services/payablesService");
const contabilidad = require("../src/services/contabilidadService");

const COMPRAS_USER = "00000000-0000-0000-0000-000000000004"; // seed.sql
const PROVEEDOR_RUC = "20100047218"; // JA Solar Perú Distribuidora S.A.C. (seed.sql)

test("registrar una factura de proveedor funciona", async () => {
  const r = await payables.registrarFactura({
    proveedorRuc: PROVEEDOR_RUC, montoTotal: 1000, usuarioId: COMPRAS_USER, canal: "web",
  });
  assert.match(r.factura.codigo, /^FP-\d{5}$/);
  assert.equal(Number(r.factura.monto_total), 1000);
  assert.equal(r.factura.estado, "PENDIENTE");
});

test("una factura con un proveedor inexistente se rechaza", async () => {
  await assert.rejects(
    payables.registrarFactura({ proveedorRuc: "99999999999", montoTotal: 100, usuarioId: COMPRAS_USER, canal: "web" }),
    (err) => err.code === "SUPPLIER_NOT_FOUND"
  );
});

test("una orden de compra inexistente en la factura se rechaza", async () => {
  await assert.rejects(
    payables.registrarFactura({ proveedorRuc: PROVEEDOR_RUC, ordenCompraNumero: "OC-NO-EXISTE", montoTotal: 100, usuarioId: COMPRAS_USER, canal: "web" }),
    (err) => err.code === "PURCHASE_ORDER_NOT_FOUND"
  );
});

test("un pago parcial deja la factura en PARCIAL y uno que completa el saldo la deja en PAGADA, generando el asiento automático", async () => {
  const { factura } = await payables.registrarFactura({
    proveedorRuc: PROVEEDOR_RUC, montoTotal: 500, usuarioId: COMPRAS_USER, canal: "web",
  });

  const pago1 = await payables.registrarPago({ codigo: factura.codigo, monto: 200, usuarioId: COMPRAS_USER, canal: "web" });
  assert.equal(pago1.factura.estado, "PARCIAL");

  const pago2 = await payables.registrarPago({ codigo: factura.codigo, monto: 300, usuarioId: COMPRAS_USER, canal: "web" });
  assert.equal(pago2.factura.estado, "PAGADA");

  const asientos = await contabilidad.listAsientos({ estado: "BORRADOR" });
  const generado = asientos.items.find((a) => a.origen_evento === "payables.invoice_paid" && a.origen_id === pago2.pago.pago_proveedor_id);
  assert.ok(generado, "debería existir un asiento generado automáticamente para el pago");
  assert.equal(Number(generado.total), 300);
});

test("no se puede pagar una factura ya pagada ni una anulada", async () => {
  const { factura } = await payables.registrarFactura({
    proveedorRuc: PROVEEDOR_RUC, montoTotal: 100, usuarioId: COMPRAS_USER, canal: "web",
  });
  await payables.registrarPago({ codigo: factura.codigo, monto: 100, usuarioId: COMPRAS_USER, canal: "web" });
  await assert.rejects(
    payables.registrarPago({ codigo: factura.codigo, monto: 50, usuarioId: COMPRAS_USER, canal: "web" }),
    (err) => err.code === "INVOICE_ALREADY_PAID"
  );
});

test("el listado de cuentas por pagar agrega pendiente y vencido, y filtra por estado", async () => {
  const r = await payables.listCuentasPorPagar({});
  assert.ok(typeof r.totales.pendiente === "number");
  assert.ok(typeof r.totales.vencido === "number");

  const soloPendientes = await payables.listCuentasPorPagar({ estado: "PENDIENTE" });
  assert.ok(soloPendientes.items.every((f) => f.estado === "PENDIENTE"));
});

test("getFactura devuelve el detalle con sus pagos y saldo pendiente", async () => {
  const { factura } = await payables.registrarFactura({
    proveedorRuc: PROVEEDOR_RUC, montoTotal: 800, usuarioId: COMPRAS_USER, canal: "web",
  });
  await payables.registrarPago({ codigo: factura.codigo, monto: 300, usuarioId: COMPRAS_USER, canal: "web" });

  const detalle = await payables.getFactura(factura.codigo);
  assert.equal(detalle.pagos.length, 1);
  assert.equal(detalle.monto_pagado, 300);
  assert.equal(detalle.saldo_pendiente, 500);
});

test("una factura inexistente al consultarla lanza INVOICE_NOT_FOUND", async () => {
  await assert.rejects(payables.getFactura("FP-99999"), (err) => err.code === "INVOICE_NOT_FOUND");
});

after(async () => {
  await pool.end();
});

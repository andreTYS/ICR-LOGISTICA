// Tests de integración del módulo de Ventas (contratos + hitos de cobro)
// contra una base Postgres real, mismo enfoque que projects.test.js y
// accounting.test.js.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const ventas = require("../src/services/ventasService");
const contabilidad = require("../src/services/contabilidadService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)
const PROYECTO_CODIGO = "PROY-001"; // seed.sql

test("crear un contrato con hitos iniciales", async () => {
  const r = await ventas.crearContrato({
    codigoContrato: "CONT-T01", clienteRuc: CLIENTE_RUC, proyectoCodigo: PROYECTO_CODIGO,
    montoTotal: 10000, usuarioId: SUPERVISOR, canal: "web",
    hitos: [
      { descripcion: "Adelanto 50%", monto: 5000, fecha_esperada: null },
      { descripcion: "Entrega final 50%", monto: 5000, fecha_esperada: null },
    ],
  });
  assert.equal(r.contrato.estado, "VIGENTE");
  assert.equal(r.contrato.cliente_id != null, true);
  assert.equal(r.contrato.proyecto_id != null, true);

  const detalle = await ventas.getContrato("CONT-T01");
  assert.equal(detalle.hitos.length, 2);
  assert.equal(detalle.monto_cobrado, 0);
  assert.equal(detalle.saldo_pendiente, 10000);
});

test("crear un contrato con un RUC de cliente inexistente se rechaza", async () => {
  await assert.rejects(
    ventas.crearContrato({ codigoContrato: "CONT-T02", clienteRuc: "99999999999", montoTotal: 1000, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "CLIENT_NOT_FOUND"
  );
});

test("agregar un hito a un contrato vigente lo deja al final del orden", async () => {
  const r = await ventas.agregarHito({ codigoContrato: "CONT-T01", descripcion: "Hito extra", monto: 500, usuarioId: SUPERVISOR, canal: "web" });
  assert.equal(r.hito.orden, 3);
});

test("no se puede agregar un hito a un contrato cancelado", async () => {
  await ventas.crearContrato({ codigoContrato: "CONT-T03", clienteRuc: CLIENTE_RUC, montoTotal: 2000, usuarioId: SUPERVISOR, canal: "web" });
  await ventas.actualizarEstadoContrato({ codigoContrato: "CONT-T03", estado: "CANCELADO", usuarioId: SUPERVISOR, canal: "web" });
  await assert.rejects(
    ventas.agregarHito({ codigoContrato: "CONT-T03", descripcion: "X", monto: 100, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "CONTRACT_NOT_ACTIVE"
  );
});

test("un estado de contrato inválido se rechaza", async () => {
  await assert.rejects(
    ventas.actualizarEstadoContrato({ codigoContrato: "CONT-T01", estado: "NO_EXISTE", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("registrar el pago de un hito lo marca PAGADO, registra el comprobante y genera un asiento automático en BORRADOR", async () => {
  const detalleAntes = await ventas.getContrato("CONT-T01");
  const hito = detalleAntes.hitos.find((h) => h.descripcion === "Adelanto 50%");

  const r = await ventas.registrarPagoHito({
    codigoContrato: "CONT-T01", hitoId: hito.hito_id, montoPagado: 5000,
    comprobante: { tipo: "FACTURA", serie_numero: "F001-00500" },
    usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.hito.estado, "PAGADO");
  assert.equal(Number(r.hito.monto_pagado), 5000);
  assert.equal(r.comprobante.serie_numero, "F001-00500");

  const detalle = await ventas.getContrato("CONT-T01");
  assert.equal(detalle.monto_cobrado, 5000);
  assert.equal(detalle.saldo_pendiente, 5000);

  const asientos = await contabilidad.listAsientos({ estado: "BORRADOR" });
  const generado = asientos.items.find((a) => a.origen_evento === "sales.milestone_paid" && a.origen_id === hito.hito_id);
  assert.ok(generado, "debería existir un asiento generado automáticamente para el cobro del hito");
  assert.equal(Number(generado.total), 5000);
});

test("no se puede pagar el mismo hito dos veces", async () => {
  const detalle = await ventas.getContrato("CONT-T01");
  const hito = detalle.hitos.find((h) => h.descripcion === "Adelanto 50%");
  await assert.rejects(
    ventas.registrarPagoHito({ codigoContrato: "CONT-T01", hitoId: hito.hito_id, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "MILESTONE_ALREADY_PAID"
  );
});

test("el listado de contratos pagina, filtra por estado y trae el monto cobrado", async () => {
  const vigentes = await ventas.listContratos({ estado: "VIGENTE" });
  assert.ok(vigentes.items.every((c) => c.estado === "VIGENTE"));
  const cont01 = vigentes.items.find((c) => c.codigo_contrato === "CONT-T01");
  assert.equal(Number(cont01.monto_cobrado), 5000);

  const cancelados = await ventas.listContratos({ estado: "CANCELADO" });
  assert.ok(cancelados.items.some((c) => c.codigo_contrato === "CONT-T03"));
});

test("cuentas por cobrar agrega hitos pendientes y vence automáticamente los que ya pasaron de fecha", async () => {
  await ventas.crearContrato({
    codigoContrato: "CONT-T04", clienteRuc: CLIENTE_RUC, montoTotal: 900, usuarioId: SUPERVISOR, canal: "web",
    hitos: [{ descripcion: "Hito vencido", monto: 900, fecha_esperada: "2000-01-01" }],
  });

  const reporte = await ventas.listCuentasPorCobrar({});
  const vencido = reporte.items.find((h) => h.codigo_contrato === "CONT-T04");
  assert.ok(vencido, "el hito con fecha pasada debería aparecer en cuentas por cobrar");
  assert.equal(vencido.estado, "VENCIDO", "debería vencerse automáticamente al consultar el reporte");
  assert.ok(reporte.totales.vencido >= 900);

  const pendiente = reporte.items.find((h) => h.codigo_contrato === "CONT-T01" && h.descripcion === "Entrega final 50%");
  assert.ok(pendiente, "el segundo hito de CONT-T01, todavía sin pagar, debería aparecer como pendiente");
  assert.equal(pendiente.estado, "PENDIENTE");
});

after(async () => {
  await pool.end();
});

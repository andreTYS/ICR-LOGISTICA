// Tests de integración del módulo de Activos y Mantenimiento, mismo enfoque
// que projects.test.js.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const assets = require("../src/services/assetsService");

const ALMACENERO = "00000000-0000-0000-0000-000000000002"; // seed.sql
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)
const PROYECTO_CODIGO = "PROY-001"; // seed.sql
const SKU = "INV-GROWATT-5K"; // seed.sql

test("crear un activo a partir de un SKU funciona y queda OPERATIVO", async () => {
  const r = await assets.crearActivo({
    sku: SKU, descripcion: "Inversor instalado en techo", clienteRuc: CLIENTE_RUC, proyectoCodigo: PROYECTO_CODIGO,
    usuarioId: ALMACENERO, canal: "web",
  });
  assert.equal(r.activo.estado, "OPERATIVO");
  assert.ok(r.activo.producto_id);
});

test("crear un activo sin descripción se rechaza", async () => {
  await assert.rejects(
    assets.crearActivo({ usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un SKU inexistente al crear un activo se rechaza", async () => {
  await assert.rejects(
    assets.crearActivo({ sku: "NO-EXISTE", descripcion: "X", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "PRODUCT_NOT_FOUND"
  );
});

test("un número de serie inexistente al crear un activo se rechaza", async () => {
  await assert.rejects(
    assets.crearActivo({ serieNumero: "SN-NO-EXISTE", descripcion: "X", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SERIAL_NOT_FOUND"
  );
});

test("un cliente inexistente al crear un activo se rechaza", async () => {
  await assert.rejects(
    assets.crearActivo({ descripcion: "X", clienteRuc: "99999999999", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "CLIENT_NOT_FOUND"
  );
});

test("programar un mantenimiento marca el activo EN_MANTENIMIENTO, y completarlo lo vuelve a OPERATIVO", async () => {
  const { activo } = await assets.crearActivo({ descripcion: "Batería BESS de prueba", usuarioId: ALMACENERO, canal: "web" });

  const prog = await assets.programarMantenimiento({
    activoId: activo.activo_id, tipo: "PREVENTIVO", descripcion: "Revisión semestral", usuarioId: ALMACENERO, canal: "web",
  });
  assert.equal(prog.mantenimiento.estado, "PROGRAMADO");

  const detalleEnMant = await assets.getActivo(activo.activo_id);
  assert.equal(detalleEnMant.estado, "EN_MANTENIMIENTO");
  assert.equal(detalleEnMant.mantenimientos.length, 1);

  const comp = await assets.completarMantenimiento({ mantenimientoId: prog.mantenimiento.mantenimiento_id, usuarioId: ALMACENERO, canal: "web" });
  assert.equal(comp.mantenimiento.estado, "COMPLETADO");

  const detalleFinal = await assets.getActivo(activo.activo_id);
  assert.equal(detalleFinal.estado, "OPERATIVO");
});

test("completar un mantenimiento ya completado o cancelado se rechaza", async () => {
  const { activo } = await assets.crearActivo({ descripcion: "Panel de prueba", usuarioId: ALMACENERO, canal: "web" });
  const { mantenimiento } = await assets.programarMantenimiento({ activoId: activo.activo_id, tipo: "CORRECTIVO", usuarioId: ALMACENERO, canal: "web" });
  await assets.completarMantenimiento({ mantenimientoId: mantenimiento.mantenimiento_id, usuarioId: ALMACENERO, canal: "web" });

  await assert.rejects(
    assets.completarMantenimiento({ mantenimientoId: mantenimiento.mantenimiento_id, usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "MAINTENANCE_NOT_OPEN"
  );
});

test("actualizar el estado de un activo a un valor inválido se rechaza", async () => {
  const { activo } = await assets.crearActivo({ descripcion: "X", usuarioId: ALMACENERO, canal: "web" });
  await assert.rejects(
    assets.actualizarEstadoActivo({ activoId: activo.activo_id, estado: "NO_EXISTE", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("el listado de activos y mantenimientos pagina y filtra", async () => {
  const r = await assets.listActivos({ clienteRuc: CLIENTE_RUC });
  assert.ok(r.items.every((a) => a.cliente_nombre));

  const m = await assets.listMantenimientos({ estado: "COMPLETADO" });
  assert.ok(m.items.every((x) => x.estado === "COMPLETADO"));
});

test("getWarrantiesExpiringSoon trae activos con garantía vencida o por vencer, excluyendo RETIRADO", async () => {
  const hoy = new Date();
  const enDias = (n) => {
    const d = new Date(hoy);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const { activo: porVencer } = await assets.crearActivo({
    descripcion: "Panel con garantía por vencer pronto", garantiaInicio: "2020-01-01", garantiaFin: enDias(10), usuarioId: ALMACENERO, canal: "web",
  });
  const { activo: yaVencida } = await assets.crearActivo({
    descripcion: "Panel con garantía ya vencida", garantiaInicio: "2020-01-01", garantiaFin: enDias(-5), usuarioId: ALMACENERO, canal: "web",
  });
  const { activo: lejos } = await assets.crearActivo({
    descripcion: "Panel con garantía lejana", garantiaInicio: "2020-01-01", garantiaFin: enDias(400), usuarioId: ALMACENERO, canal: "web",
  });
  const { activo: retirado } = await assets.crearActivo({
    descripcion: "Panel retirado con garantía por vencer", garantiaInicio: "2020-01-01", garantiaFin: enDias(10), usuarioId: ALMACENERO, canal: "web",
  });
  await assets.actualizarEstadoActivo({ activoId: retirado.activo_id, estado: "RETIRADO", usuarioId: ALMACENERO, canal: "web" });

  const r = await assets.getWarrantiesExpiringSoon({ dias: 60 });
  const ids = r.map((a) => a.activo_id);
  assert.ok(ids.includes(porVencer.activo_id));
  assert.ok(ids.includes(yaVencida.activo_id));
  assert.ok(!ids.includes(lejos.activo_id), "una garantía a 400 días no debería salir con ventana de 60");
  assert.ok(!ids.includes(retirado.activo_id), "un activo RETIRADO no debería salir aunque su garantía esté por vencer");
});

after(async () => {
  await pool.end();
});

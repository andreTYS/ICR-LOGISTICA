// Tests de integración del módulo de Proyectos contra una base Postgres real
// (mismo enfoque que inventory.test.js y purchases.test.js): el costeo real
// de un proyecto se arma cruzando movimientos de SALIDA (que ya llevan
// proyecto_id) con las horas de mano de obra registradas.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const inventory = require("../src/services/inventoryService");
const proyectos = require("../src/services/proyectosService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)

test("crear un proyecto lo deja ACTIVO y sin costo todavía", async () => {
  const p = await proyectos.crearProyecto({
    codigoProyecto: "PROY-T01", nombre: "Instalación 10kW — Test",
    clienteRuc: CLIENTE_RUC, presupuesto: 15000, usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(p.proyecto.estado, "ACTIVO");
  assert.equal(p.proyecto.cliente_id != null, true);

  const detalle = await proyectos.getProyecto("PROY-T01");
  assert.equal(detalle.materiales.length, 0);
  assert.equal(detalle.mano_obra.length, 0);
  assert.equal(detalle.costeo.costo_total, 0);
  assert.equal(detalle.costeo.margen, 15000);
});

test("crear un proyecto con un RUC de cliente inexistente se rechaza", async () => {
  await assert.rejects(
    proyectos.crearProyecto({ codigoProyecto: "PROY-T02", nombre: "X", clienteRuc: "99999999999", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "CLIENT_NOT_FOUND"
  );
});

test("el costeo cruza materiales consumidos (movimientos con proyecto_id) y mano de obra registrada", async () => {
  await proyectos.crearProyecto({ codigoProyecto: "PROY-T03", nombre: "Instalación con costeo", presupuesto: 5000, usuarioId: SUPERVISOR, canal: "web" });

  await inventory.receive({ sku: "PANEL-JA-550", quantity: 10, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.remove({ sku: "PANEL-JA-550", quantity: 4, warehouseCode: "ALM-001", proyectoCodigo: "PROY-T03", usuarioId: ALMACENERO, canal: "web" });
  // una salida SIN proyecto no debe contarse en el costeo del proyecto
  await inventory.remove({ sku: "PANEL-JA-550", quantity: 1, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });

  const tecnicos = await proyectos.listTecnicos();
  const tecnico = tecnicos.find((t) => t.rol_codigo === "ALMACENERO");
  await proyectos.registrarManoObra({
    codigoProyecto: "PROY-T03", tecnicoId: tecnico.usuario_id, horas: 8, costoHora: 20,
    descripcion: "Montaje", usuarioId: SUPERVISOR, canal: "web",
  });

  const detalle = await proyectos.getProyecto("PROY-T03");
  assert.equal(detalle.materiales.length, 1);
  assert.equal(Number(detalle.materiales[0].cantidad_total), 4, "solo la salida con proyecto_id cuenta");
  assert.equal(detalle.costeo.costo_materiales, 4 * 650); // PANEL-JA-550 cuesta 650 en el seed
  assert.equal(detalle.costeo.costo_mano_obra, 8 * 20);
  assert.equal(detalle.costeo.costo_total, 4 * 650 + 8 * 20);
  assert.equal(detalle.costeo.margen, 5000 - detalle.costeo.costo_total);
});

test("no se puede registrar mano de obra en un proyecto cancelado", async () => {
  await proyectos.crearProyecto({ codigoProyecto: "PROY-T04", nombre: "Cancelado", usuarioId: SUPERVISOR, canal: "web" });
  await proyectos.actualizarEstado({ codigoProyecto: "PROY-T04", estado: "CANCELADO", usuarioId: SUPERVISOR, canal: "web" });

  const tecnicos = await proyectos.listTecnicos();
  await assert.rejects(
    proyectos.registrarManoObra({
      codigoProyecto: "PROY-T04", tecnicoId: tecnicos[0].usuario_id, horas: 2, costoHora: 20,
      usuarioId: SUPERVISOR, canal: "web",
    }),
    (err) => err.code === "PROJECT_NOT_ACTIVE"
  );
});

test("un estado inválido se rechaza", async () => {
  await proyectos.crearProyecto({ codigoProyecto: "PROY-T05", nombre: "Estado inválido", usuarioId: SUPERVISOR, canal: "web" });
  await assert.rejects(
    proyectos.actualizarEstado({ codigoProyecto: "PROY-T05", estado: "NO_EXISTE", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("el listado de proyectos pagina y filtra por estado", async () => {
  const activos = await proyectos.listProyectos({ estado: "ACTIVO" });
  assert.ok(activos.items.every((p) => p.estado === "ACTIVO"));
  const cancelados = await proyectos.listProyectos({ estado: "CANCELADO" });
  assert.ok(cancelados.items.some((p) => p.codigo_proyecto === "PROY-T04"));
});

after(async () => {
  await pool.end();
});

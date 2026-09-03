// Tests de integración del módulo de RRHH contra una base Postgres real
// (mismo enfoque que projects.test.js): fichas de empleados + fichaje de
// asistencia, y su integración con Proyectos (costo_hora_sugerido).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const rrhh = require("../src/services/rrhhService");
const proyectos = require("../src/services/proyectosService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const ALMACENERO_USUARIO = "00000000-0000-0000-0000-000000000002";
const ALMACENERO_EMPLEADO = "80000000-0000-0000-0000-000000000001"; // ficha ligada a ALMACENERO_USUARIO (seed.sql)

test("crear un empleado sin vincularlo a un usuario funciona (técnico de campo sin login)", async () => {
  const r = await rrhh.crearEmpleado({
    nombreCompleto: "Test Técnico", dni: "99887766", cargo: "Instalador", tipoContrato: "LOCACION",
    costoHora: 25, usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.empleado.nombre_completo, "Test Técnico");
  assert.equal(r.empleado.usuario_id, null);
  assert.equal(Number(r.empleado.costo_hora), 25);
});

test("crear un empleado con tipoContrato inválido se rechaza", async () => {
  await assert.rejects(
    rrhh.crearEmpleado({ nombreCompleto: "X", tipoContrato: "NO_EXISTE", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("actualizar el costo_hora de un empleado existente", async () => {
  const r = await rrhh.actualizarEmpleado({ empleadoId: ALMACENERO_EMPLEADO, costoHora: 21.5, usuarioId: SUPERVISOR, canal: "web" });
  assert.equal(Number(r.empleado.costo_hora), 21.5);
});

test("listTecnicos() de Proyectos ahora trae costo_hora_sugerido desde RRHH", async () => {
  const tecnicos = await proyectos.listTecnicos();
  const tecnico = tecnicos.find((t) => t.usuario_id === ALMACENERO_USUARIO);
  assert.ok(tecnico, "el usuario ALMACENERO debería aparecer en listTecnicos");
  assert.equal(Number(tecnico.costo_hora_sugerido), 21.5, "debe reflejar el costo_hora recién actualizado en su ficha de empleado");
});

test("marcar entrada y luego salida calcula horas_trabajadas", async () => {
  const entrada = await rrhh.marcarEntrada({ empleadoId: ALMACENERO_EMPLEADO, usuarioId: SUPERVISOR, canal: "web" });
  assert.ok(entrada.asistencia.hora_entrada);
  assert.equal(entrada.asistencia.hora_salida, null);

  // Simula que ya pasó una hora de trabajo, para no depender de un sleep real en el test.
  await pool.query(
    "UPDATE asistencias SET hora_entrada = hora_entrada - INTERVAL '1 hour' WHERE asistencia_id = $1",
    [entrada.asistencia.asistencia_id]
  );

  const salida = await rrhh.marcarSalida({ empleadoId: ALMACENERO_EMPLEADO, usuarioId: SUPERVISOR, canal: "web" });
  assert.ok(salida.asistencia.hora_salida);
  assert.ok(Number(salida.asistencia.horas_trabajadas) >= 0.98 && Number(salida.asistencia.horas_trabajadas) <= 1.02);
});

test("no se puede marcar entrada dos veces el mismo día", async () => {
  await assert.rejects(
    rrhh.marcarEntrada({ empleadoId: ALMACENERO_EMPLEADO, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "ATTENDANCE_ALREADY_MARKED"
  );
});

test("no se puede marcar salida sin una entrada abierta", async () => {
  const nuevo = await rrhh.crearEmpleado({ nombreCompleto: "Sin Entrada", usuarioId: SUPERVISOR, canal: "web" });
  await assert.rejects(
    rrhh.marcarSalida({ empleadoId: nuevo.empleado.empleado_id, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "ATTENDANCE_NOT_OPEN"
  );
});

test("listAsistencias filtra por empleado y devuelve el nombre del empleado", async () => {
  const r = await rrhh.listAsistencias({ empleadoId: ALMACENERO_EMPLEADO });
  assert.ok(r.items.length >= 1);
  assert.ok(r.items.every((a) => a.empleado_id === ALMACENERO_EMPLEADO));
  assert.equal(r.items[0].empleado_nombre, "Operario Almacén");
});

test("listEmpleados pagina y filtra por activo", async () => {
  const activos = await rrhh.listEmpleados({ activo: true });
  assert.ok(activos.items.length >= 5, "el seed trae al menos 5 empleados activos");
  assert.ok(activos.items.every((e) => e.activo === true));
});

after(async () => {
  await pool.end();
});

// Tests de integración de la agenda unificada (Calendario), que agrega
// fechas de leads, mantenimientos, hitos de contrato, garantías y
// asistencia sin tener tabla propia.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const calendario = require("../src/services/calendarioService");
const crm = require("../src/services/crmService");
const assets = require("../src/services/assetsService");
const ventas = require("../src/services/ventasService");
const rrhh = require("../src/services/rrhhService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003"; // seed.sql
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)
const EMPLEADO_ID = "80000000-0000-0000-0000-000000000004"; // Jorge Quispe Mamani (seed.sql, sin marcar hoy)

function fechaEnDias(dias) {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("getEventos agrega seguimientos de leads, mantenimientos, hitos, garantías y asistencia en un solo rango", async () => {
  const desde = fechaEnDias(0);
  const hasta = fechaEnDias(15);

  const lead = await crm.crearLead({
    nombreContacto: "Cliente Calendario", origen: "WEB", fechaProximoSeguimiento: fechaEnDias(5),
    usuarioId: SUPERVISOR, canal: "web",
  });

  const activo = await assets.crearActivo({
    descripcion: "Panel solar de prueba calendario", clienteRuc: CLIENTE_RUC,
    garantiaFin: fechaEnDias(10), usuarioId: SUPERVISOR, canal: "web",
  });
  await assets.programarMantenimiento({
    activoId: activo.activo.activo_id, tipo: "PREVENTIVO", fechaProgramada: fechaEnDias(3),
    usuarioId: SUPERVISOR, canal: "web",
  });

  await ventas.crearContrato({
    codigoContrato: "CTR-CAL-001", clienteRuc: CLIENTE_RUC, montoTotal: 5000,
    hitos: [{ descripcion: "Adelanto calendario", monto: 5000, fecha_esperada: fechaEnDias(7) }],
    usuarioId: SUPERVISOR, canal: "web",
  });

  await rrhh.marcarEntrada({ empleadoId: EMPLEADO_ID, usuarioId: SUPERVISOR, canal: "web" });

  const eventos = await calendario.getEventos({ desde, hasta });
  const tipos = eventos.map((e) => e.tipo);

  assert.ok(eventos.some((e) => e.tipo === "LEAD_SEGUIMIENTO" && e.titulo === lead.lead.codigo));
  assert.ok(eventos.some((e) => e.tipo === "MANTENIMIENTO" && e.entidad_id === activo.activo.activo_id));
  assert.ok(eventos.some((e) => e.tipo === "HITO_CONTRATO" && e.titulo === "CTR-CAL-001"));
  assert.ok(eventos.some((e) => e.tipo === "GARANTIA_VENCE" && e.entidad_id === activo.activo.activo_id));
  assert.ok(eventos.some((e) => e.tipo === "ASISTENCIA" && e.entidad_id === EMPLEADO_ID));

  // ordenado por fecha ascendente
  const fechas = eventos.map((e) => new Date(e.fecha).getTime());
  const ordenado = [...fechas].sort((a, b) => a - b);
  assert.deepEqual(fechas, ordenado);
  assert.ok(tipos.length >= 5);
});

test("getEventos filtra por tipos cuando se especifica", async () => {
  const eventos = await calendario.getEventos({
    desde: fechaEnDias(0), hasta: fechaEnDias(15), tipos: ["GARANTIA_VENCE"],
  });
  assert.ok(eventos.length > 0);
  assert.ok(eventos.every((e) => e.tipo === "GARANTIA_VENCE"));
});

test("getEventos con tipos vacío/desconocido devuelve una lista vacía", async () => {
  const eventos = await calendario.getEventos({
    desde: fechaEnDias(0), hasta: fechaEnDias(15), tipos: ["NO_EXISTE"],
  });
  assert.deepEqual(eventos, []);
});

test("getEventos usa un rango por defecto (hoy → +30 días) si no se especifica", async () => {
  const eventos = await calendario.getEventos({});
  assert.ok(Array.isArray(eventos));
});

test("getEventos rechaza un rango con hasta anterior a desde", async () => {
  await assert.rejects(
    calendario.getEventos({ desde: fechaEnDias(10), hasta: fechaEnDias(0) }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un lead ganado o perdido no aparece como seguimiento pendiente", async () => {
  const lead = await crm.crearLead({
    nombreContacto: "Lead cerrado calendario", origen: "WEB", fechaProximoSeguimiento: fechaEnDias(2),
    usuarioId: SUPERVISOR, canal: "web",
  });
  await crm.actualizarEtapa({ codigo: lead.lead.codigo, etapa: "PERDIDO", motivoPerdida: "No interesado", usuarioId: SUPERVISOR, canal: "web" });

  const eventos = await calendario.getEventos({ desde: fechaEnDias(0), hasta: fechaEnDias(15) });
  assert.ok(!eventos.some((e) => e.tipo === "LEAD_SEGUIMIENTO" && e.titulo === lead.lead.codigo));
});

// Tests de integración del módulo CRM / Pipeline comercial, mismo enfoque
// que cotizaciones.test.js (etapa previa: lead -> cotización -> contrato).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const crm = require("../src/services/crmService");

const VENTAS_USER = "00000000-0000-0000-0000-000000000005"; // seed.sql
const CLIENTE_RUC = "20512345678"; // Constructora Vilca Hnos S.A.C. (seed.sql)

test("crear un lead funciona y queda en NUEVO", async () => {
  const r = await crm.crearLead({ nombreContacto: "Juan Pérez", empresa: "Constructora Vilca", telefono: "999888777", usuarioId: VENTAS_USER, canal: "web" });
  assert.match(r.lead.codigo, /^LEAD-\d{5}$/);
  assert.equal(r.lead.etapa, "NUEVO");
});

test("crear un lead sin nombre de contacto se rechaza", async () => {
  await assert.rejects(
    crm.crearLead({ nombreContacto: "", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("crear un lead con un origen inválido se rechaza", async () => {
  await assert.rejects(
    crm.crearLead({ nombreContacto: "X", origen: "NO_EXISTE", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("crear un lead con un RUC de cliente inexistente se rechaza", async () => {
  await assert.rejects(
    crm.crearLead({ nombreContacto: "X", clienteRuc: "99999999999", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "CLIENT_NOT_FOUND"
  );
});

test("cambiar de etapa funciona, pero no se puede forzar a GANADO directamente", async () => {
  const { lead } = await crm.crearLead({ nombreContacto: "María López", usuarioId: VENTAS_USER, canal: "web" });
  const r = await crm.actualizarEtapa({ codigo: lead.codigo, etapa: "CONTACTADO", usuarioId: VENTAS_USER, canal: "web" });
  assert.equal(r.lead.etapa, "CONTACTADO");

  await assert.rejects(
    crm.actualizarEtapa({ codigo: lead.codigo, etapa: "GANADO", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("marcar un lead como PERDIDO exige un motivo", async () => {
  const { lead } = await crm.crearLead({ nombreContacto: "Pedro Ruiz", usuarioId: VENTAS_USER, canal: "web" });
  await assert.rejects(
    crm.actualizarEtapa({ codigo: lead.codigo, etapa: "PERDIDO", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
  const r = await crm.actualizarEtapa({ codigo: lead.codigo, etapa: "PERDIDO", motivoPerdida: "Presupuesto insuficiente", usuarioId: VENTAS_USER, canal: "web" });
  assert.equal(r.lead.etapa, "PERDIDO");
  assert.equal(r.lead.motivo_perdida, "Presupuesto insuficiente");
});

test("registrar una actividad de seguimiento funciona y aparece en el detalle del lead", async () => {
  const { lead } = await crm.crearLead({ nombreContacto: "Ana Torres", usuarioId: VENTAS_USER, canal: "web" });
  await crm.registrarActividad({ codigo: lead.codigo, tipo: "LLAMADA", descripcion: "Primer contacto telefónico", usuarioId: VENTAS_USER, canal: "web" });

  const detalle = await crm.getLead(lead.codigo);
  assert.equal(detalle.actividades.length, 1);
  assert.equal(detalle.actividades[0].tipo, "LLAMADA");
});

test("registrar una actividad con tipo inválido se rechaza", async () => {
  const { lead } = await crm.crearLead({ nombreContacto: "Luis Vega", usuarioId: VENTAS_USER, canal: "web" });
  await assert.rejects(
    crm.registrarActividad({ codigo: lead.codigo, tipo: "NO_EXISTE", descripcion: "X", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("convertir un lead sin cliente vinculado se rechaza", async () => {
  const { lead } = await crm.crearLead({ nombreContacto: "Sin cliente", usuarioId: VENTAS_USER, canal: "web" });
  await assert.rejects(
    crm.convertirACotizacion({ codigo: lead.codigo, items: [{ descripcion: "X", cantidad: 1, precio_unitario: 100 }], usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "LEAD_WITHOUT_CLIENT"
  );
});

test("convertir un lead con cliente crea una cotización, lo marca GANADO y ya no admite más cambios de etapa", async () => {
  const { lead } = await crm.crearLead({ nombreContacto: "Contacto Vilca", clienteRuc: CLIENTE_RUC, usuarioId: VENTAS_USER, canal: "web" });
  const r = await crm.convertirACotizacion({
    codigo: lead.codigo, items: [{ descripcion: "Panel solar 550W x10", cantidad: 10, precio_unitario: 700 }],
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.equal(r.lead.etapa, "GANADO");
  assert.match(r.cotizacion.codigo, /^COT-\d{5}$/);

  const detalle = await crm.getLead(lead.codigo);
  assert.equal(detalle.cotizacion_codigo, r.cotizacion.codigo);

  await assert.rejects(
    crm.actualizarEtapa({ codigo: lead.codigo, etapa: "PERDIDO", motivoPerdida: "X", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "LEAD_ALREADY_WON"
  );
});

test("el listado de leads pagina y filtra por etapa", async () => {
  const r = await crm.listLeads({ etapa: "GANADO" });
  assert.ok(r.items.every((l) => l.etapa === "GANADO"));
});

after(async () => {
  await pool.end();
});

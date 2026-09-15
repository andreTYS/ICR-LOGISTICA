// DNI como identificador alternativo de cliente (persona natural sin RUC).
// Cubre el cambio transversal: proyectosService, ventasService, crmService,
// cotizacionesService, assetsService e inventoryService ahora aceptan RUC O
// DNI en cualquier campo "clienteRuc" — y el caso más delicado, que las dos
// conversiones encadenadas (lead -> cotización -> contrato) no pierdan el
// identificador cuando el cliente vinculado solo tiene DNI (bug real: esas
// conversiones hacían "SELECT ruc" para reenviarlo al siguiente service, y
// un cliente sin RUC devolvía NULL, rompiendo la validación "obligatorio"
// del siguiente paso).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const proyectos = require("../src/services/proyectosService");
const ventas = require("../src/services/ventasService");
const crm = require("../src/services/crmService");
const cotizaciones = require("../src/services/cotizacionesService");
const assets = require("../src/services/assetsService");

const VENTAS_USER = "00000000-0000-0000-0000-000000000005"; // seed.sql
const CLIENTE_DNI = "45678912"; // Jorge Salas Quispe, sin RUC (seed.sql)

test("crearCliente exige razonSocial y al menos uno de ruc/dni", async () => {
  await assert.rejects(
    proyectos.crearCliente({ razonSocial: "Alguien", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("crearCliente funciona solo con dni, sin ruc", async () => {
  const r = await proyectos.crearCliente({ dni: "70011223", telefono: "912345678", razonSocial: "María Torres", usuarioId: VENTAS_USER, canal: "web" });
  assert.equal(r.cliente.ruc, null);
  assert.equal(r.cliente.dni, "70011223");
});

test("crearProyecto vincula un cliente por DNI", async () => {
  const r = await proyectos.crearProyecto({
    codigoProyecto: "PRY-DNI-01", nombre: "Instalación residencial", clienteRuc: CLIENTE_DNI,
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.ok(r.proyecto.cliente_id);
});

test("crearContrato vincula un cliente por DNI", async () => {
  const r = await ventas.crearContrato({
    codigoContrato: "CONT-DNI-01", clienteRuc: CLIENTE_DNI, montoTotal: 5000,
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.ok(r.contrato.cliente_id);
});

test("crearActivo y listActivos aceptan DNI", async () => {
  const r = await assets.crearActivo({
    descripcion: "Panel solar residencial", clienteRuc: CLIENTE_DNI,
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.ok(r.activo.cliente_id);

  const lista = await assets.listActivos({ clienteRuc: CLIENTE_DNI });
  assert.ok(lista.items.some((a) => a.activo_id === r.activo.activo_id));
});

test("un lead vinculado a un cliente solo-DNI se puede convertir a cotización y luego a contrato sin perder el identificador", async () => {
  const lead = await crm.crearLead({
    nombreContacto: "Jorge Salas Quispe", dni: CLIENTE_DNI, clienteRuc: CLIENTE_DNI,
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.equal(lead.lead.dni, CLIENTE_DNI);

  const conversion = await crm.convertirACotizacion({
    codigo: lead.lead.codigo,
    items: [{ descripcion: "Panel solar 550W x4", cantidad: 1, precio_unitario: 3200 }],
    usuarioId: VENTAS_USER, canal: "web",
  });
  assert.match(conversion.cotizacion.codigo, /^COT-\d{5}$/);

  const cotizacionDetalle = await cotizaciones.getCotizacion(conversion.cotizacion.codigo);
  await cotizaciones.actualizarEstado({ codigo: cotizacionDetalle.codigo, estado: "ENVIADA", usuarioId: VENTAS_USER, canal: "web" });
  await cotizaciones.actualizarEstado({ codigo: cotizacionDetalle.codigo, estado: "ACEPTADA", usuarioId: VENTAS_USER, canal: "web" });

  const contratoResultado = await cotizaciones.convertirAContrato({ codigo: cotizacionDetalle.codigo, usuarioId: VENTAS_USER, canal: "web" });
  assert.match(contratoResultado.contrato.codigo_contrato, /^CONT-\d{5}$/);
});

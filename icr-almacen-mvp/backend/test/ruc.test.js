// Groundwork de consulta RUC/DNI: no hay credenciales reales de un proveedor
// de terceros (Factiliza/DecolectaAPI/etc.) en este entorno, así que la
// llamada de red se mockea con un fetchImpl inyectado (mismo patrón que
// aiChatService.chat) — no depende de la base de datos.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const ruc = require("../src/services/rucService");

const originalEnv = { ...process.env };
beforeEach(() => {
  delete process.env.RUC_API_URL;
  delete process.env.RUC_API_TOKEN;
});
afterEach(() => {
  process.env = { ...originalEnv };
});

test("isConfigured exige ambas variables de entorno", () => {
  assert.equal(ruc.isConfigured(), false);
  process.env.RUC_API_URL = "https://api.example/v1";
  assert.equal(ruc.isConfigured(), false);
  process.env.RUC_API_TOKEN = "token-123";
  assert.equal(ruc.isConfigured(), true);
});

test("consultar rechaza un número que no es ni DNI (8) ni RUC (11)", async () => {
  await assert.rejects(ruc.consultar("123"), (err) => err.code === "SCHEMA_INVALID");
});

test("consultar rechaza sin red real si no está configurado", async () => {
  await assert.rejects(ruc.consultar("12345678"), (err) => err.code === "RUC_LOOKUP_NOT_CONFIGURED");
});

test("consultar detecta DNI (8 dígitos) y arma nombre desde nombres+apellidos", async () => {
  process.env.RUC_API_URL = "https://api.example/v1";
  process.env.RUC_API_TOKEN = "token-123";
  let calledUrl = null;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ data: { nombres: "Jorge", apellido_paterno: "Salas", apellido_materno: "Quispe" } }) };
  };
  const r = await ruc.consultar("45678912", { fetchImpl });
  assert.equal(r.tipo, "dni");
  assert.equal(r.nombre, "Jorge Salas Quispe");
  assert.match(calledUrl, /\/dni\/45678912$/);
});

test("consultar detecta RUC (11 dígitos) y usa razon_social", async () => {
  process.env.RUC_API_URL = "https://api.example/v1";
  process.env.RUC_API_TOKEN = "token-123";
  const fetchImpl = async () => ({ ok: true, json: async () => ({ razon_social: "Constructora Vilca Hnos S.A.C." }) });
  const r = await ruc.consultar("20512345678", { fetchImpl });
  assert.equal(r.tipo, "ruc");
  assert.equal(r.nombre, "Constructora Vilca Hnos S.A.C.");
});

test("consultar lanza RUC_LOOKUP_FAILED si el proveedor responde error", async () => {
  process.env.RUC_API_URL = "https://api.example/v1";
  process.env.RUC_API_TOKEN = "token-123";
  const fetchImpl = async () => ({ ok: false, json: async () => ({ message: "RUC no encontrado" }) });
  await assert.rejects(ruc.consultar("20999999999", { fetchImpl }), (err) => err.code === "RUC_LOOKUP_FAILED" && err.message === "RUC no encontrado");
});

test("consultar lanza RUC_LOOKUP_FAILED si la respuesta no trae nombre reconocible", async () => {
  process.env.RUC_API_URL = "https://api.example/v1";
  process.env.RUC_API_TOKEN = "token-123";
  const fetchImpl = async () => ({ ok: true, json: async () => ({ algun_otro_campo: "x" }) });
  await assert.rejects(ruc.consultar("20999999999", { fetchImpl }), (err) => err.code === "RUC_LOOKUP_FAILED");
});

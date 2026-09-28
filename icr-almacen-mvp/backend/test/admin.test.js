// Tests de adminService: getRolePermissions es una función pura sobre el
// mapa de permisos (sin base de datos). getIntegrationsStatus, en cambio,
// resuelve google_drive/whatsapp vía integracionesConfigService (tabla
// `parametros`), así que esta suite sí necesita una base de test real.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const admin = require("../src/services/adminService");
const integracionesConfig = require("../src/services/integracionesConfigService");

beforeEach(async () => {
  await pool.query("DELETE FROM parametros WHERE clave = ANY($1)", [integracionesConfig.CLAVES_VALIDAS]);
});

after(async () => {
  await pool.end();
});

test("getRolePermissions expone el mapa de permisos por rol, incluyendo el wildcard de ADMIN", () => {
  const roles = admin.getRolePermissions();
  const admin_ = roles.find((r) => r.rol === "ADMIN");
  assert.ok(admin_);
  assert.deepEqual(admin_.permisos, ["*"]);
  const consulta = roles.find((r) => r.rol === "CONSULTA");
  assert.ok(consulta.permisos.includes("inventory.query"));
  assert.ok(!consulta.permisos.includes("inventory.receive"));
});

test("getIntegrationsStatus nunca devuelve el valor de las variables, solo si están configuradas", async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevBotToken = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GEMINI_API_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    let status = await admin.getIntegrationsStatus();
    assert.equal(status.gemini.configurado, false);
    assert.equal(status.telegram_bot.configurado, false);
    assert.equal(status.google_drive.configurado, false);
    assert.ok(!JSON.stringify(status).includes("secreto-de-prueba"));

    process.env.GEMINI_API_KEY = "secreto-de-prueba";
    status = await admin.getIntegrationsStatus();
    assert.equal(status.gemini.configurado, true);
    assert.ok(!JSON.stringify(status).includes("secreto-de-prueba"), "el valor real de la API key nunca debe salir en la respuesta");
  } finally {
    if (prevGemini) process.env.GEMINI_API_KEY = prevGemini; else delete process.env.GEMINI_API_KEY;
    if (prevBotToken) process.env.TELEGRAM_BOT_TOKEN = prevBotToken; else delete process.env.TELEGRAM_BOT_TOKEN;
  }
});

test("google_drive y whatsapp aparecen configurados si se guardaron desde el panel, sin nada en el entorno", async () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.EVOLUTION_API_URL;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_INSTANCE;

  let status = await admin.getIntegrationsStatus();
  assert.equal(status.google_drive.configurado, false);
  assert.equal(status.whatsapp.configurado, false);

  await integracionesConfig.setConfigValue({ clave: "GOOGLE_SERVICE_ACCOUNT_JSON", valor: '{"client_email":"x","private_key":"y"}' });
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_API_URL", valor: "http://evolution.example.com" });
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_API_KEY", valor: "panel-key" });
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_INSTANCE", valor: "icr" });

  status = await admin.getIntegrationsStatus();
  assert.equal(status.google_drive.configurado, true);
  assert.equal(status.whatsapp.configurado, true);
  assert.ok(!JSON.stringify(status).includes("panel-key"), "el valor real de la API key nunca debe salir en la respuesta");
});

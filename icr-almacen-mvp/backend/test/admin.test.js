// Tests de adminService: puras funciones de lectura sobre el mapa de
// permisos y el estado de variables de entorno — sin base de datos, mismo
// enfoque que auth.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("../src/services/adminService");

test("getRolePermissions expone el mapa de permisos por rol, incluyendo el wildcard de ADMIN", () => {
  const roles = admin.getRolePermissions();
  const admin_ = roles.find((r) => r.rol === "ADMIN");
  assert.ok(admin_);
  assert.deepEqual(admin_.permisos, ["*"]);
  const consulta = roles.find((r) => r.rol === "CONSULTA");
  assert.ok(consulta.permisos.includes("inventory.query"));
  assert.ok(!consulta.permisos.includes("inventory.receive"));
});

test("getIntegrationsStatus nunca devuelve el valor de las variables, solo si están configuradas", () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevBotToken = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.GEMINI_API_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    let status = admin.getIntegrationsStatus();
    assert.equal(status.gemini.configurado, false);
    assert.equal(status.telegram_bot.configurado, false);
    assert.ok(!JSON.stringify(status).includes("secreto-de-prueba"));

    process.env.GEMINI_API_KEY = "secreto-de-prueba";
    status = admin.getIntegrationsStatus();
    assert.equal(status.gemini.configurado, true);
    assert.ok(!JSON.stringify(status).includes("secreto-de-prueba"), "el valor real de la API key nunca debe salir en la respuesta");
  } finally {
    if (prevGemini) process.env.GEMINI_API_KEY = prevGemini; else delete process.env.GEMINI_API_KEY;
    if (prevBotToken) process.env.TELEGRAM_BOT_TOKEN = prevBotToken; else delete process.env.TELEGRAM_BOT_TOKEN;
  }
});

// Test del servicio de WhatsApp (Evolution API) — usa un fetch inyectado
// (_setFetchForTests) para las llamadas de red, mismo criterio que
// mail.test.js. EVOLUTION_API_URL/KEY/INSTANCE se resuelven vía
// integracionesConfigService (tabla `parametros`, con la variable de
// entorno como respaldo), por eso esta suite necesita una base de test real.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const whatsapp = require("../src/services/whatsappService");
const integracionesConfig = require("../src/services/integracionesConfigService");

const EVOLUTION_KEYS = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"];
const ORIGINAL_ENV = { ...process.env };

function limpiarEnvEvolution() {
  delete process.env.EVOLUTION_API_URL;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_INSTANCE;
}

beforeEach(async () => {
  limpiarEnvEvolution();
  await pool.query("DELETE FROM parametros WHERE clave = ANY($1)", [EVOLUTION_KEYS]);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  whatsapp._setFetchForTests(null);
});

after(async () => {
  await pool.end();
});

test("un número inválido se rechaza sin intentar enviar", async () => {
  await assert.rejects(
    whatsapp.enviarDocumentoPorWhatsapp({ to: "no-es-un-numero", caption: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "WHATSAPP_INVALID"
  );
});

test("sin nada configurado (ni panel ni variable de entorno), se rechaza con WHATSAPP_NOT_CONFIGURED", async () => {
  assert.equal(await whatsapp.isConfigured(), false);
  await assert.rejects(
    whatsapp.enviarDocumentoPorWhatsapp({ to: "51987654321", caption: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "WHATSAPP_NOT_CONFIGURED"
  );
});

test("con un fetch inyectado, envía el PDF como documento al número correcto (dígitos limpios) — configurado por variable de entorno", async () => {
  process.env.EVOLUTION_API_URL = "http://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.EVOLUTION_INSTANCE = "icr";
  assert.equal(await whatsapp.isConfigured(), true);

  const llamadas = [];
  whatsapp._setFetchForTests(async (url, options) => {
    llamadas.push({ url, options });
    return { ok: true };
  });

  await whatsapp.enviarDocumentoPorWhatsapp({
    to: "+51 987-654-321", caption: "Cotización COT-00001",
    filename: "COT-00001.pdf", buffer: Buffer.from("%PDF-1.4 contenido de prueba"),
  });

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "http://evolution.example.com/message/sendMedia/icr");
  assert.equal(llamadas[0].options.headers.apikey, "test-key");
  const body = JSON.parse(llamadas[0].options.body);
  assert.equal(body.number, "51987654321");
  assert.equal(body.mediatype, "document");
  assert.equal(body.fileName, "COT-00001.pdf");
});

test("con la configuración guardada desde el panel (sin nada en el entorno), también envía correctamente", async () => {
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_API_URL", valor: "http://evolution.example.com" });
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_API_KEY", valor: "panel-key" });
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_INSTANCE", valor: "icr" });
  assert.equal(await whatsapp.isConfigured(), true);

  const llamadas = [];
  whatsapp._setFetchForTests(async (url, options) => {
    llamadas.push({ url, options });
    return { ok: true };
  });

  await whatsapp.enviarDocumentoPorWhatsapp({ to: "51987654321", caption: "x", filename: "x.pdf", buffer: Buffer.from("x") });
  assert.equal(llamadas[0].options.headers.apikey, "panel-key");
});

test("si hay valor guardado en el panel y también en la variable de entorno, gana el del panel", async () => {
  process.env.EVOLUTION_API_URL = "http://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "env-key";
  process.env.EVOLUTION_INSTANCE = "icr";
  await integracionesConfig.setConfigValue({ clave: "EVOLUTION_API_KEY", valor: "panel-key" });

  const llamadas = [];
  whatsapp._setFetchForTests(async (url, options) => {
    llamadas.push({ url, options });
    return { ok: true };
  });

  await whatsapp.enviarDocumentoPorWhatsapp({ to: "51987654321", caption: "x", filename: "x.pdf", buffer: Buffer.from("x") });
  assert.equal(llamadas[0].options.headers.apikey, "panel-key");
});

test("con mimetype de imagen, usa mediatype 'image' en vez de 'document'", async () => {
  process.env.EVOLUTION_API_URL = "http://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.EVOLUTION_INSTANCE = "icr";

  const llamadas = [];
  whatsapp._setFetchForTests(async (url, options) => {
    llamadas.push({ url, options });
    return { ok: true };
  });

  await whatsapp.enviarDocumentoPorWhatsapp({
    to: "51987654321", caption: "Foto de instalación",
    filename: "foto.jpg", buffer: Buffer.from("fake-jpeg"), mimetype: "image/jpeg",
  });

  const body = JSON.parse(llamadas[0].options.body);
  assert.equal(body.mediatype, "image");
  assert.equal(body.mimetype, "image/jpeg");
});

test("una respuesta no exitosa de Evolution API se traduce en WHATSAPP_SEND_FAILED", async () => {
  process.env.EVOLUTION_API_URL = "http://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.EVOLUTION_INSTANCE = "icr";

  whatsapp._setFetchForTests(async () => ({ ok: false, status: 401, text: async () => "Unauthorized" }));

  await assert.rejects(
    whatsapp.enviarDocumentoPorWhatsapp({ to: "51987654321", caption: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "WHATSAPP_SEND_FAILED"
  );
});

// Test unitario (sin red real) del servicio de WhatsApp (Evolution API) —
// usa un fetch inyectado (_setFetchForTests), mismo criterio que mail.test.js.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ORIGINAL_ENV = { ...process.env };

function limpiarEnvEvolution() {
  delete process.env.EVOLUTION_API_URL;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_INSTANCE;
}

beforeEach(() => {
  limpiarEnvEvolution();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete require.cache[require.resolve("../src/services/whatsappService")];
});

test("un número inválido se rechaza sin intentar enviar", async () => {
  const whatsapp = require("../src/services/whatsappService");
  await assert.rejects(
    whatsapp.enviarDocumentoPorWhatsapp({ to: "no-es-un-numero", caption: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "WHATSAPP_INVALID"
  );
});

test("sin EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE configurados, se rechaza con WHATSAPP_NOT_CONFIGURED", async () => {
  const whatsapp = require("../src/services/whatsappService");
  assert.equal(whatsapp.isConfigured(), false);
  await assert.rejects(
    whatsapp.enviarDocumentoPorWhatsapp({ to: "51987654321", caption: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "WHATSAPP_NOT_CONFIGURED"
  );
});

test("con un fetch inyectado, envía el PDF como documento al número correcto (dígitos limpios)", async () => {
  process.env.EVOLUTION_API_URL = "http://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.EVOLUTION_INSTANCE = "icr";
  const whatsapp = require("../src/services/whatsappService");

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

  whatsapp._setFetchForTests(null);
});

test("una respuesta no exitosa de Evolution API se traduce en WHATSAPP_SEND_FAILED", async () => {
  process.env.EVOLUTION_API_URL = "http://evolution.example.com";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.EVOLUTION_INSTANCE = "icr";
  const whatsapp = require("../src/services/whatsappService");

  whatsapp._setFetchForTests(async () => ({ ok: false, status: 401, text: async () => "Unauthorized" }));

  await assert.rejects(
    whatsapp.enviarDocumentoPorWhatsapp({ to: "51987654321", caption: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "WHATSAPP_SEND_FAILED"
  );

  whatsapp._setFetchForTests(null);
});

// Test unitario (sin red real) del servicio de correo — usa un transporter
// inyectado (_setTransporterForTests) en vez de abrir una conexión SMTP real,
// mismo criterio que mockear la llamada a Gemini en aiChat.test.js.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const ORIGINAL_ENV = { ...process.env };

function limpiarEnvSmtp() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
}

beforeEach(() => {
  limpiarEnvSmtp();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete require.cache[require.resolve("../src/services/mailService")];
});

test("un correo con formato inválido se rechaza sin intentar enviar", async () => {
  const mail = require("../src/services/mailService");
  await assert.rejects(
    mail.enviarDocumentoPorCorreo({ to: "no-es-un-correo", subject: "x", text: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "EMAIL_INVALID"
  );
});

test("sin SMTP_HOST/SMTP_USER/SMTP_PASS configurados, se rechaza con EMAIL_NOT_CONFIGURED", async () => {
  const mail = require("../src/services/mailService");
  assert.equal(mail.isConfigured(), false);
  await assert.rejects(
    mail.enviarDocumentoPorCorreo({ to: "cliente@example.com", subject: "x", text: "x", filename: "x.pdf", buffer: Buffer.from("") }),
    (err) => err.code === "EMAIL_NOT_CONFIGURED"
  );
});

test("con un transporter inyectado, envía el PDF adjunto con el asunto y destinatario correctos", async () => {
  const mail = require("../src/services/mailService");
  const llamadas = [];
  mail._setTransporterForTests({
    sendMail: async (msg) => { llamadas.push(msg); return { messageId: "test-1" }; },
  });

  await mail.enviarDocumentoPorCorreo({
    to: "cliente@example.com", subject: "Cotización COT-00001", text: "Adjuntamos la cotización.",
    filename: "COT-00001.pdf", buffer: Buffer.from("%PDF-1.4 contenido de prueba"),
  });

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].to, "cliente@example.com");
  assert.equal(llamadas[0].subject, "Cotización COT-00001");
  assert.equal(llamadas[0].attachments[0].filename, "COT-00001.pdf");
  assert.ok(Buffer.isBuffer(llamadas[0].attachments[0].content));

  mail._setTransporterForTests(null);
});

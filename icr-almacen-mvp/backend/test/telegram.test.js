// Tests del webhook de Telegram: sin infraestructura real (no hay bot
// token ni red hacia Telegram en este entorno), así que se prueba la
// lógica de resolución de usuario + permisos, mockeando aiChatService.chat
// (mismo patrón de inyección que aiChat.test.js, pero acá mutando la
// referencia exportada, ya que telegramService no acepta `deps`).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const users = require("../src/services/userService");
const aiChat = require("../src/services/aiChatService");
const telegram = require("../src/services/telegramService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";

test("verifySecretToken exige TELEGRAM_WEBHOOK_SECRET configurado y coincidente", () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal(telegram.verifySecretToken("cualquier-cosa"), false);

  process.env.TELEGRAM_WEBHOOK_SECRET = "shh";
  assert.equal(telegram.verifySecretToken("shh"), true);
  assert.equal(telegram.verifySecretToken("otro"), false);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

test("resolveUserByTelegramId no encuentra nada si nadie está vinculado", async () => {
  const u = await telegram.resolveUserByTelegramId("999999999");
  assert.equal(u, null);
});

test("handleUpdate responde con instrucciones de vinculación si el telegram_id no está vinculado", async () => {
  const r = await telegram.handleUpdate({
    message: { text: "hola", chat: { id: 111 }, from: { id: 555555555 } },
  });
  assert.equal(r.handled, true);
  assert.match(r.respuesta, /no está vinculada/);
});

test("handleUpdate resuelve el usuario vinculado y llama al asistente de IA con su rol", async () => {
  await users.updateUser(SUPERVISOR, { telegram_id: "111222333" });

  const originalChat = aiChat.chat;
  let receivedArgs = null;
  aiChat.chat = async (args) => {
    receivedArgs = args;
    return { respuesta: "Tienes 2 alertas de stock bajo.", herramientas_usadas: ["get_stock_alerts"] };
  };
  try {
    const r = await telegram.handleUpdate({
      message: { text: "¿hay alertas de stock?", chat: { id: 222 }, from: { id: 111222333 } },
    });
    assert.equal(r.handled, true);
    assert.equal(r.respuesta, "Tienes 2 alertas de stock bajo.");
    assert.equal(receivedArgs.rolCodigo, "SUPERVISOR");
    assert.equal(receivedArgs.canal, "telegram");
    assert.equal(receivedArgs.mensaje, "¿hay alertas de stock?");
  } finally {
    aiChat.chat = originalChat;
  }
});

test("handleUpdate rechaza a un usuario vinculado pero desactivado", async () => {
  await users.updateUser(ALMACENERO, { telegram_id: "444555666", activo: false });
  const r = await telegram.handleUpdate({
    message: { text: "hola", chat: { id: 333 }, from: { id: 444555666 } },
  });
  assert.equal(r.handled, true);
  assert.match(r.respuesta, /desactivado/);
  await users.updateUser(ALMACENERO, { activo: true });
});

test("handleUpdate ignora updates sin mensaje de texto", async () => {
  const r = await telegram.handleUpdate({ message: { chat: { id: 1 }, from: { id: 2 } } });
  assert.equal(r.handled, false);
});

test("un telegram_id ya vinculado a otro usuario se rechaza al intentar vincularlo de nuevo", async () => {
  await assert.rejects(
    users.updateUser(ALMACENERO, { telegram_id: "111222333" }),
    (err) => err.code === "TELEGRAM_ID_TAKEN"
  );
});

after(async () => {
  await pool.end();
});

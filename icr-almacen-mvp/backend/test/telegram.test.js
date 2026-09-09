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

// -------- Comandos de escritura estructurados (/ingreso, /salida, /gasto) --------
// A diferencia de todo lo anterior (mensajes libres → LLM de solo consulta),
// un texto que empieza con "/" nunca toca aiChatService: se parsea con una
// gramática fija y llama 1:1 a la función de servicio ya auditada.
const inventory = require("../src/services/inventoryService");

async function stockOf(sku, warehouseCode) {
  const r = await inventory.getStock({ sku, warehouseCode, pageSize: 500 });
  return r.items.reduce((sum, row) => sum + Number(row.stock_fisico), 0);
}

test("/ingreso registra una entrada de stock real, sin pasar por el LLM", async () => {
  await users.updateUser(ALMACENERO, { telegram_id: "700000001" });
  const antes = await stockOf("PANEL-JA-550", "ALM-001");

  const r = await telegram.handleUpdate({
    message: { text: "/ingreso PANEL-JA-550 5 ALM-001", chat: { id: 700 }, from: { id: 700000001 } },
  });
  assert.match(r.respuesta, /Ingreso registrado/);
  const despues = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(despues, antes + 5);
});

test("/salida registra una salida de stock real", async () => {
  await users.updateUser(ALMACENERO, { telegram_id: "700000002" });
  const antes = await stockOf("PANEL-JA-550", "ALM-001");

  const r = await telegram.handleUpdate({
    message: { text: "/salida PANEL-JA-550 2 ALM-001", chat: { id: 701 }, from: { id: 700000002 } },
  });
  assert.match(r.respuesta, /Salida registrada/);
  const despues = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(despues, antes - 2);
});

test("/gasto registra un gasto real", async () => {
  await users.updateUser(SUPERVISOR, { telegram_id: "700000003" });
  const r = await telegram.handleUpdate({
    message: { text: "/gasto combustible 120.50 camioneta a obra Fundo Vilca", chat: { id: 702 }, from: { id: 700000003 } },
  });
  assert.match(r.respuesta, /Gasto registrado: COMBUSTIBLE por 120\.50/);
});

test("un comando con permiso insuficiente se rechaza sin ejecutar nada", async () => {
  await users.updateUser(SUPERVISOR, { telegram_id: "700000004" }); // CONSULTA no tiene inventory.receive; usamos un rol sin el permiso
  const consultaUser = await pool.query("SELECT usuario_id FROM usuarios WHERE rol_codigo='CONSULTA' LIMIT 1");
  await users.updateUser(consultaUser.rows[0].usuario_id, { telegram_id: "700000005" });

  const antes = await stockOf("PANEL-JA-550", "ALM-001");
  const r = await telegram.handleUpdate({
    message: { text: "/ingreso PANEL-JA-550 100 ALM-001", chat: { id: 703 }, from: { id: 700000005 } },
  });
  assert.match(r.respuesta, /No tienes permiso/);
  const despues = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(despues, antes, "el stock no debe cambiar si el permiso fue rechazado");
});

test("un comando desconocido responde con la lista de comandos disponibles", async () => {
  await users.updateUser(ALMACENERO, { telegram_id: "700000006" });
  const r = await telegram.handleUpdate({
    message: { text: "/loquesea", chat: { id: 704 }, from: { id: 700000006 } },
  });
  assert.match(r.respuesta, /no reconocido/);
});

test("/ingreso con argumentos incompletos devuelve un mensaje de uso, sin tocar el stock", async () => {
  await users.updateUser(ALMACENERO, { telegram_id: "700000007" });
  const antes = await stockOf("PANEL-JA-550", "ALM-001");
  const r = await telegram.handleUpdate({
    message: { text: "/ingreso PANEL-JA-550", chat: { id: 705 }, from: { id: 700000007 } },
  });
  assert.match(r.respuesta, /Uso: \/ingreso/);
  const despues = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(despues, antes);
});

test("/ayuda lista los comandos de escritura disponibles", async () => {
  await users.updateUser(ALMACENERO, { telegram_id: "700000008" });
  const r = await telegram.handleUpdate({
    message: { text: "/ayuda", chat: { id: 706 }, from: { id: 700000008 } },
  });
  assert.match(r.respuesta, /\/ingreso/);
  assert.match(r.respuesta, /\/salida/);
  assert.match(r.respuesta, /\/gasto/);
});

after(async () => {
  await pool.end();
});

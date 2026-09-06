// Tests del asistente de IA (Gemini): el registro de herramientas, el
// filtrado por rol/switch de módulos y el bucle de function-calling se
// prueban sin llamar a la API real de Gemini — callGeminiApi se inyecta
// como dependencia mockeada (deps.callGeminiApi), tal como espera chat().
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const aiChat = require("../src/services/aiChatService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const CONSULTA = "00000000-0000-0000-0000-000000000006";

test("toolsForRole excluye herramientas cuyo permiso no tiene el rol", () => {
  const consultaTools = aiChat.toolsForRole("CONSULTA").map((t) => t.name);
  assert.ok(consultaTools.includes("get_sales_receivables"));
  assert.ok(!consultaTools.includes("get_purchase_orders_pending"), "CONSULTA no tiene purchases.query");
});

test("toolsForRole no filtra nada extra para ADMIN (wildcard)", () => {
  const adminTools = aiChat.toolsForRole("ADMIN");
  assert.equal(adminTools.length, aiChat.TOOLS.length);
});

test("executeTool corre la consulta real cuando el rol tiene permiso", async () => {
  const r = await aiChat.executeTool("get_stock_alerts", {}, SUPERVISOR ? "SUPERVISOR" : "SUPERVISOR");
  assert.ok(Array.isArray(r) || Array.isArray(r?.items) || typeof r === "object");
});

test("executeTool rechaza una herramienta fuera del alcance del rol", async () => {
  await assert.rejects(
    aiChat.executeTool("get_purchase_orders_pending", {}, "CONSULTA"),
    (err) => err.code === "AI_TOOL_FORBIDDEN"
  );
});

test("chat() rechaza sin GEMINI_API_KEY configurada", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      aiChat.chat({ mensaje: "hola", usuarioId: SUPERVISOR, rolCodigo: "SUPERVISOR" }),
      (err) => err.code === "AI_NOT_CONFIGURED"
    );
  } finally {
    if (prev) process.env.GEMINI_API_KEY = prev;
  }
});

test("chat() rechaza un mensaje vacío", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  try {
    await assert.rejects(
      aiChat.chat({ mensaje: "", usuarioId: SUPERVISOR, rolCodigo: "SUPERVISOR" }),
      (err) => err.code === "SCHEMA_INVALID"
    );
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("chat() ejecuta una herramienta pedida por el modelo y devuelve la respuesta final", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let call = 0;
  const callGeminiApi = async () => {
    call += 1;
    if (call === 1) {
      return { candidates: [{ content: { parts: [{ functionCall: { name: "get_stock_alerts", args: {} } }] } }] };
    }
    return { candidates: [{ content: { parts: [{ text: "Tienes 2 productos con stock bajo." }] } }] };
  };
  try {
    const r = await aiChat.chat(
      { mensaje: "¿qué productos están bajos de stock?", usuarioId: SUPERVISOR, rolCodigo: "SUPERVISOR" },
      { callGeminiApi }
    );
    assert.equal(r.respuesta, "Tienes 2 productos con stock bajo.");
    assert.deepEqual(r.herramientas_usadas, ["get_stock_alerts"]);
    assert.equal(call, 2);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("chat() responde directo con texto si el modelo no pide ninguna herramienta", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const callGeminiApi = async () => ({ candidates: [{ content: { parts: [{ text: "Hola, ¿en qué te ayudo?" }] } }] });
  try {
    const r = await aiChat.chat({ mensaje: "hola", usuarioId: CONSULTA, rolCodigo: "CONSULTA" }, { callGeminiApi });
    assert.equal(r.respuesta, "Hola, ¿en qué te ayudo?");
    assert.deepEqual(r.herramientas_usadas, []);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("chat() corta con AI_TOO_MANY_TOOL_CALLS si el modelo insiste en pedir herramientas", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const callGeminiApi = async () => ({
    candidates: [{ content: { parts: [{ functionCall: { name: "get_stock_alerts", args: {} } }] } }],
  });
  try {
    await assert.rejects(
      aiChat.chat({ mensaje: "hola", usuarioId: SUPERVISOR, rolCodigo: "SUPERVISOR" }, { callGeminiApi }),
      (err) => err.code === "AI_TOO_MANY_TOOL_CALLS"
    );
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

after(async () => {
  await pool.end();
});

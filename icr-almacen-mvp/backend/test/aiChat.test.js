// Tests del asistente de IA (Gemini): el registro de herramientas, el
// filtrado por rol/switch de módulos y el bucle de function-calling se
// prueban sin llamar a la API real de Gemini — callGeminiApi se inyecta
// como dependencia mockeada (deps.callGeminiApi), tal como espera chat().
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";
// Delays cortos para que los tests de reintento por saturación (503) no
// esperen los ~1.6s reales que usa el servicio en producción.
process.env.GEMINI_RETRY_DELAYS_MS = "5,5";

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

function fakeGeminiHttpResponse({ ok, status, body }) {
  return { ok, status, json: async () => body };
}

test("callGeminiApi reintenta en el mismo modelo cuando Gemini responde 503 y luego funciona", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return fakeGeminiHttpResponse({ ok: false, status: 503, body: { error: { message: "The model is overloaded. Please try again later." } } });
    }
    return fakeGeminiHttpResponse({ ok: true, status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } });
  };
  try {
    const body = await aiChat.callGeminiApi({ apiKey: "test-key", contents: [], tools: undefined });
    assert.equal(body.candidates[0].content.parts[0].text, "ok");
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("gemini-3.8-flash"), "primer intento usa el modelo principal");
    assert.ok(calls[1].includes("gemini-3.8-flash"), "el reintento sigue en el modelo principal, no cae aún al de respaldo");
  } finally {
    global.fetch = originalFetch;
  }
});

test("callGeminiApi cae al modelo de respaldo si el principal sigue saturado tras los reintentos", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes("gemini-2.5-flash")) {
      return fakeGeminiHttpResponse({ ok: true, status: 200, body: { candidates: [{ content: { parts: [{ text: "respaldo ok" }] } }] } });
    }
    return fakeGeminiHttpResponse({ ok: false, status: 503, body: { error: { message: "The model is overloaded. Please try again later." } } });
  };
  try {
    const body = await aiChat.callGeminiApi({ apiKey: "test-key", contents: [], tools: undefined });
    assert.equal(body.candidates[0].content.parts[0].text, "respaldo ok");
    const mainAttempts = calls.filter((u) => u.includes("gemini-3.8-flash")).length;
    assert.equal(mainAttempts, 3, "agota los 3 intentos (1 + 2 reintentos) en el modelo principal antes de cambiar");
    assert.equal(calls.filter((u) => u.includes("gemini-2.5-flash")).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("callGeminiApi propaga el error final si ambos modelos siguen saturados", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    fakeGeminiHttpResponse({ ok: false, status: 503, body: { error: { message: "The model is overloaded. Please try again later." } } });
  try {
    await assert.rejects(
      aiChat.callGeminiApi({ apiKey: "test-key", contents: [], tools: undefined }),
      (err) => err.code === "AI_UPSTREAM_ERROR" && /overloaded/i.test(err.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("callGeminiApi no reintenta ante un error que no es de saturación (p. ej. API key inválida)", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    return fakeGeminiHttpResponse({ ok: false, status: 400, body: { error: { message: "API key not valid" } } });
  };
  try {
    await assert.rejects(
      aiChat.callGeminiApi({ apiKey: "bad-key", contents: [], tools: undefined }),
      (err) => err.code === "AI_UPSTREAM_ERROR" && err.message === "API key not valid"
    );
    assert.equal(calls.length, 1, "no reintenta ni cae a respaldo si el error no es de saturación");
  } finally {
    global.fetch = originalFetch;
  }
});

after(async () => {
  await pool.end();
});

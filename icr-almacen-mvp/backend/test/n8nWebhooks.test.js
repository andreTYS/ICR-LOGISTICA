// Webhooks salientes hacia N8N: CRUD + dispatchEvent. dispatchEvent nunca
// hace una petición de red real acá — se inyecta un fetchImpl mock (mismo
// patrón que aiChatService.chat) para verificar a quién se llamó, con qué
// firma y con qué cuerpo, sin depender de infraestructura externa.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const n8nWebhooks = require("../src/services/n8nWebhooksService");

const ADMIN = "00000000-0000-0000-0000-000000000001";

test("crearWebhook exige evento y url, y valida el esquema de la url", async () => {
  await assert.rejects(
    n8nWebhooks.crearWebhook({ evento: "", url: "https://x.example/hook", usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
  await assert.rejects(
    n8nWebhooks.crearWebhook({ evento: "rrhh.attendance.check_in", url: "ftp://x.example/hook", usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("crearWebhook + listWebhooks: crea el webhook y nunca expone el secret en claro", async () => {
  const r = await n8nWebhooks.crearWebhook({
    evento: "rrhh.attendance.check_in", url: "https://n8n.example/webhook/abc", secret: "shh-secreto",
    usuarioId: ADMIN, canal: "web",
  });
  assert.ok(r.webhook.webhook_id);

  const lista = await n8nWebhooks.listWebhooks();
  const creado = lista.find((w) => w.webhook_id === r.webhook.webhook_id);
  assert.ok(creado);
  assert.equal(creado.evento, "rrhh.attendance.check_in");
  assert.equal(creado.activo, true);
  assert.equal(creado.tiene_secret, true);
  assert.equal(creado.secret, undefined, "listWebhooks nunca debe devolver el secret en claro");
});

test("actualizarWebhook activa/desactiva, y rechaza un webhook_id inexistente", async () => {
  const r = await n8nWebhooks.crearWebhook({
    evento: "rrhh.attendance.check_out", url: "https://n8n.example/webhook/toggle", usuarioId: ADMIN, canal: "web",
  });
  await n8nWebhooks.actualizarWebhook({ webhookId: r.webhook.webhook_id, activo: false, usuarioId: ADMIN, canal: "web" });
  const lista = await n8nWebhooks.listWebhooks();
  const actualizado = lista.find((w) => w.webhook_id === r.webhook.webhook_id);
  assert.equal(actualizado.activo, false);

  await assert.rejects(
    n8nWebhooks.actualizarWebhook({ webhookId: "00000000-0000-0000-0000-000000000099", activo: true, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "WEBHOOK_NOT_FOUND"
  );
});

test("eliminarWebhook borra el webhook y rechaza borrar uno que no existe", async () => {
  const r = await n8nWebhooks.crearWebhook({
    evento: "expenses.register", url: "https://n8n.example/webhook/delete-me", usuarioId: ADMIN, canal: "web",
  });
  await n8nWebhooks.eliminarWebhook({ webhookId: r.webhook.webhook_id, usuarioId: ADMIN, canal: "web" });
  const lista = await n8nWebhooks.listWebhooks();
  assert.ok(!lista.find((w) => w.webhook_id === r.webhook.webhook_id));

  await assert.rejects(
    n8nWebhooks.eliminarWebhook({ webhookId: r.webhook.webhook_id, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "WEBHOOK_NOT_FOUND"
  );
});

test("dispatchEvent solo llama a los webhooks activos suscriptos al evento exacto o al comodín '*'", async () => {
  // Evento propio de este test (no reusa "rrhh.attendance.check_in", que ya
  // tiene un webhook activo de un test anterior) para no depender del orden
  // ni pisar otros tests con el estado que deja en la base.
  const evento = "n8ntest.dispatch.solo.suscriptos";
  await n8nWebhooks.crearWebhook({ evento, url: "https://n8n.example/hook-exacto", usuarioId: ADMIN, canal: "web" });
  const comodin = await n8nWebhooks.crearWebhook({ evento: "*", url: "https://n8n.example/hook-comodin", usuarioId: ADMIN, canal: "web" });
  const otro = await n8nWebhooks.crearWebhook({ evento: "otro.evento.no.suscripto", url: "https://n8n.example/hook-no-llamado", usuarioId: ADMIN, canal: "web" });
  const inactivo = await n8nWebhooks.crearWebhook({ evento, url: "https://n8n.example/hook-inactivo", usuarioId: ADMIN, canal: "web" });
  await n8nWebhooks.actualizarWebhook({ webhookId: inactivo.webhook.webhook_id, activo: false, usuarioId: ADMIN, canal: "web" });

  const llamadas = [];
  const fetchImpl = async (url, opts) => { llamadas.push({ url, opts }); return { ok: true }; };

  await n8nWebhooks.dispatchEvent(evento, { empleadoId: "e1" }, { fetchImpl });

  const urls = llamadas.map((c) => c.url).sort();
  assert.deepEqual(urls, ["https://n8n.example/hook-comodin", "https://n8n.example/hook-exacto"].sort());
  assert.ok(!urls.includes("https://n8n.example/hook-no-llamado"));
  assert.ok(!urls.includes("https://n8n.example/hook-inactivo"));
  assert.ok(otro.webhook.webhook_id);

  // Limpieza: un webhook '*' matchea cualquier evento futuro, así que hay
  // que sacarlo para no contaminar los tests que corren después.
  await n8nWebhooks.eliminarWebhook({ webhookId: comodin.webhook.webhook_id, usuarioId: ADMIN, canal: "web" });
});

test("dispatchEvent firma el cuerpo con HMAC-SHA256 cuando el webhook tiene secret", async () => {
  const secret = "un-secreto-de-prueba";
  await n8nWebhooks.crearWebhook({ evento: "gastos.firmado", url: "https://n8n.example/hook-firmado", secret, usuarioId: ADMIN, canal: "web" });

  let capturado = null;
  const fetchImpl = async (url, opts) => { capturado = opts; return { ok: true }; };
  await n8nWebhooks.dispatchEvent("gastos.firmado", { monto: 100 }, { fetchImpl });

  assert.ok(capturado.headers["X-ICR-Signature"]);
  const esperado = crypto.createHmac("sha256", secret).update(capturado.body).digest("hex");
  assert.equal(capturado.headers["X-ICR-Signature"], esperado);
});

test("dispatchEvent no lanza si el fetch falla o el webhook responde error", async () => {
  await n8nWebhooks.crearWebhook({ evento: "prueba.fallo", url: "https://n8n.example/hook-error-red", usuarioId: ADMIN, canal: "web" });
  await n8nWebhooks.crearWebhook({ evento: "prueba.fallo", url: "https://n8n.example/hook-error-http", usuarioId: ADMIN, canal: "web" });

  const fetchImpl = async (url) => {
    if (url.includes("error-red")) throw new Error("conexión rechazada");
    return { ok: false, status: 500 };
  };

  await assert.doesNotReject(n8nWebhooks.dispatchEvent("prueba.fallo", {}, { fetchImpl }));
});

test("dispatchEvent no lanza si falla la consulta a la base (mantiene el contrato best-effort)", async () => {
  const originalQuery = pool.query;
  pool.query = async () => { throw new Error("conexión a la base perdida"); };
  try {
    await assert.doesNotReject(n8nWebhooks.dispatchEvent("cualquier.evento", {}));
  } finally {
    pool.query = originalQuery;
  }
});

test("dispatchEvent no hace ninguna llamada si no hay webhooks suscriptos al evento", async () => {
  let llamado = false;
  const fetchImpl = async () => { llamado = true; return { ok: true }; };
  await n8nWebhooks.dispatchEvent("evento.sin.suscriptores.xyz", {}, { fetchImpl });
  assert.equal(llamado, false);
});

after(async () => {
  await pool.end();
});

// Módulo de administración del chatbot externo (web/tienda), conectado a
// futuro vía N8N: config, webhook entrante (autenticado, crea/agrega a una
// conversación), responder desde el panel (dispara dispatchEvent, mockeado
// acá — sin red real), cerrar, convertir a lead de CRM, listar/detalle.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const chatbot = require("../src/services/chatbotService");
const n8nWebhooks = require("../src/services/n8nWebhooksService");

const VENTAS_USER = "00000000-0000-0000-0000-000000000005";
const ADMIN = "00000000-0000-0000-0000-000000000001";

test("verifyWebhookSecret exige CHATBOT_WEBHOOK_SECRET configurado y coincidente", () => {
  delete process.env.CHATBOT_WEBHOOK_SECRET;
  assert.equal(chatbot.verifyWebhookSecret("cualquier-cosa"), false);

  process.env.CHATBOT_WEBHOOK_SECRET = "shh";
  assert.equal(chatbot.verifyWebhookSecret("shh"), true);
  assert.equal(chatbot.verifyWebhookSecret("otro"), false);
});

test("getChatbotConfig trae valores por defecto sin nada configurado", async () => {
  const cfg = await chatbot.getChatbotConfig();
  assert.equal(cfg.habilitado, true);
  assert.ok(cfg.mensajeBienvenida.length > 0);
});

test("setChatbotConfig actualiza habilitado y el mensaje de bienvenida", async () => {
  await chatbot.setChatbotConfig({ habilitado: false, mensajeBienvenida: "Hola, somos ICR", usuarioId: ADMIN, canal: "web" });
  const cfg = await chatbot.getChatbotConfig();
  assert.equal(cfg.habilitado, false);
  assert.equal(cfg.mensajeBienvenida, "Hola, somos ICR");

  await chatbot.setChatbotConfig({ habilitado: true, mensajeBienvenida: null, usuarioId: ADMIN, canal: "web" });
  const cfg2 = await chatbot.getChatbotConfig();
  assert.equal(cfg2.habilitado, true);
  assert.equal(cfg2.mensajeBienvenida, "Hola, somos ICR", "mensajeBienvenida null no debe pisar el valor ya guardado");
});

test("recibirMensaje sin conversacion_codigo crea una conversación nueva", async () => {
  const r = await chatbot.recibirMensaje({ canal: "web", nombreContacto: "Visitante Web", contacto: "visitante@example.com", texto: "Hola, quiero cotizar paneles" });
  assert.ok(r.conversacion.codigo.startsWith("CHAT-"));
  assert.equal(r.conversacion.estado, "ABIERTA");
  assert.equal(r.mensaje.remitente, "VISITANTE");
  assert.equal(r.mensaje.texto, "Hola, quiero cotizar paneles");
});

test("recibirMensaje con conversacion_codigo existente agrega el mensaje a esa conversación", async () => {
  const primero = await chatbot.recibirMensaje({ canal: "web", texto: "Primer mensaje" });
  const segundo = await chatbot.recibirMensaje({ conversacionCodigo: primero.conversacion.codigo, texto: "Segundo mensaje" });
  assert.equal(segundo.conversacion.conversacion_id, primero.conversacion.conversacion_id);

  const detalle = await chatbot.getConversacion(primero.conversacion.codigo);
  assert.equal(detalle.mensajes.length, 2);
  assert.equal(detalle.mensajes[1].texto, "Segundo mensaje");
});

test("recibirMensaje rechaza texto vacío y canal inválido", async () => {
  await assert.rejects(chatbot.recibirMensaje({ texto: "" }), (err) => err.code === "SCHEMA_INVALID");
  await assert.rejects(chatbot.recibirMensaje({ texto: "hola", canal: "fax" }), (err) => err.code === "SCHEMA_INVALID");
});

test("recibirMensaje rechaza un conversacion_codigo inexistente", async () => {
  await assert.rejects(
    chatbot.recibirMensaje({ conversacionCodigo: "CHAT-99999", texto: "hola" }),
    (err) => err.code === "CONVERSATION_NOT_FOUND"
  );
});

test("responderMensaje guarda el mensaje del agente, marca ATENDIDA y dispara el webhook de N8N", async () => {
  const { conversacion } = await chatbot.recibirMensaje({ canal: "web", texto: "¿Tienen paneles de 550W?" });

  await n8nWebhooks.crearWebhook({ evento: "chatbot.message.sent", url: "https://n8n.example/hook-chatbot", usuarioId: ADMIN, canal: "web" });
  const llamadas = [];
  const originalDispatch = n8nWebhooks.dispatchEvent;
  n8nWebhooks.dispatchEvent = async (evento, data) => { llamadas.push({ evento, data }); };
  try {
    const r = await chatbot.responderMensaje({ conversacionCodigo: conversacion.codigo, texto: "Sí, tenemos JA Solar 550W", usuarioId: VENTAS_USER, canal: "web" });
    assert.equal(r.conversacion.estado, "ATENDIDA");
    assert.equal(r.mensaje.remitente, "AGENTE");
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].evento, "chatbot.message.sent");
    assert.equal(llamadas[0].data.conversacionCodigo, conversacion.codigo);
  } finally {
    n8nWebhooks.dispatchEvent = originalDispatch;
  }
});

test("responderMensaje rechaza texto vacío y una conversación inexistente", async () => {
  const { conversacion } = await chatbot.recibirMensaje({ canal: "web", texto: "hola" });
  await assert.rejects(
    chatbot.responderMensaje({ conversacionCodigo: conversacion.codigo, texto: "", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
  await assert.rejects(
    chatbot.responderMensaje({ conversacionCodigo: "CHAT-99999", texto: "hola", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "CONVERSATION_NOT_FOUND"
  );
});

test("cerrarConversacion marca CERRADA, y un mensaje nuevo la reabre a ABIERTA", async () => {
  const { conversacion } = await chatbot.recibirMensaje({ canal: "web", texto: "hola" });
  const cerrada = await chatbot.cerrarConversacion({ conversacionCodigo: conversacion.codigo, usuarioId: VENTAS_USER, canal: "web" });
  assert.equal(cerrada.conversacion.estado, "CERRADA");

  const reabierta = await chatbot.recibirMensaje({ conversacionCodigo: conversacion.codigo, texto: "¿Siguen ahí?" });
  assert.equal(reabierta.conversacion.estado, "ABIERTA");
});

test("cerrarConversacion rechaza una conversación inexistente", async () => {
  await assert.rejects(
    chatbot.cerrarConversacion({ conversacionCodigo: "CHAT-99999", usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "CONVERSATION_NOT_FOUND"
  );
});

test("convertirALead crea un lead de CRM y lo vincula a la conversación", async () => {
  const { conversacion } = await chatbot.recibirMensaje({
    canal: "web", nombreContacto: "Lucía Fernández", contacto: "lucia@example.com", texto: "Quiero una cotización",
  });
  const r = await chatbot.convertirALead({ conversacionCodigo: conversacion.codigo, usuarioId: VENTAS_USER, canal: "web" });
  assert.ok(r.lead.codigo.startsWith("LEAD-"));
  assert.equal(r.lead.nombre_contacto, "Lucía Fernández");
  assert.equal(r.lead.email, "lucia@example.com");

  const detalle = await chatbot.getConversacion(conversacion.codigo);
  assert.equal(detalle.lead_codigo, r.lead.codigo);
});

test("convertirALead rechaza convertir la misma conversación dos veces", async () => {
  const { conversacion } = await chatbot.recibirMensaje({ canal: "web", texto: "hola de nuevo" });
  await chatbot.convertirALead({ conversacionCodigo: conversacion.codigo, usuarioId: VENTAS_USER, canal: "web" });
  await assert.rejects(
    chatbot.convertirALead({ conversacionCodigo: conversacion.codigo, usuarioId: VENTAS_USER, canal: "web" }),
    (err) => err.code === "ALREADY_CONVERTED"
  );
});

test("listConversaciones filtra por estado y getConversacion trae los mensajes en orden", async () => {
  const antes = await chatbot.listConversaciones({ estado: "ABIERTA" });
  const totalAbiertasAntes = antes.total;

  await chatbot.recibirMensaje({ canal: "whatsapp", contacto: "+51999111222", texto: "Mensaje de WhatsApp" });

  const despues = await chatbot.listConversaciones({ estado: "ABIERTA" });
  assert.equal(despues.total, totalAbiertasAntes + 1);
  assert.ok(despues.items.every((c) => c.estado === "ABIERTA"));
});

after(async () => {
  await pool.end();
});

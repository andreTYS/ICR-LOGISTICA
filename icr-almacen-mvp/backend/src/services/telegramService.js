const { pool } = require("../db");
const aiChat = require("./aiChatService");

// Webhook de Telegram: solo backend, sin infraestructura real en este
// entorno (no hay bot token ni URL pública para probarlo de punta a
// punta) — ver README "Integración N8N / Telegram" para los pasos de
// activación. El bot es un canal más hacia el mismo asistente de IA de
// solo consulta (aiChatService): el LLM interpreta el mensaje y decide
// qué herramienta de lectura llamar, nunca escribe directo sobre las
// tablas (mismo principio documentado para N8N). Cada usuario de
// Telegram se resuelve por `usuarios.telegram_id` (vinculado a mano por
// un ADMIN desde Administración → Usuarios) y el asistente respeta
// exactamente el mismo mapa de permisos por rol y el mismo switch de
// módulos que ya protegen el resto del panel — un usuario de Telegram
// nunca puede consultar (ni el bot puede ofrecerle) más de lo que vería
// en el panel web con su mismo rol.
function verifySecretToken(headerValue) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Sin TELEGRAM_WEBHOOK_SECRET configurado, el webhook se niega a
  // procesar nada — nunca "abierto por default" solo porque falte la
  // variable de entorno.
  return !!expected && headerValue === expected;
}

async function resolveUserByTelegramId(telegramId) {
  if (!telegramId) return null;
  const r = await pool.query(
    "SELECT usuario_id, nombre_completo, rol_codigo, activo FROM usuarios WHERE telegram_id = $1",
    [String(telegramId)]
  );
  return r.rows[0] || null;
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("No se pudo enviar el mensaje a Telegram: falta TELEGRAM_BOT_TOKEN");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      console.error("Telegram sendMessage falló:", body?.description || res.status);
    }
  } catch (err) {
    console.error("Telegram sendMessage falló:", err.message);
  }
}

// Procesa un update de Telegram (tal cual llega el body del webhook).
// Devuelve { handled, respuesta } para que la ruta pueda loguear/testear
// sin depender de que sendTelegramMessage haya llegado a la red real.
async function handleUpdate(update) {
  const message = update?.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;
  const telegramId = message?.from?.id;
  if (!message || !text || !chatId) {
    return { handled: false, respuesta: null };
  }

  const usuario = await resolveUserByTelegramId(telegramId);
  if (!usuario) {
    const respuesta = "Tu cuenta de Telegram todavía no está vinculada a Inversiones ICR. Pídele a un administrador que la vincule desde Administración → Usuarios.";
    await sendTelegramMessage(chatId, respuesta);
    return { handled: true, respuesta };
  }
  if (!usuario.activo) {
    const respuesta = "Tu usuario de Inversiones ICR está desactivado. Contacta a un administrador.";
    await sendTelegramMessage(chatId, respuesta);
    return { handled: true, respuesta };
  }

  let respuesta;
  try {
    const r = await aiChat.chat({
      mensaje: text, historial: [],
      usuarioId: usuario.usuario_id, rolCodigo: usuario.rol_codigo, canal: "telegram",
    });
    respuesta = r.respuesta;
  } catch (err) {
    respuesta = err.code === "AI_NOT_CONFIGURED"
      ? "El asistente de IA todavía no está configurado (falta GEMINI_API_KEY en el servidor)."
      : `No pude procesar tu consulta: ${err.message}`;
  }

  await sendTelegramMessage(chatId, respuesta);
  return { handled: true, respuesta };
}

module.exports = { verifySecretToken, resolveUserByTelegramId, sendTelegramMessage, handleUpdate };

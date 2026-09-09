const { pool } = require("../db");
const aiChat = require("./aiChatService");
const inventory = require("./inventoryService");
const gastos = require("./gastosService");
const { can } = require("../auth");
const { isModuleEnabledForRole } = require("./moduleAccessService");

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

// Comandos de escritura deterministas: a diferencia de cualquier otro
// mensaje (que va al LLM de solo consulta), un texto que empieza con "/" se
// parsea con una gramática fija y llama 1:1 a una función de servicio ya
// auditada — el LLM nunca decide ni interviene acá. Mismo mapa de permisos
// y switch de módulos que protege el resto del panel (requirePermission lo
// hace vía middleware Express; acá se replica a mano porque no hay request
// HTTP de por medio).
const CATEGORIAS_GASTO_TELEGRAM = ["COMBUSTIBLE", "VIATICOS", "ALQUILER", "SERVICIOS", "SOFTWARE", "MANTENIMIENTO", "HONORARIOS", "REEMBOLSO", "OTROS"];

function checkCommandPermission(usuario, action) {
  if (!can(usuario.rol_codigo, action)) {
    return `No tienes permiso para ejecutar este comando (requiere "${action}").`;
  }
  const modulo = action.split(".")[0];
  if (usuario.rol_codigo !== "ADMIN" && !isModuleEnabledForRole(modulo, usuario.rol_codigo)) {
    return `El módulo "${modulo}" está desactivado para tu rol.`;
  }
  return null;
}

const TELEGRAM_COMMANDS = {
  ingreso: {
    permission: "inventory.receive",
    usage: "/ingreso <sku> <cantidad> <almacen> [ubicacion]",
    run: async (args, usuario) => {
      if (args.length < 3) throw new Error(`Uso: /ingreso <sku> <cantidad> <almacen> [ubicacion]`);
      const [sku, cantidad, almacen, ubicacion] = args;
      await inventory.receive({
        sku, quantity: Number(cantidad), warehouseCode: almacen, locationCode: ubicacion || null,
        usuarioId: usuario.usuario_id, canal: "telegram",
      });
      return `✅ Ingreso registrado: ${cantidad} x ${sku} en ${almacen}.`;
    },
  },
  salida: {
    permission: "inventory.remove",
    usage: "/salida <sku> <cantidad> <almacen> [ubicacion]",
    run: async (args, usuario) => {
      if (args.length < 3) throw new Error(`Uso: /salida <sku> <cantidad> <almacen> [ubicacion]`);
      const [sku, cantidad, almacen, ubicacion] = args;
      await inventory.remove({
        sku, quantity: Number(cantidad), warehouseCode: almacen, locationCode: ubicacion || null,
        usuarioId: usuario.usuario_id, canal: "telegram",
      });
      return `✅ Salida registrada: ${cantidad} x ${sku} de ${almacen}.`;
    },
  },
  gasto: {
    permission: "expenses.register",
    usage: `/gasto <categoria> <monto> <descripcion...> — categorías: ${CATEGORIAS_GASTO_TELEGRAM.join(", ")}`,
    run: async (args, usuario) => {
      if (args.length < 3) throw new Error(`Uso: /gasto <categoria> <monto> <descripcion...>`);
      const [categoria, monto, ...descPartes] = args;
      await gastos.registrarGasto({
        categoria: categoria.toUpperCase(), monto: Number(monto), descripcion: descPartes.join(" "),
        usuarioId: usuario.usuario_id, canal: "telegram",
      });
      return `✅ Gasto registrado: ${categoria.toUpperCase()} por ${monto}.`;
    },
  },
};

async function handleCommand(text, usuario) {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.slice(1).toLowerCase();
  if (cmd === "ayuda" || cmd === "help") {
    return "Comandos disponibles:\n" + Object.entries(TELEGRAM_COMMANDS).map(([name, c]) => `/${name} — ${c.usage}`).join("\n");
  }
  const command = TELEGRAM_COMMANDS[cmd];
  if (!command) {
    return `Comando "/${cmd}" no reconocido. Escribe /ayuda para ver los comandos disponibles.`;
  }
  const permError = checkCommandPermission(usuario, command.permission);
  if (permError) return permError;
  try {
    return await command.run(args, usuario);
  } catch (err) {
    return `❌ No se pudo ejecutar el comando: ${err.message}`;
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
  if (text.startsWith("/")) {
    respuesta = await handleCommand(text, usuario);
  } else {
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
  }

  await sendTelegramMessage(chatId, respuesta);
  return { handled: true, respuesta };
}

module.exports = { verifySecretToken, resolveUserByTelegramId, sendTelegramMessage, handleUpdate, handleCommand, TELEGRAM_COMMANDS };

const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const n8nWebhooks = require("./n8nWebhooksService");
const crm = require("./crmService");

const CANALES_VALIDOS = ["web", "whatsapp", "instagram", "otro"];
const CHATBOT_HABILITADO_KEY = "CHATBOT_HABILITADO";
const CHATBOT_BIENVENIDA_KEY = "CHATBOT_MENSAJE_BIENVENIDA";
const BIENVENIDA_DEFAULT = "¡Hola! ¿En qué te podemos ayudar?";

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Mismo patrón que TELEGRAM_WEBHOOK_SECRET: sin la variable configurada, el
// webhook se niega a procesar nada — nunca "abierto por default".
function verifyWebhookSecret(headerValue) {
  const expected = process.env.CHATBOT_WEBHOOK_SECRET;
  return !!expected && headerValue === expected;
}

// El chatbot en sí (widget de la web, o el de la futura tienda) vive fuera
// de este repositorio. Acá solo se administra: habilitado/deshabilitado y
// el mensaje de bienvenida, guardados en `parametros` — mismo mecanismo que
// ya usaba el logo del panel.
async function getChatbotConfig() {
  const r = await pool.query(
    "SELECT clave, valor FROM parametros WHERE clave IN ($1,$2)",
    [CHATBOT_HABILITADO_KEY, CHATBOT_BIENVENIDA_KEY]
  );
  const map = Object.fromEntries(r.rows.map((row) => [row.clave, row.valor]));
  return {
    habilitado: map[CHATBOT_HABILITADO_KEY] !== "false",
    mensajeBienvenida: map[CHATBOT_BIENVENIDA_KEY] || BIENVENIDA_DEFAULT,
  };
}

async function setChatbotConfig({ habilitado, mensajeBienvenida, usuarioId, canal }) {
  return withAuditedTransaction("admin.chatbot.config", usuarioId, canal, async (client) => {
    if (habilitado != null) {
      await client.query(
        `INSERT INTO parametros (clave, valor, tipo_dato, descripcion)
         VALUES ($1,$2,'BOOLEAN','Chatbot externo habilitado')
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
        [CHATBOT_HABILITADO_KEY, String(!!habilitado)]
      );
    }
    if (mensajeBienvenida != null) {
      await client.query(
        `INSERT INTO parametros (clave, valor, tipo_dato, descripcion)
         VALUES ($1,$2,'STRING','Mensaje de bienvenida del chatbot')
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
        [CHATBOT_BIENVENIDA_KEY, mensajeBienvenida]
      );
    }
    return { entidad: "parametros", valorNuevo: { habilitado, mensajeBienvenida } };
  });
}

// Webhook entrante desde N8N (que a su vez recibe el mensaje del widget de
// chat real): sin `conversacionCodigo` crea una conversación nueva, con uno
// existente le agrega el mensaje. Autenticación vía CHATBOT_WEBHOOK_SECRET
// (mismo patrón que TELEGRAM_WEBHOOK_SECRET), nunca con el JWT del panel.
async function recibirMensaje({ conversacionCodigo, canal, nombreContacto, contacto, texto, remitente }) {
  if (!texto) throw new AppError("SCHEMA_INVALID", "texto es obligatorio", 400);
  if (canal && !CANALES_VALIDOS.includes(canal)) {
    throw new AppError("SCHEMA_INVALID", `canal debe ser uno de: ${CANALES_VALIDOS.join(", ")}`, 400);
  }
  const remitenteFinal = remitente && ["VISITANTE", "BOT"].includes(remitente) ? remitente : "VISITANTE";

  return withAuditedTransaction("chatbot.message.received", null, "n8n", async (client) => {
    let conversacion;
    if (conversacionCodigo) {
      const c = await client.query("SELECT * FROM chatbot_conversaciones WHERE codigo=$1", [conversacionCodigo]);
      if (c.rows.length === 0) throw new AppError("CONVERSATION_NOT_FOUND", `La conversación '${conversacionCodigo}' no existe`, 404);
      const upd = await client.query(
        "UPDATE chatbot_conversaciones SET estado = CASE WHEN estado = 'CERRADA' THEN 'ABIERTA' ELSE estado END, updated_at = now() WHERE conversacion_id = $1 RETURNING *",
        [c.rows[0].conversacion_id]
      );
      conversacion = upd.rows[0];
    } else {
      const numR = await client.query("SELECT 'CHAT-' || to_char(nextval('chatbot_conversacion_numero_seq'), 'FM00000') AS codigo");
      const codigo = numR.rows[0].codigo;
      const r = await client.query(
        `INSERT INTO chatbot_conversaciones (codigo, canal, nombre_contacto, contacto)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [codigo, canal || "web", nombreContacto || null, contacto || null]
      );
      conversacion = r.rows[0];
    }

    const m = await client.query(
      `INSERT INTO chatbot_mensajes (conversacion_id, remitente, texto) VALUES ($1,$2,$3) RETURNING *`,
      [conversacion.conversacion_id, remitenteFinal, texto]
    );

    return {
      entidad: "chatbot_conversaciones", entidadId: conversacion.conversacion_id,
      valorNuevo: { codigo: conversacion.codigo, remitente: remitenteFinal },
      conversacion, mensaje: m.rows[0],
    };
  });
}

// Un agente responde desde el panel: guarda el mensaje, marca la
// conversación ATENDIDA, y avisa (best-effort) a N8N para que la lleve de
// vuelta al chat real — mismo patrón que el asiento contable automático de
// Compras/Ventas: la respuesta ya quedó guardada, esto nunca debe romperla.
async function responderMensaje({ conversacionCodigo, texto, usuarioId, canal }) {
  if (!texto) throw new AppError("SCHEMA_INVALID", "texto es obligatorio", 400);
  const result = await withAuditedTransaction("chatbot.message.sent", usuarioId, canal, async (client) => {
    const c = await client.query("SELECT * FROM chatbot_conversaciones WHERE codigo=$1", [conversacionCodigo]);
    if (c.rows.length === 0) throw new AppError("CONVERSATION_NOT_FOUND", `La conversación '${conversacionCodigo}' no existe`, 404);
    const conversacion = c.rows[0];

    const m = await client.query(
      `INSERT INTO chatbot_mensajes (conversacion_id, remitente, texto) VALUES ($1,'AGENTE',$2) RETURNING *`,
      [conversacion.conversacion_id, texto]
    );
    const upd = await client.query(
      `UPDATE chatbot_conversaciones SET estado = 'ATENDIDA', updated_at = now() WHERE conversacion_id = $1 RETURNING *`,
      [conversacion.conversacion_id]
    );

    return {
      entidad: "chatbot_conversaciones", entidadId: conversacion.conversacion_id,
      valorNuevo: { codigo: conversacionCodigo, texto },
      conversacion: upd.rows[0], mensaje: m.rows[0],
    };
  });

  try {
    await n8nWebhooks.dispatchEvent("chatbot.message.sent", {
      conversacionCodigo, texto, canalConversacion: result.conversacion.canal,
    });
  } catch (err) {
    console.error(`No se pudo notificar el webhook N8N de la respuesta en '${conversacionCodigo}'`, err);
  }

  return result;
}

async function cerrarConversacion({ conversacionCodigo, usuarioId, canal }) {
  return withAuditedTransaction("chatbot.conversation.close", usuarioId, canal, async (client) => {
    const r = await client.query(
      `UPDATE chatbot_conversaciones SET estado='CERRADA', updated_at=now() WHERE codigo=$1 RETURNING *`,
      [conversacionCodigo]
    );
    if (r.rows.length === 0) throw new AppError("CONVERSATION_NOT_FOUND", `La conversación '${conversacionCodigo}' no existe`, 404);
    return { entidad: "chatbot_conversaciones", entidadId: r.rows[0].conversacion_id, valorNuevo: { estado: "CERRADA" }, conversacion: r.rows[0] };
  });
}

// Reusa crmService.crearLead — mismo patrón en cadena que Lead → Cotización
// → Contrato, para no duplicar la lógica de alta de un lead.
async function convertirALead({ conversacionCodigo, origen, usuarioId, canal }) {
  const c = await pool.query("SELECT * FROM chatbot_conversaciones WHERE codigo=$1", [conversacionCodigo]);
  if (c.rows.length === 0) throw new AppError("CONVERSATION_NOT_FOUND", `La conversación '${conversacionCodigo}' no existe`, 404);
  const conversacion = c.rows[0];
  if (conversacion.lead_id) throw new AppError("ALREADY_CONVERTED", "Esta conversación ya tiene un lead vinculado", 409);

  const { lead } = await crm.crearLead({
    nombreContacto: conversacion.nombre_contacto || `Visitante del chat (${conversacion.codigo})`,
    telefono: conversacion.canal === "whatsapp" ? conversacion.contacto : null,
    email: conversacion.canal !== "whatsapp" ? conversacion.contacto : null,
    origen: origen || "WEB",
    usuarioId, canal,
  });

  await pool.query("UPDATE chatbot_conversaciones SET lead_id=$1, updated_at=now() WHERE conversacion_id=$2", [lead.lead_id, conversacion.conversacion_id]);
  return { conversacion: { ...conversacion, lead_id: lead.lead_id }, lead };
}

async function listConversaciones({ estado, page, pageSize } = {}) {
  const { pageSize: size, offset } = paginationParams(page, pageSize, 20, 100);
  const params = [];
  let where = "";
  if (estado) { params.push(estado); where = `WHERE estado = $${params.length}`; }
  const totalR = await pool.query(`SELECT COUNT(*) FROM chatbot_conversaciones ${where}`, params);
  params.push(size, offset);
  const r = await pool.query(
    `SELECT c.*, l.codigo AS lead_codigo,
       (SELECT texto FROM chatbot_mensajes m WHERE m.conversacion_id = c.conversacion_id ORDER BY m.created_at DESC LIMIT 1) AS ultimo_mensaje,
       (SELECT COUNT(*) FROM chatbot_mensajes m WHERE m.conversacion_id = c.conversacion_id) AS total_mensajes
     FROM chatbot_conversaciones c
     LEFT JOIN leads l ON l.lead_id = c.lead_id
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { items: r.rows, total: Number(totalR.rows[0].count) };
}

async function getConversacion(codigo) {
  const c = await pool.query(
    `SELECT c.*, l.codigo AS lead_codigo FROM chatbot_conversaciones c LEFT JOIN leads l ON l.lead_id = c.lead_id WHERE c.codigo=$1`,
    [codigo]
  );
  if (c.rows.length === 0) throw new AppError("CONVERSATION_NOT_FOUND", `La conversación '${codigo}' no existe`, 404);
  const mensajes = await pool.query(
    "SELECT * FROM chatbot_mensajes WHERE conversacion_id=$1 ORDER BY created_at ASC",
    [c.rows[0].conversacion_id]
  );
  return { ...c.rows[0], mensajes: mensajes.rows };
}

module.exports = {
  verifyWebhookSecret,
  getChatbotConfig, setChatbotConfig,
  recibirMensaje, responderMensaje, cerrarConversacion, convertirALead,
  listConversaciones, getConversacion,
};

const { AppError } = require("../errors");

// Evolution API (instancia propia en el VPS, no la API oficial de Meta):
// expone un REST simple por instancia — POST {URL}/message/sendMedia/{instancia}
// con el apikey en un header. mediatype "document" adjunta el PDF tal cual
// se genera para "Exportar PDF"/"Enviar por correo", sin duplicar lógica.

// Inyectable solo para tests — evita una llamada de red real.
let fetchOverride = null;
function _setFetchForTests(fn) {
  fetchOverride = fn;
}

function isConfigured() {
  return !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);
}

// WhatsApp identifica números como código de país + número, solo dígitos
// (ej. 51987654321) — sin '+', espacios ni guiones.
const PHONE_RE = /^\d{8,15}$/;

async function enviarDocumentoPorWhatsapp({ to, caption, filename, buffer }) {
  const numero = String(to || "").replace(/[^\d]/g, "");
  if (!PHONE_RE.test(numero)) {
    throw new AppError(
      "WHATSAPP_INVALID",
      `'${to || ""}' no es un número de WhatsApp válido (código de país + número, solo dígitos, ej. 51987654321)`,
      400
    );
  }
  if (!isConfigured()) {
    throw new AppError(
      "WHATSAPP_NOT_CONFIGURED",
      "El envío por WhatsApp no está configurado en este servidor (faltan EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE)",
      400
    );
  }

  const doFetch = fetchOverride || fetch;
  const baseUrl = process.env.EVOLUTION_API_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/message/sendMedia/${process.env.EVOLUTION_INSTANCE}`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY },
    body: JSON.stringify({
      number: numero,
      mediatype: "document",
      mimetype: "application/pdf",
      media: buffer.toString("base64"),
      fileName: filename,
      caption: caption || "",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError("WHATSAPP_SEND_FAILED", `No se pudo enviar por WhatsApp (${res.status}): ${body.slice(0, 200)}`, 502);
  }
}

module.exports = { enviarDocumentoPorWhatsapp, isConfigured, _setFetchForTests };

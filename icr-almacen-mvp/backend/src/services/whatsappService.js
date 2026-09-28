const { AppError } = require("../errors");
const { getConfigValue } = require("./integracionesConfigService");

// Evolution API (instancia propia en el VPS, no la API oficial de Meta):
// expone un REST simple por instancia — POST {URL}/message/sendMedia/{instancia}
// con el apikey en un header. mediatype "document" adjunta el PDF tal cual
// se genera para "Exportar PDF"/"Enviar por correo", sin duplicar lógica.
//
// EVOLUTION_API_URL/KEY/INSTANCE se resuelven vía integracionesConfigService:
// primero lo guardado desde Administración → Integraciones, si no, la
// variable de entorno del servidor.

// Inyectable solo para tests — evita una llamada de red real.
let fetchOverride = null;
function _setFetchForTests(fn) {
  fetchOverride = fn;
}

async function getEvolutionConfig() {
  const [url, apiKey, instance] = await Promise.all([
    getConfigValue("EVOLUTION_API_URL"),
    getConfigValue("EVOLUTION_API_KEY"),
    getConfigValue("EVOLUTION_INSTANCE"),
  ]);
  return { url, apiKey, instance };
}

async function isConfigured() {
  const { url, apiKey, instance } = await getEvolutionConfig();
  return !!(url && apiKey && instance);
}

// WhatsApp identifica números como código de país + número, solo dígitos
// (ej. 51987654321) — sin '+', espacios ni guiones.
const PHONE_RE = /^\d{8,15}$/;

// mimetype es opcional (por defecto PDF, el único caso usado hasta ahora en
// Cotizaciones/Contratos) — Documentos adjuntos admite además JPEG/PNG/WebP,
// que Evolution API espera como mediatype "image" en vez de "document".
async function enviarDocumentoPorWhatsapp({ to, caption, filename, buffer, mimetype }) {
  const numero = String(to || "").replace(/[^\d]/g, "");
  if (!PHONE_RE.test(numero)) {
    throw new AppError(
      "WHATSAPP_INVALID",
      `'${to || ""}' no es un número de WhatsApp válido (código de país + número, solo dígitos, ej. 51987654321)`,
      400
    );
  }
  const { url: rawBaseUrl, apiKey, instance } = await getEvolutionConfig();
  if (!rawBaseUrl || !apiKey || !instance) {
    throw new AppError(
      "WHATSAPP_NOT_CONFIGURED",
      "El envío por WhatsApp no está configurado en este servidor (faltan EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE)",
      400
    );
  }

  const tipoArchivo = mimetype || "application/pdf";
  const mediatype = tipoArchivo.startsWith("image/") ? "image" : "document";
  const doFetch = fetchOverride || fetch;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/message/sendMedia/${instance}`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({
      number: numero,
      mediatype,
      mimetype: tipoArchivo,
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

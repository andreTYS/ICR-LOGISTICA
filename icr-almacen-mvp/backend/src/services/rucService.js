const { AppError } = require("../errors");

// Groundwork de consulta RUC/DNI: SUNAT no tiene una API pública gratuita
// para esto — la forma estándar en Perú es un proveedor de terceros que
// indexa RUC (SUNAT) y DNI (RENIEC), por ejemplo Factiliza o DecolectaAPI.
// Como con Drive/Gemini/Telegram, no hay credenciales reales en este entorno
// de desarrollo, así que esto no se puede probar de punta a punta acá — sí
// está construido y listo para activar con dos variables de entorno.
//
// El contrato exacto de URL/campos de respuesta varía entre proveedores
// (Factiliza separa /v1/ruc/{numero} y /v1/dni/{numero}; otros usan un solo
// endpoint con query params). Este service asume el patrón más común
// (`{RUC_API_URL}/{tipo}/{numero}` con Bearer token) y normaliza varios
// nombres de campo posibles para el nombre/razón social — al activar con un
// proveedor real, puede hacer falta ajustar getUrl()/el mapeo de campos para
// que calce con su documentación exacta.
function isConfigured() {
  return !!process.env.RUC_API_URL && !!process.env.RUC_API_TOKEN;
}

function detectarTipo(numero) {
  if (/^\d{8}$/.test(numero)) return "dni";
  if (/^\d{11}$/.test(numero)) return "ruc";
  return null;
}

function getUrl(tipo, numero) {
  return `${process.env.RUC_API_URL.replace(/\/$/, "")}/${tipo}/${numero}`;
}

function extraerNombre(body, tipo) {
  if (tipo === "ruc") {
    return body.razon_social || body.nombre_o_razon_social || body.nombre || null;
  }
  return (
    body.nombre_completo ||
    body.nombre ||
    [body.nombres, body.apellido_paterno, body.apellido_materno].filter(Boolean).join(" ") || null
  );
}

// numero: RUC (11 dígitos) o DNI (8 dígitos) — se detecta solo por longitud.
// deps.fetchImpl es el mismo punto de inyección que ya usa aiChatService.chat
// para poder testear sin red real.
async function consultar(numero, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const limpio = String(numero || "").trim();
  const tipo = detectarTipo(limpio);
  if (!tipo) {
    throw new AppError("SCHEMA_INVALID", "El número debe tener 8 dígitos (DNI) u 11 dígitos (RUC)", 400);
  }
  if (!isConfigured()) {
    throw new AppError("RUC_LOOKUP_NOT_CONFIGURED", "La consulta de RUC/DNI no está configurada en este servidor (faltan RUC_API_URL / RUC_API_TOKEN)", 400);
  }

  const res = await fetchImpl(getUrl(tipo, limpio), {
    headers: { Authorization: `Bearer ${process.env.RUC_API_TOKEN}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError("RUC_LOOKUP_FAILED", data.message || data.error || `No se pudo consultar el ${tipo.toUpperCase()} '${limpio}'`, 502);
  }

  const body = data.data || data;
  const nombre = extraerNombre(body, tipo);
  if (!nombre) {
    throw new AppError("RUC_LOOKUP_FAILED", `El proveedor de consulta no devolvió un nombre/razón social para '${limpio}'`, 502);
  }
  return { numero: limpio, tipo, nombre };
}

module.exports = { isConfigured, consultar };

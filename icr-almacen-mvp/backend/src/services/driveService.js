const jwt = require("jsonwebtoken");
const { AppError } = require("../errors");

// Groundwork de Google Drive: como con Gemini/Telegram, no hay credenciales
// reales en este entorno de desarrollo (no hay cuenta de servicio de Google
// Cloud configurada), así que esto no se puede probar de punta a punta acá
// — sí está construido y listo para activar en un servidor real con dos
// variables de entorno. Implementado con jsonwebtoken (ya es dependencia
// del proyecto) en vez de la librería oficial "googleapis" a propósito:
// evita sumar una dependencia pesada solo para dos llamadas HTTP simples
// (pedir un access token y hacer un upload multipart).
function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isConfigured() {
  return !!getServiceAccount() && !!process.env.GOOGLE_DRIVE_FOLDER_ID;
}

async function getAccessToken() {
  const sa = getServiceAccount();
  if (!sa) throw new AppError("DRIVE_NOT_CONFIGURED", "Google Drive no está configurado (falta GOOGLE_SERVICE_ACCOUNT_JSON)", 400);

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: "RS256" }
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError("DRIVE_AUTH_FAILED", data.error_description || "No se pudo autenticar contra Google Drive", 502);
  }
  return data.access_token;
}

// Upload multipart simple (metadata + contenido en un solo request) —
// suficiente para los tamaños que ya acepta uploads.js (hasta 10MB). El
// archivo queda dentro de la carpeta GOOGLE_DRIVE_FOLDER_ID; controlar quién
// puede verlo es responsabilidad de cómo se comparte esa carpeta en Drive
// (a propósito no se hace público ningún archivo desde acá).
async function uploadFile({ buffer, filename, mimeType }) {
  if (!isConfigured()) {
    throw new AppError("DRIVE_NOT_CONFIGURED", "Google Drive no está configurado en este servidor (faltan GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_FOLDER_ID)", 400);
  }
  const accessToken = await getAccessToken();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const boundary = `icr-drive-${Date.now()}`;
  const metadata = { name: filename, parents: [folderId] };

  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, buffer, tail]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError("DRIVE_UPLOAD_FAILED", data.error?.message || "No se pudo subir el archivo a Google Drive", 502);
  }
  return { fileId: data.id, webViewLink: data.webViewLink };
}

module.exports = { isConfigured, uploadFile };

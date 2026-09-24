const nodemailer = require("nodemailer");
const { AppError } = require("../errors");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Inyectable solo para tests — evita abrir una conexión SMTP real.
let transporterOverride = null;
function _setTransporterForTests(transporter) {
  transporterOverride = transporter;
}

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildTransporter() {
  const port = Number(process.env.SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = SSL implícito; 587/otros = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Envía un documento (Cotización/Contrato en PDF) por correo al cliente.
// A diferencia del asiento contable automático (best-effort, nunca rompe la
// operación de origen), esto es una acción explícita del usuario ("enviar
// por correo"), así que un fallo debe verse como tal, no quedar en silencio.
async function enviarDocumentoPorCorreo({ to, subject, text, filename, buffer }) {
  if (!to || !EMAIL_RE.test(to)) {
    throw new AppError("EMAIL_INVALID", `'${to || ""}' no es un correo válido`, 400);
  }
  if (!transporterOverride && !isConfigured()) {
    throw new AppError(
      "EMAIL_NOT_CONFIGURED",
      "El envío de correo no está configurado en este servidor (faltan SMTP_HOST/SMTP_USER/SMTP_PASS)",
      400
    );
  }
  const transporter = transporterOverride || buildTransporter();
  await transporter.sendMail({
    from: `"Inversiones ICR" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    attachments: [{ filename, content: buffer }],
  });
}

module.exports = { enviarDocumentoPorCorreo, isConfigured, _setTransporterForTests };

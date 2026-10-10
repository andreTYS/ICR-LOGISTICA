// Helpers compartidos por todos los módulos de routes/*.js — nada de lógica
// de negocio acá, solo el envoltorio común de request/response. Separado de
// routes.js (que antes tenía 1885 líneas con todo junto) para que cada
// módulo de dominio (inventory.js, crm.js, ...) sea independiente y se
// pueda leer sin cargar con la cabeza el resto de la API.
const rateLimit = require("express-rate-limit");
const { AppError, translatePgError } = require("../errors");

// Máximo 10 intentos de login por IP cada 15 minutos, para frenar fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", data: null, error: { code: "RATE_LIMITED", message: "Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos." } },
});

// Envuelve cada handler para capturar errores AppError y devolver el envelope estándar de respuesta
function handle(fn) {
  return async (req, res) => {
    const requestId = req.body?.request_id || req.query?.request_id || null;
    try {
      const data = await fn(req);
      res.json({ request_id: requestId, status: "success", data, error: null });
    } catch (err) {
      const translated = err instanceof AppError ? err : translatePgError(err);
      if (translated) {
        res.status(translated.status).json({
          request_id: requestId,
          status: "error",
          data: null,
          error: { code: translated.code, message: translated.message, details: translated.details },
        });
      } else {
        console.error(err);
        res.status(500).json({
          request_id: requestId,
          status: "error",
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
        });
      }
    }
  };
}

// Como handle(), pero para respuestas binarias (XLSX/PDF) en vez del sobre
// {status,data,error} en JSON — el error sigue yendo en ese mismo formato.
function handleBinary(fn) {
  return async (req, res) => {
    try {
      const { buffer, filename, contentType } = await fn(req);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ status: "error", data: null, error: { code: err.code, message: err.message, details: err.details } });
      } else {
        console.error(err);
        res.status(500).json({ status: "error", data: null, error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
      }
    }
  };
}

module.exports = { handle, handleBinary, loginLimiter };

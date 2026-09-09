const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { pool } = require("./db");
const { AppError } = require("./errors");
const { isModuleEnabledForRole } = require("./services/moduleAccessService");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatorio en producción (NODE_ENV=production). Define la variable de entorno antes de arrancar.");
}
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar-en-produccion";
const JWT_EXPIRES_IN = "12h";

// Tokens de servicio (N8N y similares): un prefijo fijo los distingue de un
// JWT de sesión sin decodificar nada — jwt.verify jamás ve uno de estos.
// Solo se guarda el hash en BD; adminService.crearApiToken es quien genera
// el valor en claro y lo muestra una única vez.
const API_TOKEN_PREFIX = "icr_";
function hashApiToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Mapa de permisos por rol → comandos permitidos (documento técnico §2.4)
const ROLE_PERMISSIONS = {
  ADMIN: ["*"],
  SUPERVISOR: [
    "inventory.receive", "inventory.remove", "inventory.transfer",
    "inventory.stock.get", "inventory.stock.search", "inventory.query",
    "inventory.adjust", "inventory.adjust.approve", "inventory.alerts.get", "inventory.audit.get",
    "inventory.product.create", "inventory.product.update", "inventory.warehouse.manage",
    "purchases.query", "purchases.replenishment.get",
    "projects.create", "projects.update_status", "projects.labor.register", "projects.query",
    "accounting.account.manage", "accounting.fiscal_param.manage", "accounting.rule.manage",
    "accounting.entry.create", "accounting.entry.post", "accounting.entry.void", "accounting.query",
    "rrhh.employee.manage", "rrhh.attendance.mark", "rrhh.query",
    "sales.contract.manage", "sales.query",
    "expenses.register", "expenses.query",
    "payables.manage", "payables.query",
    "quotes.manage", "quotes.query",
    "assets.manage", "assets.query",
    "ai.chat",
    "crm.manage", "crm.query",
    "documents.manage", "documents.query",
    "calendar.query",
  ],
  ALMACENERO: [
    "inventory.receive", "inventory.remove", "inventory.transfer",
    "inventory.stock.get", "inventory.stock.search", "inventory.query",
    "purchases.receive", "purchases.query",
    "projects.labor.register", "projects.query",
    "accounting.query",
    "rrhh.attendance.mark", "rrhh.query",
    "sales.query",
    "expenses.register", "expenses.query",
    "payables.query",
    "quotes.query",
    "assets.manage", "assets.query",
    "ai.chat",
    "crm.query",
    "documents.manage", "documents.query",
    "calendar.query",
  ],
  COMPRAS: [
    "inventory.stock.get", "inventory.stock.search", "inventory.alerts.get",
    "inventory.product.create", "inventory.product.update", "inventory.query",
    "purchases.create", "purchases.send", "purchases.cancel", "purchases.receive",
    "purchases.query", "purchases.replenishment.get",
    "projects.query", "accounting.query",
    "rrhh.attendance.mark", "rrhh.query",
    "sales.query",
    "expenses.register", "expenses.query",
    "payables.manage", "payables.query",
    "quotes.query",
    "assets.query",
    "ai.chat",
    "crm.query",
    "documents.query",
    "calendar.query",
  ],
  VENTAS: [
    "inventory.reserve", "inventory.release_reservation",
    "inventory.stock.get", "inventory.stock.search", "inventory.query",
    "projects.query", "accounting.query",
    "rrhh.attendance.mark", "rrhh.query",
    "sales.contract.manage", "sales.query",
    "expenses.register", "expenses.query",
    "payables.query",
    "quotes.manage", "quotes.query",
    "assets.query",
    "ai.chat",
    "crm.manage", "crm.query",
    "documents.manage", "documents.query",
    "calendar.query",
  ],
  CONSULTA: [
    "inventory.stock.get", "inventory.stock.search", "inventory.query", "projects.query", "accounting.query", "rrhh.query", "sales.query", "expenses.query",
    "payables.query", "quotes.query", "assets.query",
    "ai.chat",
    "crm.query",
    "documents.query",
    "calendar.query",
  ],
};

function can(rolCodigo, action) {
  const perms = ROLE_PERMISSIONS[rolCodigo] || [];
  return perms.includes("*") || perms.includes(action);
}

async function login(email, password) {
  if (!email || !password) {
    throw new AppError("SCHEMA_INVALID", "email y password son obligatorios", 400);
  }
  const r = await pool.query(
    "SELECT * FROM usuarios WHERE email = $1 AND activo = true",
    [email]
  );
  if (r.rows.length === 0) {
    throw new AppError("AUTH_INVALID", "Usuario o contraseña incorrectos", 401);
  }
  const user = r.rows[0];
  if (!user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    throw new AppError("AUTH_INVALID", "Usuario o contraseña incorrectos", 401);
  }
  const token = jwt.sign(
    { usuario_id: user.usuario_id, rol_codigo: user.rol_codigo, nombre: user.nombre_completo },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return {
    token,
    user: {
      usuario_id: user.usuario_id,
      nombre_completo: user.nombre_completo,
      email: user.email,
      rol_codigo: user.rol_codigo,
      nivel_autorizacion: user.nivel_autorizacion,
    },
  };
}

// Un token de servicio "actúa como" un usuario existente y hereda sus
// permisos tal cual — no hay un rol especial "N8N". Actualiza ultimo_uso
// best-effort (no bloquea ni falla la request si esa escritura falla).
async function verifyApiToken(token) {
  const hash = hashApiToken(token);
  const r = await pool.query(
    `SELECT t.api_token_id, t.revocado, t.expira_en, u.usuario_id, u.rol_codigo, u.nombre_completo, u.activo
     FROM api_tokens t JOIN usuarios u ON u.usuario_id = t.usuario_id
     WHERE t.token_hash = $1`,
    [hash]
  );
  if (r.rows.length === 0) throw new AppError("AUTH_INVALID", "Token de servicio inválido", 401);
  const row = r.rows[0];
  if (row.revocado) throw new AppError("AUTH_INVALID", "Token de servicio revocado", 401);
  if (row.expira_en && new Date(row.expira_en) < new Date()) throw new AppError("AUTH_INVALID", "Token de servicio expirado", 401);
  if (!row.activo) throw new AppError("AUTH_INVALID", "El usuario asociado a este token está desactivado", 401);
  pool.query("UPDATE api_tokens SET ultimo_uso = now() WHERE api_token_id = $1", [row.api_token_id]).catch(() => {});
  return { usuario_id: row.usuario_id, rol_codigo: row.rol_codigo, nombre: row.nombre_completo, api_token_id: row.api_token_id };
}

// Middleware: exige un JWT de sesión o un token de servicio (prefijo "icr_")
// en Authorization: Bearer <token>.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ status: "error", data: null, error: { code: "AUTH_INVALID", message: "Falta el token de autenticación" } });
  }
  if (token.startsWith(API_TOKEN_PREFIX)) {
    try {
      req.user = await verifyApiToken(token);
      return next();
    } catch (err) {
      return res.status(err.status || 401).json({ status: "error", data: null, error: { code: err.code || "AUTH_INVALID", message: err.message } });
    }
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", data: null, error: { code: "AUTH_INVALID", message: "Token inválido o expirado" } });
  }
}

// Middleware factory: exige que el rol del usuario autenticado permita esta
// acción Y que el módulo al que pertenece (prefijo antes del primer punto,
// ej. "purchases" en "purchases.create") esté habilitado para su rol — el
// switch de módulos del admin actúa acá, encima del mapa de permisos fijo.
// ADMIN nunca pasa por el switch: siempre ve todo.
function requirePermission(action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ status: "error", data: null, error: { code: "AUTH_INVALID", message: "No autenticado" } });
    }
    if (!can(req.user.rol_codigo, action)) {
      return res.status(403).json({
        status: "error", data: null,
        error: { code: "AUTH_FORBIDDEN", message: `El rol ${req.user.rol_codigo} no tiene permiso para ${action}` },
      });
    }
    const modulo = action.split(".")[0];
    if (req.user.rol_codigo !== "ADMIN" && !isModuleEnabledForRole(modulo, req.user.rol_codigo)) {
      return res.status(403).json({
        status: "error", data: null,
        error: { code: "MODULE_DISABLED", message: `El módulo '${modulo}' está desactivado para tu rol` },
      });
    }
    next();
  };
}

module.exports = { login, requireAuth, requirePermission, can, ROLE_PERMISSIONS, hashApiToken, API_TOKEN_PREFIX, verifyApiToken };

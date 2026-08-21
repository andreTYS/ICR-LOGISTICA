const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");
const { AppError } = require("./errors");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatorio en producción (NODE_ENV=production). Define la variable de entorno antes de arrancar.");
}
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar-en-produccion";
const JWT_EXPIRES_IN = "12h";

// Mapa de permisos por rol → comandos permitidos (documento técnico §2.4)
const ROLE_PERMISSIONS = {
  ADMIN: ["*"],
  SUPERVISOR: [
    "inventory.receive", "inventory.remove", "inventory.transfer",
    "inventory.stock.get", "inventory.stock.search", "inventory.query",
    "inventory.adjust", "inventory.adjust.approve", "inventory.alerts.get", "inventory.audit.get",
    "inventory.product.create", "inventory.product.update",
  ],
  ALMACENERO: [
    "inventory.receive", "inventory.remove", "inventory.transfer",
    "inventory.stock.get", "inventory.stock.search", "inventory.query",
  ],
  COMPRAS: [
    "inventory.stock.get", "inventory.stock.search", "inventory.alerts.get",
    "inventory.product.create", "inventory.product.update", "inventory.query",
  ],
  VENTAS: [
    "inventory.reserve", "inventory.release_reservation",
    "inventory.stock.get", "inventory.stock.search", "inventory.query",
  ],
  CONSULTA: ["inventory.stock.get", "inventory.stock.search", "inventory.query"],
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

// Middleware: exige un JWT válido en Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ status: "error", data: null, error: { code: "AUTH_INVALID", message: "Falta el token de autenticación" } });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", data: null, error: { code: "AUTH_INVALID", message: "Token inválido o expirado" } });
  }
}

// Middleware factory: exige que el rol del usuario autenticado permita esta acción
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
    next();
  };
}

module.exports = { login, requireAuth, requirePermission, can };

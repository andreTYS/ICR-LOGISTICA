const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { AppError } = require("../errors");

const ROLES = ["ADMIN", "SUPERVISOR", "ALMACENERO", "COMPRAS", "VENTAS", "CONSULTA"];

async function listUsers() {
  const r = await pool.query(
    `SELECT usuario_id, nombre_completo, email, rol_codigo, nivel_autorizacion, activo, created_at
     FROM usuarios ORDER BY nombre_completo`
  );
  return r.rows;
}

async function createUser({ nombre_completo, email, password, rol_codigo, nivel_autorizacion }) {
  if (!nombre_completo || !email || !password || !rol_codigo) {
    throw new AppError("SCHEMA_INVALID", "nombre_completo, email, password y rol_codigo son obligatorios", 400);
  }
  if (!ROLES.includes(rol_codigo)) {
    throw new AppError("SCHEMA_INVALID", `rol_codigo debe ser uno de: ${ROLES.join(", ")}`, 400);
  }
  if (password.length < 8) {
    throw new AppError("SCHEMA_INVALID", "La contraseña debe tener al menos 8 caracteres", 400);
  }
  const existing = await pool.query("SELECT usuario_id FROM usuarios WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    throw new AppError("USER_EXISTS", `Ya existe un usuario con el email '${email}'`, 409);
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const r = await pool.query(
    `INSERT INTO usuarios (nombre_completo, email, password_hash, rol_codigo, nivel_autorizacion)
     VALUES ($1,$2,$3,$4,COALESCE($5,1))
     RETURNING usuario_id, nombre_completo, email, rol_codigo, nivel_autorizacion, activo, created_at`,
    [nombre_completo, email, passwordHash, rol_codigo, nivel_autorizacion || null]
  );
  return r.rows[0];
}

async function updateUser(usuarioId, { rol_codigo, nivel_autorizacion, activo, password }) {
  const existing = await pool.query("SELECT * FROM usuarios WHERE usuario_id = $1", [usuarioId]);
  if (existing.rows.length === 0) {
    throw new AppError("USER_NOT_FOUND", `Usuario '${usuarioId}' no existe`, 404);
  }
  if (rol_codigo && !ROLES.includes(rol_codigo)) {
    throw new AppError("SCHEMA_INVALID", `rol_codigo debe ser uno de: ${ROLES.join(", ")}`, 400);
  }
  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;
  const r = await pool.query(
    `UPDATE usuarios SET
       rol_codigo = COALESCE($1, rol_codigo),
       nivel_autorizacion = COALESCE($2, nivel_autorizacion),
       activo = COALESCE($3, activo),
       password_hash = COALESCE($4, password_hash)
     WHERE usuario_id = $5
     RETURNING usuario_id, nombre_completo, email, rol_codigo, nivel_autorizacion, activo, created_at`,
    [rol_codigo || null, nivel_autorizacion ?? null, activo ?? null, passwordHash, usuarioId]
  );
  return r.rows[0];
}

module.exports = { listUsers, createUser, updateUser, ROLES };

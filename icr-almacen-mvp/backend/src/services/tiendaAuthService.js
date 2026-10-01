const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { AppError } = require("../errors");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cambiar-en-produccion";
// Sesión larga a propósito: es una cuenta de tienda online (como cualquier
// e-commerce), no una sesión de trabajo de un empleado del ERP (12h).
const TIENDA_TOKEN_EXPIRES_IN = "30d";

function limpiar(v) {
  return v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim();
}

function emitirSesion(row) {
  const token = jwt.sign(
    { tipo: "tienda", cliente_tienda_id: row.cliente_tienda_id, nombre: row.nombre, correo: row.correo },
    JWT_SECRET,
    { expiresIn: TIENDA_TOKEN_EXPIRES_IN }
  );
  return {
    token,
    user: {
      nombre: row.nombre,
      correo: row.correo,
      telefono: row.telefono,
      empresa: row.empresa,
      ruc: row.ruc,
      dni: row.dni,
    },
  };
}

async function registrarCliente({ nombre, correo, password, telefono, empresa, ruc, dni }) {
  if (!nombre || !correo || !password) {
    throw new AppError("SCHEMA_INVALID", "nombre, correo y password son obligatorios", 400);
  }
  if (String(password).length < 6) {
    throw new AppError("SCHEMA_INVALID", "La contraseña debe tener al menos 6 caracteres", 400);
  }
  const correoLimpio = String(correo).trim().toLowerCase();
  const hash = bcrypt.hashSync(String(password), 10);
  const r = await pool.query(
    `INSERT INTO clientes_tienda (nombre, correo, password_hash, telefono, empresa, ruc, dni)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [String(nombre).trim(), correoLimpio, hash, limpiar(telefono), limpiar(empresa), limpiar(ruc), limpiar(dni)]
  );
  return emitirSesion(r.rows[0]);
}

async function loginCliente({ correo, password }) {
  if (!correo || !password) {
    throw new AppError("SCHEMA_INVALID", "correo y password son obligatorios", 400);
  }
  const r = await pool.query("SELECT * FROM clientes_tienda WHERE correo = $1", [String(correo).trim().toLowerCase()]);
  if (r.rows.length === 0 || !bcrypt.compareSync(String(password), r.rows[0].password_hash)) {
    throw new AppError("AUTH_INVALID", "Correo o contraseña incorrectos", 401);
  }
  return emitirSesion(r.rows[0]);
}

async function actualizarPerfil(clienteTiendaId, { nombre, telefono, empresa, ruc, dni }) {
  if (!nombre) throw new AppError("SCHEMA_INVALID", "nombre es obligatorio", 400);
  const r = await pool.query(
    `UPDATE clientes_tienda SET nombre=$1, telefono=$2, empresa=$3, ruc=$4, dni=$5
     WHERE cliente_tienda_id=$6 RETURNING *`,
    [String(nombre).trim(), limpiar(telefono), limpiar(empresa), limpiar(ruc), limpiar(dni), clienteTiendaId]
  );
  if (r.rows.length === 0) throw new AppError("NOT_FOUND", "Cuenta de tienda no encontrada", 404);
  return emitirSesion(r.rows[0]);
}

// Historial de pedidos = Cotizaciones + Contratos del cliente FORMAL del ERP
// (tabla `clientes`, identificado por RUC/DNI) que coincide con el RUC/DNI
// con el que este usuario de tienda se registró — ver comentario sobre
// clientes_tienda en schema.sql. Sin ese cruce (recién registrado, o un
// RUC/DNI que ningún vendedor cargó todavía como cliente formal) el
// historial queda vacío: no es un error, es el estado normal de una cuenta
// nueva.
async function obtenerPedidos(clienteTiendaId) {
  const ctR = await pool.query("SELECT ruc, dni FROM clientes_tienda WHERE cliente_tienda_id = $1", [clienteTiendaId]);
  if (ctR.rows.length === 0) throw new AppError("NOT_FOUND", "Cuenta de tienda no encontrada", 404);
  const { ruc, dni } = ctR.rows[0];
  if (!ruc && !dni) return { pedidos: [] };

  const clienteR = await pool.query(
    `SELECT cliente_id, razon_social FROM clientes
     WHERE (ruc IS NOT NULL AND ruc = $1) OR (dni IS NOT NULL AND dni = $2)`,
    [ruc, dni]
  );
  if (clienteR.rows.length === 0) return { pedidos: [] };
  const { cliente_id: clienteId, razon_social: razonSocial } = clienteR.rows[0];

  const [cotizacionesR, contratosR] = await Promise.all([
    pool.query(
      `SELECT c.codigo, 'COTIZACION' AS tipo, c.estado, c.fecha_emision AS fecha,
              COALESCE((SELECT SUM(ci.cantidad * ci.precio_unitario) FROM cotizacion_items ci WHERE ci.cotizacion_id = c.cotizacion_id), 0) AS monto
       FROM cotizaciones c WHERE c.cliente_id = $1`,
      [clienteId]
    ),
    pool.query(
      `SELECT codigo_contrato AS codigo, 'CONTRATO' AS tipo, estado, fecha_firma AS fecha, monto_total AS monto
       FROM contratos WHERE cliente_id = $1`,
      [clienteId]
    ),
  ]);

  const pedidos = [...cotizacionesR.rows, ...contratosR.rows].sort(
    (a, b) => new Date(b.fecha) - new Date(a.fecha)
  );
  return { pedidos, razonSocial };
}

module.exports = { registrarCliente, loginCliente, actualizarPerfil, obtenerPedidos };

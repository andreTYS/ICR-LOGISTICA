const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");

// Catálogo de módulos que el admin puede activar/desactivar por rol. El
// código de cada uno coincide con el prefijo de las acciones de permiso
// (ej. "purchases.create" → módulo "purchases"), así requirePermission()
// puede derivar el módulo sin un mapeo aparte.
const MODULES = [
  { code: "inventory", label: "Almacén" },
  { code: "purchases", label: "Compras" },
  { code: "projects", label: "Proyectos" },
  { code: "sales", label: "Ventas" },
  { code: "expenses", label: "Gastos" },
  { code: "accounting", label: "Contabilidad" },
  { code: "rrhh", label: "RR.HH." },
  { code: "payables", label: "Cuentas por pagar" },
  { code: "quotes", label: "Cotizaciones" },
  { code: "assets", label: "Activos y Mantenimiento" },
  { code: "ai", label: "Asistente IA" },
  { code: "crm", label: "CRM / Pipeline comercial" },
  { code: "documents", label: "Gestión documental" },
  { code: "calendar", label: "Calendario" },
];
const MODULE_CODES = MODULES.map((m) => m.code);
const TOGGLEABLE_ROLES = ["SUPERVISOR", "ALMACENERO", "COMPRAS", "VENTAS", "CONSULTA"];

// Cache en memoria: { [modulo]: { [rol_codigo]: boolean } }. Un solo proceso
// Node para todo el backend (misma asunción que el resto del MVP), así que
// un objeto en memoria alcanza — no hace falta Redis ni pub/sub para esto.
// Se recarga al arrancar el servidor y cada vez que el admin cambia un switch.
let cache = {};

async function reloadModuleAccessCache() {
  const r = await pool.query("SELECT modulo, rol_codigo, habilitado FROM modulo_acceso");
  const next = {};
  for (const row of r.rows) {
    next[row.modulo] = next[row.modulo] || {};
    next[row.modulo][row.rol_codigo] = row.habilitado;
  }
  cache = next;
}

// ADMIN nunca se evalúa acá — requirePermission ya lo deja pasar por el '*'
// antes de llegar a esta función. Ausencia de entrada = habilitado.
function isModuleEnabledForRole(modulo, rolCodigo) {
  return cache[modulo]?.[rolCodigo] !== false;
}

async function listModuleAccess() {
  await reloadModuleAccessCache(); // fuente de verdad fresca para la pantalla de admin, no la cache de request-time
  return {
    modules: MODULES,
    roles: TOGGLEABLE_ROLES,
    access: MODULES.map((m) => ({
      modulo: m.code,
      label: m.label,
      roles: Object.fromEntries(TOGGLEABLE_ROLES.map((rol) => [rol, isModuleEnabledForRole(m.code, rol)])),
    })),
  };
}

async function setModuleAccess({ modulo, rolCodigo, habilitado, usuarioId, canal }) {
  if (!MODULE_CODES.includes(modulo)) {
    throw new AppError("SCHEMA_INVALID", `modulo debe ser uno de: ${MODULE_CODES.join(", ")}`, 400);
  }
  if (!TOGGLEABLE_ROLES.includes(rolCodigo)) {
    throw new AppError("SCHEMA_INVALID", `rolCodigo debe ser uno de: ${TOGGLEABLE_ROLES.join(", ")}`, 400);
  }
  const result = await withAuditedTransaction("admin.module_access.set", usuarioId, canal, async (client) => {
    const r = await client.query(
      `INSERT INTO modulo_acceso (modulo, rol_codigo, habilitado) VALUES ($1,$2,$3)
       ON CONFLICT (modulo, rol_codigo) DO UPDATE SET habilitado = EXCLUDED.habilitado
       RETURNING *`,
      [modulo, rolCodigo, !!habilitado]
    );
    return { entidad: "modulo_acceso", entidadId: r.rows[0].modulo_acceso_id, valorNuevo: { modulo, rolCodigo, habilitado: !!habilitado }, registro: r.rows[0] };
  });
  await reloadModuleAccessCache();
  return result;
}

module.exports = {
  MODULES, TOGGLEABLE_ROLES,
  reloadModuleAccessCache, isModuleEnabledForRole, listModuleAccess, setModuleAccess,
};

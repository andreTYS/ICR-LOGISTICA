const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");

// -------------------- Plan de cuentas --------------------

async function crearCuenta({ codigo, nombre, tipo, cuentaPadreCodigo, usuarioId, canal }) {
  if (!codigo || !nombre || !tipo) {
    throw new AppError("SCHEMA_INVALID", "codigo, nombre y tipo son obligatorios", 400);
  }
  return withAuditedTransaction("accounting.account.create", usuarioId, canal, async (client) => {
    let cuentaPadreId = null;
    if (cuentaPadreCodigo) {
      const r = await client.query("SELECT cuenta_id FROM plan_cuentas WHERE codigo=$1", [cuentaPadreCodigo]);
      if (r.rows.length === 0) throw new AppError("ACCOUNT_NOT_FOUND", `Cuenta padre '${cuentaPadreCodigo}' no existe`, 404);
      cuentaPadreId = r.rows[0].cuenta_id;
    }
    const r = await client.query(
      `INSERT INTO plan_cuentas (codigo, nombre, tipo, cuenta_padre_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [codigo, nombre, tipo, cuentaPadreId]
    );
    return { entidad: "plan_cuentas", entidadId: r.rows[0].cuenta_id, valorNuevo: { codigo, nombre, tipo }, cuenta: r.rows[0] };
  });
}

async function listCuentas() {
  const r = await pool.query(
    `SELECT c.*, padre.codigo AS cuenta_padre_codigo, padre.nombre AS cuenta_padre_nombre
     FROM plan_cuentas c
     LEFT JOIN plan_cuentas padre ON padre.cuenta_id = c.cuenta_padre_id
     WHERE c.activo = true
     ORDER BY c.codigo`
  );
  return r.rows;
}

// -------------------- Parámetros fiscales versionados --------------------

async function crearParametroFiscal({ tipo, valor, vigenteDesde, vigenteHasta, descripcion, usuarioId, canal }) {
  if (!tipo || valor == null || !vigenteDesde) {
    throw new AppError("SCHEMA_INVALID", "tipo, valor y vigenteDesde son obligatorios", 400);
  }
  return withAuditedTransaction("accounting.fiscal_param.create", usuarioId, canal, async (client) => {
    const r = await client.query(
      `INSERT INTO parametros_fiscales (tipo, valor, vigente_desde, vigente_hasta, descripcion)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tipo, valor, vigenteDesde, vigenteHasta || null, descripcion || null]
    );
    return { entidad: "parametros_fiscales", entidadId: r.rows[0].parametro_fiscal_id, valorNuevo: { tipo, valor, vigenteDesde }, parametro: r.rows[0] };
  });
}

async function listParametrosFiscales({ tipo }) {
  const params = [];
  let where = "";
  if (tipo) { params.push(tipo); where = "WHERE tipo = $1"; }
  const r = await pool.query(
    `SELECT * FROM parametros_fiscales ${where} ORDER BY tipo, vigente_desde DESC`,
    params
  );
  return r.rows;
}

// Valor vigente de un parámetro fiscal en una fecha dada (hoy si no se indica).
async function getParametroFiscalVigente(tipo, fecha) {
  const r = await pool.query(
    `SELECT * FROM parametros_fiscales
     WHERE tipo = $1 AND vigente_desde <= $2 AND (vigente_hasta IS NULL OR vigente_hasta >= $2)
     ORDER BY vigente_desde DESC LIMIT 1`,
    [tipo, fecha || new Date().toISOString().slice(0, 10)]
  );
  return r.rows[0] || null;
}

// -------------------- Reglas de imputación --------------------

async function crearRegla({ evento, cuentaDebeCodigo, cuentaHaberCodigo, descripcion, usuarioId, canal }) {
  if (!evento || !cuentaDebeCodigo || !cuentaHaberCodigo) {
    throw new AppError("SCHEMA_INVALID", "evento, cuentaDebeCodigo y cuentaHaberCodigo son obligatorios", 400);
  }
  return withAuditedTransaction("accounting.rule.create", usuarioId, canal, async (client) => {
    const debeR = await client.query("SELECT cuenta_id FROM plan_cuentas WHERE codigo=$1 AND activo=true", [cuentaDebeCodigo]);
    if (debeR.rows.length === 0) throw new AppError("ACCOUNT_NOT_FOUND", `Cuenta '${cuentaDebeCodigo}' no existe o está inactiva`, 404);
    const haberR = await client.query("SELECT cuenta_id FROM plan_cuentas WHERE codigo=$1 AND activo=true", [cuentaHaberCodigo]);
    if (haberR.rows.length === 0) throw new AppError("ACCOUNT_NOT_FOUND", `Cuenta '${cuentaHaberCodigo}' no existe o está inactiva`, 404);

    const r = await client.query(
      `INSERT INTO reglas_imputacion (evento, cuenta_debe_id, cuenta_haber_id, descripcion)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (evento) DO UPDATE SET cuenta_debe_id = EXCLUDED.cuenta_debe_id, cuenta_haber_id = EXCLUDED.cuenta_haber_id,
         descripcion = EXCLUDED.descripcion, activo = true
       RETURNING *`,
      [evento, debeR.rows[0].cuenta_id, haberR.rows[0].cuenta_id, descripcion || null]
    );
    return { entidad: "reglas_imputacion", entidadId: r.rows[0].regla_id, valorNuevo: { evento }, regla: r.rows[0] };
  });
}

async function listReglas() {
  const r = await pool.query(
    `SELECT ri.*, cd.codigo AS cuenta_debe_codigo, cd.nombre AS cuenta_debe_nombre,
            ch.codigo AS cuenta_haber_codigo, ch.nombre AS cuenta_haber_nombre
     FROM reglas_imputacion ri
     JOIN plan_cuentas cd ON cd.cuenta_id = ri.cuenta_debe_id
     JOIN plan_cuentas ch ON ch.cuenta_id = ri.cuenta_haber_id
     ORDER BY ri.evento`
  );
  return r.rows;
}

async function setReglaActiva({ evento, activo, usuarioId, canal }) {
  return withAuditedTransaction("accounting.rule.toggle", usuarioId, canal, async (client) => {
    const r = await client.query("UPDATE reglas_imputacion SET activo=$1 WHERE evento=$2 RETURNING *", [!!activo, evento]);
    if (r.rows.length === 0) throw new AppError("RULE_NOT_FOUND", `No existe una regla para el evento '${evento}'`, 404);
    return { entidad: "reglas_imputacion", entidadId: r.rows[0].regla_id, valorNuevo: { activo }, regla: r.rows[0] };
  });
}

// -------------------- Asientos --------------------

async function crearAsientoManual({ fecha, glosa, lineas, usuarioId, canal }) {
  if (!glosa || !Array.isArray(lineas) || lineas.length < 2) {
    throw new AppError("SCHEMA_INVALID", "glosa y al menos 2 líneas son obligatorios", 400);
  }
  const totalDebe = lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
  const totalHaber = lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    throw new AppError("ASIENTO_DESBALANCEADO", `El asiento no cuadra: debe=${totalDebe.toFixed(2)}, haber=${totalHaber.toFixed(2)}`, 400);
  }

  return withAuditedTransaction("accounting.entry.create", usuarioId, canal, async (client) => {
    const numR = await client.query("SELECT 'AS-' || to_char(nextval('asiento_numero_seq'), 'FM00000') AS numero");
    const numero = numR.rows[0].numero;

    const asR = await client.query(
      `INSERT INTO asientos (numero, fecha, glosa, creado_por) VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4) RETURNING *`,
      [numero, fecha || null, glosa, usuarioId]
    );
    const asiento = asR.rows[0];

    for (const l of lineas) {
      const debe = Number(l.debe || 0);
      const haber = Number(l.haber || 0);
      if ((debe > 0) === (haber > 0)) {
        throw new AppError("SCHEMA_INVALID", "cada línea debe tener debe>0 xor haber>0", 400);
      }
      const cuentaR = await client.query("SELECT cuenta_id FROM plan_cuentas WHERE codigo=$1 AND activo=true", [l.cuenta_codigo]);
      if (cuentaR.rows.length === 0) throw new AppError("ACCOUNT_NOT_FOUND", `Cuenta '${l.cuenta_codigo}' no existe o está inactiva`, 404);
      let proyectoId = null;
      if (l.proyecto_codigo) {
        const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1", [l.proyecto_codigo]);
        if (pr.rows.length === 0) throw new AppError("PROJECT_NOT_FOUND", `Proyecto '${l.proyecto_codigo}' no existe`, 404);
        proyectoId = pr.rows[0].proyecto_id;
      }
      await client.query(
        `INSERT INTO asiento_lineas (asiento_id, cuenta_id, debe, haber, proyecto_id) VALUES ($1,$2,$3,$4,$5)`,
        [asiento.asiento_id, cuentaR.rows[0].cuenta_id, debe, haber, proyectoId]
      );
    }

    return { entidad: "asientos", entidadId: asiento.asiento_id, valorNuevo: { numero, glosa }, asiento, numero };
  });
}

// Generación automática de un asiento de 2 líneas (debe/haber por el monto
// total) cuando existe una regla activa para el evento. Es best-effort:
// si no hay regla configurada, no hace nada (todavía no se han cargado las
// reglas contables) — nunca debe romper el flujo que lo dispara.
async function generarAsientoAutomatico({ evento, monto, glosa, origenId, usuarioId, canal }) {
  if (!monto || monto <= 0) return null;
  const reglaR = await pool.query(
    "SELECT * FROM reglas_imputacion WHERE evento=$1 AND activo=true",
    [evento]
  );
  if (reglaR.rows.length === 0) return null;
  const regla = reglaR.rows[0];

  return withAuditedTransaction("accounting.entry.auto", usuarioId, canal, async (client) => {
    const numR = await client.query("SELECT 'AS-' || to_char(nextval('asiento_numero_seq'), 'FM00000') AS numero");
    const numero = numR.rows[0].numero;
    const asR = await client.query(
      `INSERT INTO asientos (numero, glosa, origen_evento, origen_id, creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [numero, glosa || `Generado automáticamente (${evento})`, evento, origenId || null, usuarioId]
    );
    const asiento = asR.rows[0];
    await client.query(
      `INSERT INTO asiento_lineas (asiento_id, cuenta_id, debe, haber) VALUES ($1,$2,$3,0)`,
      [asiento.asiento_id, regla.cuenta_debe_id, monto]
    );
    await client.query(
      `INSERT INTO asiento_lineas (asiento_id, cuenta_id, debe, haber) VALUES ($1,$2,0,$3)`,
      [asiento.asiento_id, regla.cuenta_haber_id, monto]
    );
    return { entidad: "asientos", entidadId: asiento.asiento_id, valorNuevo: { numero, evento, monto }, asiento, numero };
  });
}

async function contabilizarAsiento({ numero, usuarioId, canal }) {
  return withAuditedTransaction("accounting.entry.post", usuarioId, canal, async (client) => {
    const asR = await client.query("SELECT * FROM asientos WHERE numero=$1 FOR UPDATE", [numero]);
    if (asR.rows.length === 0) throw new AppError("ENTRY_NOT_FOUND", `Asiento '${numero}' no existe`, 404);
    if (asR.rows[0].estado !== "BORRADOR") {
      throw new AppError("ENTRY_NOT_DRAFT", `El asiento '${numero}' ya no está en BORRADOR (estado actual: ${asR.rows[0].estado})`, 400);
    }
    const sumas = await client.query(
      "SELECT COALESCE(SUM(debe),0) AS debe, COALESCE(SUM(haber),0) AS haber FROM asiento_lineas WHERE asiento_id=$1",
      [asR.rows[0].asiento_id]
    );
    if (Math.abs(Number(sumas.rows[0].debe) - Number(sumas.rows[0].haber)) > 0.01) {
      throw new AppError("ASIENTO_DESBALANCEADO", "El asiento no cuadra, no se puede contabilizar", 400);
    }
    const r = await client.query("UPDATE asientos SET estado='CONTABILIZADO' WHERE asiento_id=$1 RETURNING *", [asR.rows[0].asiento_id]);
    return { entidad: "asientos", entidadId: r.rows[0].asiento_id, valorNuevo: { estado: "CONTABILIZADO" }, asiento: r.rows[0] };
  });
}

async function anularAsiento({ numero, usuarioId, canal }) {
  return withAuditedTransaction("accounting.entry.void", usuarioId, canal, async (client) => {
    const asR = await client.query("SELECT * FROM asientos WHERE numero=$1 FOR UPDATE", [numero]);
    if (asR.rows.length === 0) throw new AppError("ENTRY_NOT_FOUND", `Asiento '${numero}' no existe`, 404);
    if (asR.rows[0].estado === "ANULADO") {
      throw new AppError("ENTRY_ALREADY_VOID", `El asiento '${numero}' ya está anulado`, 400);
    }
    const r = await client.query("UPDATE asientos SET estado='ANULADO' WHERE asiento_id=$1 RETURNING *", [asR.rows[0].asiento_id]);
    return { entidad: "asientos", entidadId: r.rows[0].asiento_id, valorNuevo: { estado: "ANULADO" }, asiento: r.rows[0] };
  });
}

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

async function listAsientos({ estado, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`estado = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT a.*, COUNT(*) OVER() AS total_count,
            (SELECT COALESCE(SUM(debe),0) FROM asiento_lineas WHERE asiento_id = a.asiento_id) AS total
     FROM asientos a
     ${where}
     ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getAsiento(numero) {
  const asR = await pool.query("SELECT * FROM asientos WHERE numero=$1", [numero]);
  if (asR.rows.length === 0) throw new AppError("ENTRY_NOT_FOUND", `Asiento '${numero}' no existe`, 404);
  const lineasR = await pool.query(
    `SELECT al.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, p.codigo_proyecto
     FROM asiento_lineas al
     JOIN plan_cuentas c ON c.cuenta_id = al.cuenta_id
     LEFT JOIN proyectos p ON p.proyecto_id = al.proyecto_id
     WHERE al.asiento_id = $1 ORDER BY al.debe DESC`,
    [asR.rows[0].asiento_id]
  );
  return { ...asR.rows[0], lineas: lineasR.rows };
}

module.exports = {
  crearCuenta, listCuentas,
  crearParametroFiscal, listParametrosFiscales, getParametroFiscalVigente,
  crearRegla, listReglas, setReglaActiva,
  crearAsientoManual, generarAsientoAutomatico, contabilizarAsiento, anularAsiento,
  listAsientos, getAsiento,
};

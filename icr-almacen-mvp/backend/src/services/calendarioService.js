const { pool } = require("../db");
const { AppError } = require("../errors");

// Agenda unificada: no es una tabla propia, es una vista de solo lectura
// sobre fechas que ya existen repartidas en otros módulos (leads,
// mantenimientos, hitos de contrato, garantías, asistencia). Cada módulo
// sigue siendo dueño de su dato — acá solo se listan para dar una sola
// pantalla de "qué hay que hacer/vencer" en vez de revisar cada módulo.
const TIPOS_EVENTO = [
  "LEAD_SEGUIMIENTO",
  "MANTENIMIENTO",
  "HITO_CONTRATO",
  "GARANTIA_VENCE",
  "ASISTENCIA",
];

function normalizarRango({ desde, hasta }) {
  const d = desde || new Date().toISOString().slice(0, 10);
  const hDefault = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const h = hasta || hDefault;
  if (new Date(h) < new Date(d)) {
    throw new AppError("SCHEMA_INVALID", "hasta no puede ser anterior a desde", 400);
  }
  return { desde: d, hasta: h };
}

async function getEventos({ desde, hasta, tipos } = {}) {
  const rango = normalizarRango({ desde, hasta });
  const tiposFiltro = Array.isArray(tipos) && tipos.length > 0
    ? tipos.filter((t) => TIPOS_EVENTO.includes(t))
    : TIPOS_EVENTO;
  if (tiposFiltro.length === 0) return [];

  const partes = [];
  const params = [rango.desde, rango.hasta];

  if (tiposFiltro.includes("LEAD_SEGUIMIENTO")) {
    partes.push(`
      SELECT l.fecha_proximo_seguimiento AS fecha, 'LEAD_SEGUIMIENTO' AS tipo,
             l.codigo AS titulo, l.nombre_contacto || COALESCE(' — ' || l.empresa, '') AS subtitulo,
             l.etapa AS estado, 'lead' AS entidad_tipo, l.lead_id::text AS entidad_id
      FROM leads l
      WHERE l.fecha_proximo_seguimiento BETWEEN $1 AND $2
        AND l.etapa NOT IN ('GANADO','PERDIDO')
    `);
  }
  if (tiposFiltro.includes("MANTENIMIENTO")) {
    partes.push(`
      SELECT m.fecha_programada AS fecha, 'MANTENIMIENTO' AS tipo,
             a.descripcion AS titulo, m.tipo || COALESCE(': ' || m.descripcion, '') AS subtitulo,
             m.estado AS estado, 'activo' AS entidad_tipo, a.activo_id::text AS entidad_id
      FROM mantenimientos m
      JOIN activos_instalados a ON a.activo_id = m.activo_id
      WHERE m.fecha_programada BETWEEN $1 AND $2
        AND m.estado NOT IN ('COMPLETADO','CANCELADO')
    `);
  }
  if (tiposFiltro.includes("HITO_CONTRATO")) {
    partes.push(`
      SELECT h.fecha_esperada AS fecha, 'HITO_CONTRATO' AS tipo,
             c.codigo_contrato AS titulo, h.descripcion AS subtitulo,
             h.estado AS estado, 'contrato' AS entidad_tipo, c.contrato_id::text AS entidad_id
      FROM contrato_hitos h
      JOIN contratos c ON c.contrato_id = h.contrato_id
      WHERE h.fecha_esperada BETWEEN $1 AND $2
        AND h.estado IN ('PENDIENTE','VENCIDO')
    `);
  }
  if (tiposFiltro.includes("GARANTIA_VENCE")) {
    partes.push(`
      SELECT a.garantia_fin AS fecha, 'GARANTIA_VENCE' AS tipo,
             a.descripcion AS titulo, 'Vence garantía' AS subtitulo,
             a.estado AS estado, 'activo' AS entidad_tipo, a.activo_id::text AS entidad_id
      FROM activos_instalados a
      WHERE a.garantia_fin BETWEEN $1 AND $2
        AND a.estado <> 'RETIRADO'
    `);
  }
  if (tiposFiltro.includes("ASISTENCIA")) {
    partes.push(`
      SELECT ast.fecha AS fecha, 'ASISTENCIA' AS tipo,
             e.nombre_completo AS titulo,
             CASE WHEN ast.hora_salida IS NULL THEN 'Sin marcar salida' ELSE 'Jornada registrada' END AS subtitulo,
             CASE WHEN ast.hora_salida IS NULL THEN 'ABIERTA' ELSE 'CERRADA' END AS estado,
             'empleado' AS entidad_tipo, e.empleado_id::text AS entidad_id
      FROM asistencias ast
      JOIN empleados e ON e.empleado_id = ast.empleado_id
      WHERE ast.fecha BETWEEN $1 AND $2
    `);
  }

  const sql = partes.join(" UNION ALL ") + " ORDER BY fecha ASC";
  const r = await pool.query(sql, params);
  return r.rows;
}

module.exports = { getEventos, TIPOS_EVENTO };

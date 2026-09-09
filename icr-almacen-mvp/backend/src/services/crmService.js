const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const cotizaciones = require("./cotizacionesService");

const ETAPAS_VALIDAS = ["NUEVO", "CONTACTADO", "CALIFICADO", "PROPUESTA", "GANADO", "PERDIDO"];
const ETAPAS_ABIERTAS = ["NUEVO", "CONTACTADO", "CALIFICADO", "PROPUESTA"];
const ORIGENES_VALIDOS = ["REFERIDO", "WEB", "LLAMADA", "REDES_SOCIALES", "FERIA", "OTRO"];
const TIPOS_ACTIVIDAD_VALIDOS = ["LLAMADA", "EMAIL", "REUNION", "NOTA"];

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Pipeline comercial previo a Cotizaciones: un lead es un contacto u
// oportunidad, todavía sin ítems ni monto formal — solo cuando se "gana"
// (convertirACotizacion) nace el primer documento formal del negocio.
// Deliberadamente simple (sin scoring ni campañas), PRD-style: el pipeline
// y su seguimiento, nada más.
async function crearLead({ nombreContacto, empresa, telefono, email, clienteRuc, origen, montoEstimado, moneda, fechaProximoSeguimiento, notas, usuarioId, canal }) {
  if (!nombreContacto) {
    throw new AppError("SCHEMA_INVALID", "nombreContacto es obligatorio", 400);
  }
  if (origen && !ORIGENES_VALIDOS.includes(origen)) {
    throw new AppError("SCHEMA_INVALID", `origen debe ser uno de: ${ORIGENES_VALIDOS.join(", ")}`, 400);
  }
  return withAuditedTransaction("crm.lead.create", usuarioId, canal, async (client) => {
    let clienteId = null;
    if (clienteRuc) {
      const c = await client.query("SELECT cliente_id FROM clientes WHERE ruc=$1 AND activo=true", [clienteRuc]);
      if (c.rows.length === 0) throw new AppError("CLIENT_NOT_FOUND", `Cliente con RUC '${clienteRuc}' no existe o está inactivo`, 404);
      clienteId = c.rows[0].cliente_id;
    }

    const numR = await client.query("SELECT 'LEAD-' || to_char(nextval('lead_numero_seq'), 'FM00000') AS codigo");
    const codigo = numR.rows[0].codigo;

    const r = await client.query(
      `INSERT INTO leads (codigo, nombre_contacto, empresa, telefono, email, cliente_id, origen, monto_estimado, moneda, responsable_id, fecha_proximo_seguimiento, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'PEN'),$10,$11,$12) RETURNING *`,
      [codigo, nombreContacto, empresa || null, telefono || null, email || null, clienteId, origen || null,
        montoEstimado || null, moneda || null, usuarioId, fechaProximoSeguimiento || null, notas || null]
    );
    return { entidad: "leads", entidadId: r.rows[0].lead_id, valorNuevo: { codigo }, lead: r.rows[0] };
  });
}

async function actualizarEtapa({ codigo, etapa, motivoPerdida, usuarioId, canal }) {
  if (!ETAPAS_VALIDAS.includes(etapa) || etapa === "GANADO") {
    throw new AppError("SCHEMA_INVALID", `estado debe ser uno de: NUEVO, CONTACTADO, CALIFICADO, PROPUESTA, PERDIDO`, 400);
  }
  if (etapa === "PERDIDO" && !motivoPerdida) {
    throw new AppError("SCHEMA_INVALID", "motivoPerdida es obligatorio al marcar un lead como PERDIDO", 400);
  }
  return withAuditedTransaction("crm.lead.update_stage", usuarioId, canal, async (client) => {
    const lead = await client.query("SELECT * FROM leads WHERE codigo=$1 FOR UPDATE", [codigo]);
    if (lead.rows.length === 0) throw new AppError("LEAD_NOT_FOUND", `Lead '${codigo}' no existe`, 404);
    if (lead.rows[0].etapa === "GANADO") {
      throw new AppError("LEAD_ALREADY_WON", `El lead '${codigo}' ya fue ganado y convertido en cotización`, 400);
    }
    const r = await client.query(
      "UPDATE leads SET etapa=$1, motivo_perdida=$2 WHERE codigo=$3 RETURNING *",
      [etapa, etapa === "PERDIDO" ? motivoPerdida : null, codigo]
    );
    return { entidad: "leads", entidadId: r.rows[0].lead_id, valorNuevo: { etapa }, lead: r.rows[0] };
  });
}

async function registrarActividad({ codigo, tipo, descripcion, fecha, usuarioId, canal }) {
  if (!TIPOS_ACTIVIDAD_VALIDOS.includes(tipo) || !descripcion) {
    throw new AppError("SCHEMA_INVALID", `tipo debe ser uno de: ${TIPOS_ACTIVIDAD_VALIDOS.join(", ")}, y descripcion es obligatoria`, 400);
  }
  return withAuditedTransaction("crm.lead.activity", usuarioId, canal, async (client) => {
    const lead = await client.query("SELECT lead_id FROM leads WHERE codigo=$1", [codigo]);
    if (lead.rows.length === 0) throw new AppError("LEAD_NOT_FOUND", `Lead '${codigo}' no existe`, 404);
    const r = await client.query(
      `INSERT INTO lead_actividades (lead_id, tipo, descripcion, fecha, registrado_por) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5) RETURNING *`,
      [lead.rows[0].lead_id, tipo, descripcion, fecha || null, usuarioId]
    );
    return { entidad: "lead_actividades", entidadId: r.rows[0].actividad_id, valorNuevo: { codigo, tipo }, actividad: r.rows[0] };
  });
}

// Convierte un lead en la primera cotización formal del negocio: reusa
// cotizacionesService.crearCotizacion para no duplicar lógica (mismo
// patrón que cotizacionesService.convertirAContrato reusa ventasService).
// El lead pasa a GANADO y queda enlazado a la cotización resultante.
async function convertirACotizacion({ codigo, items, proyectoCodigo, moneda, validezDias, usuarioId, canal }) {
  const lead = await getLead(codigo);
  if (!ETAPAS_ABIERTAS.includes(lead.etapa)) {
    throw new AppError("LEAD_NOT_OPEN", `El lead '${codigo}' debe estar en una etapa abierta para convertirse (estado actual: ${lead.etapa})`, 400);
  }
  if (!lead.cliente_id) {
    throw new AppError("LEAD_WITHOUT_CLIENT", `El lead '${codigo}' no tiene un cliente vinculado; vincúlalo antes de convertirlo en cotización`, 400);
  }

  const clienteR = await pool.query("SELECT ruc FROM clientes WHERE cliente_id=$1", [lead.cliente_id]);
  const resultado = await cotizaciones.crearCotizacion({
    clienteRuc: clienteR.rows[0].ruc, proyectoCodigo: proyectoCodigo || null,
    moneda: moneda || lead.moneda, validezDias: validezDias || null, items,
    usuarioId, canal,
  });

  return withAuditedTransaction("crm.lead.convert", usuarioId, canal, async (client) => {
    const r = await client.query(
      "UPDATE leads SET etapa='GANADO', cotizacion_id=$1 WHERE codigo=$2 RETURNING *",
      [resultado.cotizacion.cotizacion_id, codigo]
    );
    return {
      entidad: "leads", entidadId: r.rows[0].lead_id, valorNuevo: { etapa: "GANADO", codigoCotizacion: resultado.cotizacion.codigo },
      lead: r.rows[0], cotizacion: resultado.cotizacion,
    };
  });
}

async function listLeads({ etapa, responsableId, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (etapa) { params.push(etapa); conditions.push(`l.etapa = $${params.length}`); }
  if (responsableId) { params.push(responsableId); conditions.push(`l.responsable_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT l.*, c.razon_social AS cliente_nombre, u.nombre_completo AS responsable_nombre, COUNT(*) OVER() AS total_count
     FROM leads l
     LEFT JOIN clientes c ON c.cliente_id = l.cliente_id
     LEFT JOIN usuarios u ON u.usuario_id = l.responsable_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getLead(codigo) {
  const leadR = await pool.query(
    `SELECT l.*, c.razon_social AS cliente_nombre, c.ruc AS cliente_ruc, u.nombre_completo AS responsable_nombre,
            co.codigo AS cotizacion_codigo
     FROM leads l
     LEFT JOIN clientes c ON c.cliente_id = l.cliente_id
     LEFT JOIN usuarios u ON u.usuario_id = l.responsable_id
     LEFT JOIN cotizaciones co ON co.cotizacion_id = l.cotizacion_id
     WHERE l.codigo = $1`,
    [codigo]
  );
  if (leadR.rows.length === 0) throw new AppError("LEAD_NOT_FOUND", `Lead '${codigo}' no existe`, 404);
  const lead = leadR.rows[0];

  const actividadesR = await pool.query(
    `SELECT a.*, u.nombre_completo AS registrado_por_nombre FROM lead_actividades a
     LEFT JOIN usuarios u ON u.usuario_id = a.registrado_por
     WHERE a.lead_id=$1 ORDER BY a.fecha DESC, a.created_at DESC`,
    [lead.lead_id]
  );
  return { ...lead, actividades: actividadesR.rows };
}

module.exports = {
  crearLead, actualizarEtapa, registrarActividad, convertirACotizacion, listLeads, getLead,
};

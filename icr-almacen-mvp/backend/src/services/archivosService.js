const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const { deleteUploadedFile } = require("../uploads");

// Gestión documental: adjuntar planos, permisos municipales, certificados
// de garantía o fotos de instalación a un proyecto, cliente, activo,
// contrato o lead. Asociación polimórfica (entidad_tipo + entidad_id) —
// como no hay FK de base de datos posible acá, se valida a mano que la
// entidad exista antes de guardar el adjunto.
const ENTIDAD_TABLAS = {
  proyecto: { tabla: "proyectos", columna: "proyecto_id" },
  cliente: { tabla: "clientes", columna: "cliente_id" },
  activo: { tabla: "activos_instalados", columna: "activo_id" },
  contrato: { tabla: "contratos", columna: "contrato_id" },
  lead: { tabla: "leads", columna: "lead_id" },
};
const ENTIDAD_TIPOS_VALIDOS = Object.keys(ENTIDAD_TABLAS);

async function verificarEntidadExiste(client, entidadTipo, entidadId) {
  if (!ENTIDAD_TIPOS_VALIDOS.includes(entidadTipo)) {
    throw new AppError("SCHEMA_INVALID", `entidadTipo debe ser uno de: ${ENTIDAD_TIPOS_VALIDOS.join(", ")}`, 400);
  }
  const { tabla, columna } = ENTIDAD_TABLAS[entidadTipo];
  const r = await client.query(`SELECT 1 FROM ${tabla} WHERE ${columna} = $1`, [entidadId]);
  if (r.rows.length === 0) {
    throw new AppError("ENTITY_NOT_FOUND", `No existe ${entidadTipo} con id '${entidadId}'`, 404);
  }
}

// El archivo ya fue guardado en disco por la ruta (uploads.saveDocumentFile)
// antes de llegar acá — este servicio solo persiste sus metadatos, mismo
// patrón que settings.setLogoUrl() recibe la URL ya procesada.
async function subirArchivo({ entidadTipo, entidadId, nombre, url, tipoArchivo, tamanoBytes, usuarioId, canal }) {
  if (!entidadTipo || !entidadId || !nombre || !url) {
    throw new AppError("SCHEMA_INVALID", "entidadTipo, entidadId, nombre y url son obligatorios", 400);
  }
  return withAuditedTransaction("documents.upload", usuarioId, canal, async (client) => {
    await verificarEntidadExiste(client, entidadTipo, entidadId);
    const r = await client.query(
      `INSERT INTO archivos_adjuntos (entidad_tipo, entidad_id, nombre, url, tipo_archivo, tamano_bytes, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [entidadTipo, entidadId, nombre, url, tipoArchivo || null, tamanoBytes || null, usuarioId]
    );
    return { entidad: "archivos_adjuntos", entidadId: r.rows[0].archivo_id, valorNuevo: { nombre, entidadTipo }, archivo: r.rows[0] };
  });
}

async function listArchivos({ entidadTipo, entidadId }) {
  if (!entidadTipo || !entidadId) {
    throw new AppError("SCHEMA_INVALID", "entidadTipo y entidadId son obligatorios", 400);
  }
  const r = await pool.query(
    `SELECT a.*, u.nombre_completo AS subido_por_nombre
     FROM archivos_adjuntos a
     LEFT JOIN usuarios u ON u.usuario_id = a.subido_por
     WHERE a.entidad_tipo = $1 AND a.entidad_id = $2
     ORDER BY a.created_at DESC`,
    [entidadTipo, entidadId]
  );
  return r.rows;
}

async function eliminarArchivo({ archivoId, usuarioId, canal }) {
  const result = await withAuditedTransaction("documents.delete", usuarioId, canal, async (client) => {
    const r = await client.query("DELETE FROM archivos_adjuntos WHERE archivo_id=$1 RETURNING *", [archivoId]);
    if (r.rows.length === 0) throw new AppError("DOCUMENT_NOT_FOUND", "El archivo indicado no existe", 404);
    return { entidad: "archivos_adjuntos", entidadId: archivoId, valorNuevo: { eliminado: true }, archivo: r.rows[0] };
  });
  await deleteUploadedFile(result.archivo.url);
  return result;
}

module.exports = { subirArchivo, listArchivos, eliminarArchivo, ENTIDAD_TIPOS_VALIDOS };

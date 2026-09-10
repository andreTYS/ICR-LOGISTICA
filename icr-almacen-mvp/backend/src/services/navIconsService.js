const { pool } = require("../db");
const { AppError } = require("../errors");
const { withAuditedTransaction } = require("./inventoryService");
const { deleteUploadedFile } = require("../uploads");

// Personalización opcional del menú lateral: cambiar el ícono SVG de un
// ítem o grupo de navegación por una imagen propia. `itemKey` es el
// `data-view` de un ítem tal cual, o "group:<data-group>" para el ícono de
// un grupo completo — el frontend valida esa forma antes de mostrar el
// botón de edición, acá solo se valida que no venga vacío.
async function listNavIcons() {
  const r = await pool.query("SELECT item_key, imagen_url FROM nav_icon_overrides");
  return r.rows;
}

async function setNavIcon({ itemKey, imagenUrl, usuarioId, canal }) {
  if (!itemKey || !imagenUrl) {
    throw new AppError("SCHEMA_INVALID", "itemKey e imagenUrl son obligatorios", 400);
  }
  return withAuditedTransaction("admin.nav_icon.set", usuarioId, canal, async (client) => {
    const prev = await client.query("SELECT imagen_url FROM nav_icon_overrides WHERE item_key=$1", [itemKey]);
    const r = await client.query(
      `INSERT INTO nav_icon_overrides (item_key, imagen_url, updated_por)
       VALUES ($1,$2,$3)
       ON CONFLICT (item_key) DO UPDATE SET imagen_url = EXCLUDED.imagen_url, updated_por = EXCLUDED.updated_por, updated_at = now()
       RETURNING *`,
      [itemKey, imagenUrl, usuarioId]
    );
    if (prev.rows[0]?.imagen_url && prev.rows[0].imagen_url !== imagenUrl) {
      await deleteUploadedFile(prev.rows[0].imagen_url);
    }
    return { entidad: "nav_icon_overrides", valorNuevo: { itemKey, imagenUrl }, override: r.rows[0] };
  });
}

async function removeNavIcon({ itemKey, usuarioId, canal }) {
  return withAuditedTransaction("admin.nav_icon.remove", usuarioId, canal, async (client) => {
    const r = await client.query("DELETE FROM nav_icon_overrides WHERE item_key=$1 RETURNING *", [itemKey]);
    if (r.rows.length === 0) throw new AppError("NAV_ICON_NOT_FOUND", "Ese ítem no tiene un ícono personalizado", 404);
    return { entidad: "nav_icon_overrides", valorNuevo: { itemKey, eliminado: true }, override: r.rows[0] };
  }).then(async (result) => {
    await deleteUploadedFile(result.override.imagen_url);
    return result;
  });
}

module.exports = { listNavIcons, setNavIcon, removeNavIcon };

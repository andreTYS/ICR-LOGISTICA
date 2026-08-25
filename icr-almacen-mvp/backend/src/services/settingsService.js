const { pool } = require("../db");

// Configuración editable en runtime, guardada en la tabla `parametros`
// (ya existía para flags como STOCK_NEGATIVO_PERMITIDO). LOGO_URL apunta a
// un archivo servido desde /uploads.
async function getSettings() {
  const r = await pool.query("SELECT clave, valor FROM parametros WHERE clave = 'LOGO_URL'");
  return { logo_url: r.rows[0]?.valor || null };
}

async function setLogoUrl(url) {
  await pool.query(
    `INSERT INTO parametros (clave, valor, tipo_dato, descripcion)
     VALUES ('LOGO_URL', $1, 'STRING', 'URL del logo mostrado en el panel')
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
    [url]
  );
  return { logo_url: url };
}

module.exports = { getSettings, setLogoUrl };

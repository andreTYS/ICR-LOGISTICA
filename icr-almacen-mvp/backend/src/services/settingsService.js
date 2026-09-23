const { pool } = require("../db");

// Configuración editable en runtime, guardada en la tabla `parametros`
// (ya existía para flags como STOCK_NEGATIVO_PERMITIDO). LOGO_URL apunta a
// un archivo servido desde /uploads. Los datos de empresa (razón social,
// RUC, dirección, teléfono) no son sensibles — van impresos en los PDF que
// ya se le entregan al cliente — así que viajan junto al logo en el mismo
// endpoint público que usa la pantalla de login.
const EMPRESA_KEYS = {
  razon_social: "EMPRESA_RAZON_SOCIAL",
  ruc: "EMPRESA_RUC",
  direccion: "EMPRESA_DIRECCION",
  telefono: "EMPRESA_TELEFONO",
};

async function getSettings() {
  const r = await pool.query(
    "SELECT clave, valor FROM parametros WHERE clave = ANY($1)",
    [["LOGO_URL", ...Object.values(EMPRESA_KEYS)]]
  );
  const map = Object.fromEntries(r.rows.map((row) => [row.clave, row.valor]));
  const empresa = {};
  for (const [field, key] of Object.entries(EMPRESA_KEYS)) empresa[field] = map[key] || null;
  return { logo_url: map.LOGO_URL || null, empresa };
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

async function setEmpresaInfo({ razonSocial, ruc, direccion, telefono }) {
  const values = { razon_social: razonSocial, ruc, direccion, telefono };
  for (const [field, key] of Object.entries(EMPRESA_KEYS)) {
    if (values[field] === undefined) continue;
    await pool.query(
      `INSERT INTO parametros (clave, valor, tipo_dato, descripcion)
       VALUES ($1,$2,'STRING','Datos de la empresa mostrados en documentos y PDF')
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
      [key, values[field] || ""]
    );
  }
  return (await getSettings()).empresa;
}

module.exports = { getSettings, setLogoUrl, setEmpresaInfo };

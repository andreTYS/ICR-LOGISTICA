const { pool } = require("../db");
const { AppError } = require("../errors");
const { extractDriveFolderId } = require("./proyectosService");

// Credenciales de integraciones (Google Drive, WhatsApp/Evolution API)
// editables desde Administración → Integraciones, sin tener que entrar por
// SSH a editar el .env y reconstruir el contenedor cada vez. Reusa la misma
// tabla `parametros` que ya guarda el logo y los datos de empresa —no hace
// falta ninguna tabla ni migración nueva.
//
// getConfigValue() prioriza lo guardado acá; si no hay nada, cae a la
// variable de entorno del servidor — así una instalación que ya configuró
// todo por .env (como esta, hasta ahora) sigue funcionando exactamente
// igual, sin migrar nada a la fuerza.
const CLAVES_VALIDAS = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_DRIVE_FOLDER_ID",
  "EVOLUTION_API_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_INSTANCE",
];

async function getConfigValue(clave) {
  const r = await pool.query("SELECT valor FROM parametros WHERE clave=$1", [clave]);
  if (r.rows.length > 0 && r.rows[0].valor) return r.rows[0].valor;
  return process.env[clave] || null;
}

// El valor nunca se audita ni se devuelve de vuelta — solo se confirma la
// clave que se guardó, mismo criterio que adminService.getIntegrationsStatus
// nunca expone el valor real de una variable de entorno.
async function setConfigValue({ clave, valor }) {
  if (!CLAVES_VALIDAS.includes(clave)) {
    throw new AppError("SCHEMA_INVALID", `clave debe ser una de: ${CLAVES_VALIDAS.join(", ")}`, 400);
  }
  if (!valor || typeof valor !== "string") {
    throw new AppError("SCHEMA_INVALID", "valor es obligatorio", 400);
  }
  if (clave === "GOOGLE_SERVICE_ACCOUNT_JSON") {
    try {
      JSON.parse(valor);
    } catch {
      throw new AppError("SCHEMA_INVALID", "El JSON de la cuenta de servicio no es válido — pega el archivo .json completo tal cual", 400);
    }
  }
  // Mismo criterio que proyectosService.setDriveFolderId: se puede pegar el
  // link completo de Drive tal cual se copia del navegador, sin recortarlo.
  const valorFinal = clave === "GOOGLE_DRIVE_FOLDER_ID" ? extractDriveFolderId(valor) : valor;
  await pool.query(
    `INSERT INTO parametros (clave, valor, tipo_dato, descripcion)
     VALUES ($1,$2,'STRING','Credencial de integración configurada desde el panel')
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
    [clave, valorFinal]
  );
  return { clave };
}

module.exports = { getConfigValue, setConfigValue, CLAVES_VALIDAS };

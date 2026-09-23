class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Mensajes claros para las restricciones de la base de datos que más se
// disparan desde formularios (duplicados, formatos inválidos) en vez de
// dejar que el error crudo de Postgres llegue como "Error interno del
// servidor" — el usuario final no debe ver códigos de Postgres.
const MENSAJES_CHECK = {
  plan_cuentas_codigo_formato: "El código de cuenta debe ser numérico (ej. 20, 70.1)",
  reglas_imputacion_evento_formato: "El evento debe ser un identificador de texto (ej. purchases.receive), no un número",
  parametros_fiscales_valor_no_negativo: "El valor del parámetro fiscal no puede ser negativo",
  parametros_fiscales_check: "La fecha de vigencia hasta no puede ser anterior a la fecha desde",
  clientes_ruc_o_dni: "El cliente debe tener al menos un RUC o DNI",
  activos_instalados_check: "La fecha de fin de garantía no puede ser anterior a la fecha de inicio",
};

// Traduce un error de Postgres (no controlado por la app con un AppError
// explícito) a uno con mensaje claro, o null si no es un caso conocido.
function translatePgError(err) {
  if (err.code === "23505") {
    // unique_violation — err.detail: Key (columna)=(valor) already exists.
    const match = /Key \(([^)]+)\)=\(([^)]+)\)/.exec(err.detail || "");
    const detalle = match ? ` (${match[1]}: '${match[2]}')` : "";
    return new AppError("DUPLICATE_RECORD", `Ya existe un registro con esos datos${detalle}`, 409);
  }
  if (err.code === "23514") {
    // check_violation
    const mensaje = MENSAJES_CHECK[err.constraint] || `El valor ingresado no cumple una regla de validación (${err.constraint || "restricción"})`;
    return new AppError("SCHEMA_INVALID", mensaje, 400);
  }
  if (err.code === "23503") {
    // foreign_key_violation
    return new AppError("REFERENCE_INVALID", "El registro referenciado no existe o fue eliminado", 400);
  }
  return null;
}

module.exports = { AppError, translatePgError };

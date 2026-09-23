// Test unitario (sin DB) del traductor de errores de Postgres — verifica que
// un duplicado o una violación de CHECK nunca llegue al usuario como
// "Error interno del servidor" (bug reportado en la revisión funcional).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { translatePgError, AppError } = require("../src/errors");

test("unique_violation (23505) se traduce a un mensaje de duplicado con el campo y valor", () => {
  const err = { code: "23505", detail: "Key (ruc)=(20605309489) already exists." };
  const translated = translatePgError(err);
  assert.ok(translated instanceof AppError);
  assert.equal(translated.status, 409);
  assert.match(translated.message, /ruc.*20605309489/);
});

test("check_violation (23514) con una restricción conocida usa su mensaje amigable", () => {
  const err = { code: "23514", constraint: "plan_cuentas_codigo_formato" };
  const translated = translatePgError(err);
  assert.equal(translated.status, 400);
  assert.match(translated.message, /código de cuenta debe ser numérico/);
});

test("check_violation (23514) con una restricción desconocida cae en un mensaje genérico con el nombre de la restricción", () => {
  const err = { code: "23514", constraint: "algo_no_mapeado" };
  const translated = translatePgError(err);
  assert.equal(translated.status, 400);
  assert.match(translated.message, /algo_no_mapeado/);
});

test("foreign_key_violation (23503) se traduce a un mensaje de referencia inválida", () => {
  const translated = translatePgError({ code: "23503" });
  assert.equal(translated.status, 400);
  assert.equal(translated.code, "REFERENCE_INVALID");
});

test("un error sin código de Postgres conocido devuelve null (sigue siendo un 500 genérico)", () => {
  assert.equal(translatePgError({ message: "algo raro" }), null);
  assert.equal(translatePgError(new Error("boom")), null);
});

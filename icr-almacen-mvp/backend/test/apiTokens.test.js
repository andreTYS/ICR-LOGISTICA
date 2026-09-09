// Tests de tokens de servicio (N8N y similares): generación, verificación
// (usada por requireAuth) y revocación. El valor en claro solo existe en la
// respuesta de crearApiToken — de ahí en más solo vive su hash en BD.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const { verifyApiToken, hashApiToken, API_TOKEN_PREFIX } = require("../src/auth");
const admin = require("../src/services/adminService");

const ADMIN = "00000000-0000-0000-0000-000000000001"; // seed.sql
const SUPERVISOR = "00000000-0000-0000-0000-000000000003"; // seed.sql

test("crearApiToken genera un token con el prefijo esperado y solo guarda su hash", async () => {
  const r = await admin.crearApiToken({
    actuaComoUsuarioId: SUPERVISOR, etiqueta: "N8N producción", usuarioId: ADMIN, canal: "web",
  });
  assert.ok(r.token.startsWith(API_TOKEN_PREFIX));
  assert.equal(r.apiToken.usuario_rol, "SUPERVISOR");

  const row = await pool.query("SELECT token_hash FROM api_tokens WHERE api_token_id=$1", [r.apiToken.api_token_id]);
  assert.equal(row.rows[0].token_hash, hashApiToken(r.token));
  assert.ok(!JSON.stringify(r.apiToken).includes(r.token), "el token en claro no debe reaparecer en el registro guardado");
});

test("crearApiToken rechaza actuar como un usuario inexistente o inactivo", async () => {
  await assert.rejects(
    admin.crearApiToken({ actuaComoUsuarioId: "00000000-0000-0000-0000-000000009999", etiqueta: "X", usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "USER_NOT_FOUND"
  );
});

test("verifyApiToken acepta un token válido y hereda el rol del usuario al que representa", async () => {
  const r = await admin.crearApiToken({ actuaComoUsuarioId: SUPERVISOR, etiqueta: "Verificación", usuarioId: ADMIN, canal: "web" });
  const user = await verifyApiToken(r.token);
  assert.equal(user.usuario_id, SUPERVISOR);
  assert.equal(user.rol_codigo, "SUPERVISOR");
});

test("verifyApiToken rechaza un token inexistente", async () => {
  await assert.rejects(
    verifyApiToken(API_TOKEN_PREFIX + "0".repeat(48)),
    (err) => err.code === "AUTH_INVALID"
  );
});

test("verifyApiToken rechaza un token revocado", async () => {
  const r = await admin.crearApiToken({ actuaComoUsuarioId: SUPERVISOR, etiqueta: "A revocar", usuarioId: ADMIN, canal: "web" });
  await admin.revocarApiToken({ apiTokenId: r.apiToken.api_token_id, usuarioId: ADMIN, canal: "web" });
  await assert.rejects(verifyApiToken(r.token), (err) => err.code === "AUTH_INVALID" && /revocado/.test(err.message));
});

test("revocarApiToken rechaza revocar dos veces el mismo token", async () => {
  const r = await admin.crearApiToken({ actuaComoUsuarioId: SUPERVISOR, etiqueta: "Doble revocación", usuarioId: ADMIN, canal: "web" });
  await admin.revocarApiToken({ apiTokenId: r.apiToken.api_token_id, usuarioId: ADMIN, canal: "web" });
  await assert.rejects(
    admin.revocarApiToken({ apiTokenId: r.apiToken.api_token_id, usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "API_TOKEN_NOT_FOUND"
  );
});

test("verifyApiToken rechaza un token ya expirado", async () => {
  const r = await admin.crearApiToken({ actuaComoUsuarioId: SUPERVISOR, etiqueta: "Expirado", expiraDias: 1, usuarioId: ADMIN, canal: "web" });
  await pool.query("UPDATE api_tokens SET expira_en = now() - interval '1 hour' WHERE api_token_id=$1", [r.apiToken.api_token_id]);
  await assert.rejects(verifyApiToken(r.token), (err) => err.code === "AUTH_INVALID" && /expirado/.test(err.message));
});

test("listApiTokens devuelve los tokens sin exponer el hash", async () => {
  const items = await admin.listApiTokens();
  assert.ok(items.length > 0);
  assert.ok(!("token_hash" in items[0]));
  assert.ok(items[0].prefijo.startsWith(API_TOKEN_PREFIX));
});

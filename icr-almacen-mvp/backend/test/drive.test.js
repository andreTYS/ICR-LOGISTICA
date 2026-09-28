// Groundwork de Google Drive: GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_DRIVE_FOLDER_ID
// se resuelven vía integracionesConfigService (tabla `parametros`, con la
// variable de entorno como respaldo) — por eso esta suite necesita una base
// de test real. Sin credenciales reales de Google Cloud en este entorno,
// solo se puede probar el camino "no configurado" / "config guardada", sin
// red real (no hay manera de verificar de punta a punta un upload real acá).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const drive = require("../src/services/driveService");
const integracionesConfig = require("../src/services/integracionesConfigService");

const DRIVE_KEYS = ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DRIVE_FOLDER_ID"];

function clearDriveEnv() {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_DRIVE_FOLDER_ID;
}

beforeEach(async () => {
  clearDriveEnv();
  await pool.query("DELETE FROM parametros WHERE clave = ANY($1)", [DRIVE_KEYS]);
});

after(async () => {
  await pool.end();
});

test("isConfigured es false sin nada configurado (ni panel ni variable de entorno)", async () => {
  assert.equal(await drive.isConfigured(), false);
});

test("isConfigured es true con GOOGLE_SERVICE_ACCOUNT_JSON válido por variable de entorno, aunque no haya GOOGLE_DRIVE_FOLDER_ID", async () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"x","private_key":"y"}';
  assert.equal(await drive.isConfigured(), true);
});

test("un GOOGLE_SERVICE_ACCOUNT_JSON con JSON inválido se trata como no configurado", async () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "esto-no-es-json";
  assert.equal(await drive.isConfigured(), false);
});

test("isConfigured es true con la cuenta de servicio guardada desde el panel, sin nada en la variable de entorno", async () => {
  await integracionesConfig.setConfigValue({ clave: "GOOGLE_SERVICE_ACCOUNT_JSON", valor: '{"client_email":"panel@x.iam.gserviceaccount.com","private_key":"y"}' });
  assert.equal(await drive.isConfigured(), true);
});

test("lo guardado desde el panel tiene prioridad sobre la variable de entorno", async () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"env@x.iam.gserviceaccount.com","private_key":"y"}';
  await integracionesConfig.setConfigValue({ clave: "GOOGLE_SERVICE_ACCOUNT_JSON", valor: '{"client_email":"panel@x.iam.gserviceaccount.com","private_key":"y"}' });
  const raw = await integracionesConfig.getConfigValue("GOOGLE_SERVICE_ACCOUNT_JSON");
  assert.equal(JSON.parse(raw).client_email, "panel@x.iam.gserviceaccount.com");
});

test("setConfigValue rechaza un GOOGLE_SERVICE_ACCOUNT_JSON que no es JSON válido", async () => {
  await assert.rejects(
    integracionesConfig.setConfigValue({ clave: "GOOGLE_SERVICE_ACCOUNT_JSON", valor: "esto-no-es-json" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("setConfigValue para GOOGLE_DRIVE_FOLDER_ID acepta un link completo de Drive y guarda solo el ID pelado", async () => {
  await integracionesConfig.setConfigValue({ clave: "GOOGLE_DRIVE_FOLDER_ID", valor: "https://drive.google.com/drive/u/0/folders/1jMJJulbZhJT5RVxhcTJj1gy3pvAntsTZ" });
  const valor = await integracionesConfig.getConfigValue("GOOGLE_DRIVE_FOLDER_ID");
  assert.equal(valor, "1jMJJulbZhJT5RVxhcTJj1gy3pvAntsTZ");
});

test("uploadFile rechaza con DRIVE_NOT_CONFIGURED si falta la cuenta de servicio, sin intentar red", async () => {
  await assert.rejects(
    drive.uploadFile({ buffer: Buffer.from("x"), filename: "a.pdf", mimeType: "application/pdf" }),
    (err) => err.code === "DRIVE_NOT_CONFIGURED"
  );
});

test("uploadFile rechaza con DRIVE_NOT_CONFIGURED si hay cuenta de servicio pero ninguna carpeta (ni por proyecto ni global)", async () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"x","private_key":"y"}';
  await assert.rejects(
    drive.uploadFile({ buffer: Buffer.from("x"), filename: "a.pdf", mimeType: "application/pdf" }),
    (err) => err.code === "DRIVE_NOT_CONFIGURED"
  );
});

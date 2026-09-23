// Tests de integración de settingsService: datos de la empresa (razón
// social, RUC, dirección, teléfono), guardados en `parametros` igual que
// LOGO_URL — no son sensibles, van impresos en los PDF que ya se le
// entregan al cliente.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const settings = require("../src/services/settingsService");

test("getSettings sin configurar devuelve empresa con campos en null", async () => {
  const r = await settings.getSettings();
  assert.equal(r.logo_url, null);
  assert.deepEqual(r.empresa, { razon_social: null, ruc: null, direccion: null, telefono: null });
});

test("setEmpresaInfo guarda los campos y getSettings los refleja", async () => {
  const r = await settings.setEmpresaInfo({
    razonSocial: "Inversiones ICR S.A.C.", ruc: "20605309489", direccion: "Av. Ejemplo 123, Arequipa", telefono: "054-123456",
  });
  assert.equal(r.razon_social, "Inversiones ICR S.A.C.");

  const settingsResult = await settings.getSettings();
  assert.deepEqual(settingsResult.empresa, {
    razon_social: "Inversiones ICR S.A.C.", ruc: "20605309489", direccion: "Av. Ejemplo 123, Arequipa", telefono: "054-123456",
  });
});

test("setEmpresaInfo con un solo campo no borra los demás", async () => {
  await settings.setEmpresaInfo({ telefono: "054-999999" });
  const r = await settings.getSettings();
  assert.equal(r.empresa.razon_social, "Inversiones ICR S.A.C.", "los campos no enviados no deben perderse");
  assert.equal(r.empresa.telefono, "054-999999");
});

after(async () => {
  await pool.end();
});

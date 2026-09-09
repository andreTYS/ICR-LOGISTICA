// Groundwork de Google Drive: sin credenciales reales de Google Cloud en
// este entorno (mismo caso que Telegram/Gemini), así que solo se puede
// probar el camino "no configurado" sin red real — no hay manera de
// verificar de punta a punta un upload real acá.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const drive = require("../src/services/driveService");

function clearDriveEnv() {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_DRIVE_FOLDER_ID;
}

test("isConfigured es false si falta cualquiera de las dos variables", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    clearDriveEnv();
    assert.equal(drive.isConfigured(), false);

    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"x","private_key":"y"}';
    assert.equal(drive.isConfigured(), false, "sin GOOGLE_DRIVE_FOLDER_ID todavía no debe estar configurado");
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID; else process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
  }
});

test("isConfigured es true solo con ambas variables presentes y JSON válido", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"x","private_key":"y"}';
    process.env.GOOGLE_DRIVE_FOLDER_ID = "folder123";
    assert.equal(drive.isConfigured(), true);
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID; else process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
  }
});

test("un GOOGLE_SERVICE_ACCOUNT_JSON con JSON inválido se trata como no configurado", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "esto-no-es-json";
    process.env.GOOGLE_DRIVE_FOLDER_ID = "folder123";
    assert.equal(drive.isConfigured(), false);
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID; else process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
  }
});

test("uploadFile rechaza con DRIVE_NOT_CONFIGURED si Drive no está configurado, sin intentar red", async () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    clearDriveEnv();
    await assert.rejects(
      drive.uploadFile({ buffer: Buffer.from("x"), filename: "a.pdf", mimeType: "application/pdf" }),
      (err) => err.code === "DRIVE_NOT_CONFIGURED"
    );
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID; else process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
  }
});

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

test("isConfigured es false sin GOOGLE_SERVICE_ACCOUNT_JSON", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    clearDriveEnv();
    assert.equal(drive.isConfigured(), false);
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
  }
});

// GOOGLE_DRIVE_FOLDER_ID ya no es obligatoria acá: es solo la carpeta de
// respaldo cuando un proyecto no tiene la suya propia vinculada (ver
// proyectosService.setDriveFolderId) — la resuelve uploadFile, no isConfigured.
test("isConfigured es true con GOOGLE_SERVICE_ACCOUNT_JSON válido, aunque no haya GOOGLE_DRIVE_FOLDER_ID", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"x","private_key":"y"}';
    assert.equal(drive.isConfigured(), true);
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID; else process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
  }
});

test("un GOOGLE_SERVICE_ACCOUNT_JSON con JSON inválido se trata como no configurado", () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "esto-no-es-json";
    assert.equal(drive.isConfigured(), false);
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
  }
});

test("uploadFile rechaza con DRIVE_NOT_CONFIGURED si falta la cuenta de servicio, sin intentar red", async () => {
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

test("uploadFile rechaza con DRIVE_NOT_CONFIGURED si hay cuenta de servicio pero ninguna carpeta (ni por proyecto ni global)", async () => {
  const prevJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const prevFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  try {
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"x","private_key":"y"}';
    await assert.rejects(
      drive.uploadFile({ buffer: Buffer.from("x"), filename: "a.pdf", mimeType: "application/pdf" }),
      (err) => err.code === "DRIVE_NOT_CONFIGURED"
    );
  } finally {
    if (prevJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prevJson;
    if (prevFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID; else process.env.GOOGLE_DRIVE_FOLDER_ID = prevFolder;
  }
});

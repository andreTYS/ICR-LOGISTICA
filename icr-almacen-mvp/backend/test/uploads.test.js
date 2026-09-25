// Test unitario de uploads.js — solo filesystem, sin base de datos (a
// diferencia del resto de la suite, no necesita resetTestDatabase).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const uploads = require("../src/uploads");

test("saveDocumentFile + readUploadedFile hacen un round-trip fiel del contenido", async () => {
  const original = Buffer.from("%PDF-1.4 contenido de prueba");
  const { url } = await uploads.saveDocumentFile({ mimetype: "application/pdf", buffer: original });
  assert.match(url, /^\/uploads\/.+\.pdf$/);

  const leido = await uploads.readUploadedFile(url);
  assert.ok(leido.equals(original));

  await uploads.deleteUploadedFile(url);
});

test("readUploadedFile rechaza una url que no es un archivo local (p. ej. un link de Drive)", async () => {
  await assert.rejects(
    uploads.readUploadedFile("https://drive.google.com/file/d/abc123/view"),
    (err) => err.code === "DOCUMENT_NOT_LOCAL"
  );
});

test("readUploadedFile rechaza un archivo local que ya no existe en disco", async () => {
  await assert.rejects(
    uploads.readUploadedFile("/uploads/no-existe-de-verdad.pdf"),
    (err) => err.code === "DOCUMENT_NOT_FOUND"
  );
});

// Tests de Gestión documental: el servicio solo persiste metadatos de un
// archivo que ya fue guardado en disco por la ruta (uploads.saveDocumentFile)
// — acá se pasa una url ficticia directo, sin pasar por multer/multipart,
// mismo criterio que settings.setLogoUrl() recibe la url ya procesada.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const archivos = require("../src/services/archivosService");
const proyectos = require("../src/services/proyectosService");

const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const PROYECTO_CODIGO = "PROY-001"; // seed.sql

async function proyectoId() {
  const detalle = await proyectos.getProyecto(PROYECTO_CODIGO);
  return detalle.proyecto_id;
}

test("subir un archivo a un proyecto existente funciona", async () => {
  const pid = await proyectoId();
  const r = await archivos.subirArchivo({
    entidadTipo: "proyecto", entidadId: pid, nombre: "Plano eléctrico v1", url: "/uploads/fake-plano.pdf",
    tipoArchivo: "application/pdf", tamanoBytes: 12345, usuarioId: SUPERVISOR, canal: "web",
  });
  assert.equal(r.archivo.nombre, "Plano eléctrico v1");
  assert.equal(r.archivo.entidad_tipo, "proyecto");
});

test("subir un archivo a una entidad inexistente se rechaza", async () => {
  await assert.rejects(
    archivos.subirArchivo({
      entidadTipo: "proyecto", entidadId: "00000000-0000-0000-0000-000000009999", nombre: "X", url: "/uploads/x.pdf",
      usuarioId: SUPERVISOR, canal: "web",
    }),
    (err) => err.code === "ENTITY_NOT_FOUND"
  );
});

test("subir un archivo con un entidadTipo inválido se rechaza", async () => {
  const pid = await proyectoId();
  await assert.rejects(
    archivos.subirArchivo({ entidadTipo: "NO_EXISTE", entidadId: pid, nombre: "X", url: "/uploads/x.pdf", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("listArchivos trae solo los adjuntos de esa entidad, más recientes primero", async () => {
  const pid = await proyectoId();
  await archivos.subirArchivo({ entidadTipo: "proyecto", entidadId: pid, nombre: "Foto de instalación", url: "/uploads/foto.jpg", tipoArchivo: "image/jpeg", usuarioId: SUPERVISOR, canal: "web" });

  const lista = await archivos.listArchivos({ entidadTipo: "proyecto", entidadId: pid });
  assert.ok(lista.length >= 2);
  assert.ok(lista.every((a) => a.entidad_tipo === "proyecto"));
});

test("eliminar un archivo funciona, y eliminar uno inexistente se rechaza", async () => {
  const pid = await proyectoId();
  const { archivo } = await archivos.subirArchivo({ entidadTipo: "proyecto", entidadId: pid, nombre: "Temporal", url: "/uploads/temporal.pdf", tipoArchivo: "application/pdf", usuarioId: SUPERVISOR, canal: "web" });

  await archivos.eliminarArchivo({ archivoId: archivo.archivo_id, usuarioId: SUPERVISOR, canal: "web" });
  const lista = await archivos.listArchivos({ entidadTipo: "proyecto", entidadId: pid });
  assert.ok(!lista.some((a) => a.archivo_id === archivo.archivo_id));

  await assert.rejects(
    archivos.eliminarArchivo({ archivoId: archivo.archivo_id, usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "DOCUMENT_NOT_FOUND"
  );
});

after(async () => {
  await pool.end();
});

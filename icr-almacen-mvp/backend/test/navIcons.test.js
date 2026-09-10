// Personalización de íconos del menú: reemplazar el SVG de un ítem o grupo
// de navegación por una imagen propia, guardando solo la URL ya procesada
// (el procesamiento de la imagen en sí — sharp — lo prueba uploads.js
// indirectamente vía los otros módulos que ya lo usan, acá no se repite).
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const navIcons = require("../src/services/navIconsService");

const ADMIN = "00000000-0000-0000-0000-000000000001"; // seed.sql

test("setNavIcon crea un override y listNavIcons lo devuelve", async () => {
  await navIcons.setNavIcon({ itemKey: "dashboard", imagenUrl: "/uploads/icono-panel.png", usuarioId: ADMIN, canal: "web" });
  const items = await navIcons.listNavIcons();
  const fila = items.find((i) => i.item_key === "dashboard");
  assert.ok(fila);
  assert.equal(fila.imagen_url, "/uploads/icono-panel.png");
});

test("setNavIcon sobre el mismo item_key lo reemplaza (upsert)", async () => {
  await navIcons.setNavIcon({ itemKey: "calendar", imagenUrl: "/uploads/v1.png", usuarioId: ADMIN, canal: "web" });
  await navIcons.setNavIcon({ itemKey: "calendar", imagenUrl: "/uploads/v2.png", usuarioId: ADMIN, canal: "web" });
  const items = await navIcons.listNavIcons();
  const filas = items.filter((i) => i.item_key === "calendar");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].imagen_url, "/uploads/v2.png");
});

test("setNavIcon rechaza sin itemKey o imagenUrl", async () => {
  await assert.rejects(
    navIcons.setNavIcon({ itemKey: "", imagenUrl: "/uploads/x.png", usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
  await assert.rejects(
    navIcons.setNavIcon({ itemKey: "stock", imagenUrl: "", usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("removeNavIcon borra el override", async () => {
  await navIcons.setNavIcon({ itemKey: "group:almacen", imagenUrl: "/uploads/almacen.png", usuarioId: ADMIN, canal: "web" });
  await navIcons.removeNavIcon({ itemKey: "group:almacen", usuarioId: ADMIN, canal: "web" });
  const items = await navIcons.listNavIcons();
  assert.ok(!items.some((i) => i.item_key === "group:almacen"));
});

test("removeNavIcon rechaza un item_key sin override", async () => {
  await assert.rejects(
    navIcons.removeNavIcon({ itemKey: "no-existe", usuarioId: ADMIN, canal: "web" }),
    (err) => err.code === "NAV_ICON_NOT_FOUND"
  );
});

after(async () => {
  await pool.end();
});

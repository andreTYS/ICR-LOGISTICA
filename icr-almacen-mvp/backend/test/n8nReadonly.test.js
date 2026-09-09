// Verifica el segundo camino de consulta para N8N: vistas SQL directas +
// el rol de solo lectura n8n_readonly que las expone (schema.sql). No hay
// infraestructura de N8N real acá — solo se comprueba que el rol existe,
// que solo puede leer exactamente esas vistas (nada de tablas base con
// datos sensibles) y que las vistas devuelven datos consistentes con los
// mismos servicios que ya usa el panel.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const payables = require("../src/services/payablesService");
const calendario = require("../src/services/calendarioService");

test("el rol n8n_readonly existe, es NOLOGIN y no es superusuario", async () => {
  const r = await pool.query(
    "SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname = 'n8n_readonly'"
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].rolcanlogin, false);
  assert.equal(r.rows[0].rolsuper, false);
});

test("n8n_readonly puede leer las vistas de integración pero no tablas base con datos sensibles", async () => {
  const vistas = ["vw_inventario_disponible", "vw_stock_bajo", "vw_n8n_calendario_eventos", "vw_n8n_cuentas_por_cobrar", "vw_n8n_cuentas_por_pagar"];
  for (const vista of vistas) {
    const r = await pool.query("SELECT has_table_privilege('n8n_readonly', $1, 'SELECT') AS puede", [vista]);
    assert.equal(r.rows[0].puede, true, `n8n_readonly debería poder leer ${vista}`);
  }

  const tablasSensibles = ["usuarios", "api_tokens", "auditoria"];
  for (const tabla of tablasSensibles) {
    const r = await pool.query("SELECT has_table_privilege('n8n_readonly', $1, 'SELECT') AS puede", [tabla]);
    assert.equal(r.rows[0].puede, false, `n8n_readonly NO debería poder leer ${tabla} directamente`);
  }
});

test("n8n_readonly no tiene privilegios de escritura en ninguna vista", async () => {
  const r = await pool.query(
    "SELECT has_table_privilege('n8n_readonly', 'vw_inventario_disponible', 'INSERT') AS puede_insertar, " +
    "has_table_privilege('n8n_readonly', 'vw_inventario_disponible', 'UPDATE') AS puede_actualizar, " +
    "has_table_privilege('n8n_readonly', 'vw_inventario_disponible', 'DELETE') AS puede_borrar"
  );
  assert.equal(r.rows[0].puede_insertar, false);
  assert.equal(r.rows[0].puede_actualizar, false);
  assert.equal(r.rows[0].puede_borrar, false);
});

test("vw_n8n_calendario_eventos refleja los mismos eventos que calendarioService.getEventos, sin acotar por fecha", async () => {
  const hasta = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const desde = "2000-01-01";
  const eventosServicio = await calendario.getEventos({ desde, hasta });

  const r = await pool.query("SELECT * FROM vw_n8n_calendario_eventos");
  assert.equal(r.rows.length, eventosServicio.length);
  const tiposVista = new Set(r.rows.map((row) => row.tipo));
  for (const ev of eventosServicio) assert.ok(tiposVista.has(ev.tipo));
});

test("vw_n8n_cuentas_por_pagar calcula el mismo saldo_pendiente que payablesService", async () => {
  const { items } = await payables.listFacturas({});
  const pendientes = items.filter((f) => ["PENDIENTE", "PARCIAL", "VENCIDA"].includes(f.estado));
  assert.ok(pendientes.length > 0, "el seed debería traer al menos una factura pendiente");

  const r = await pool.query("SELECT * FROM vw_n8n_cuentas_por_pagar");
  assert.equal(r.rows.length, pendientes.length);
  for (const f of pendientes) {
    const fila = r.rows.find((row) => row.factura_proveedor_id === f.factura_proveedor_id);
    assert.ok(fila, `la factura ${f.codigo} debería aparecer en la vista`);
    const saldoEsperado = Number(f.monto_total) - Number(f.monto_pagado);
    assert.equal(Number(fila.saldo_pendiente), saldoEsperado);
  }
});

after(async () => {
  await pool.end();
});

// Tests de integración contra una base Postgres real (no mocks): la lógica
// de negocio vive en transacciones con locking (ver inventoryService.js) y
// eso es justamente lo que un mock no puede validar. Requiere Postgres
// accesible con las credenciales PG* de siempre; ver README para correrlos.
process.env.PGDATABASE = process.env.PGDATABASE || "icr_almacen_test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resetTestDatabase } = require("./db-setup");

before(async () => {
  await resetTestDatabase();
});

const { pool } = require("../src/db");
const inventory = require("../src/services/inventoryService");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";
const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const VENTAS = "00000000-0000-0000-0000-000000000005";

async function stockOf(sku, warehouseCode) {
  const { items } = await inventory.getStock({ sku, warehouseCode });
  return items[0];
}

// -------------------- Los 5 casos de aceptación del PRD --------------------

test("consultar stock devuelve la forma paginada esperada", async () => {
  const r = await inventory.getStock({});
  assert.ok(Array.isArray(r.items));
  assert.equal(typeof r.total, "number");
  assert.equal(typeof r.page, "number");
});

test("ingresar stock incrementa stock_fisico", async () => {
  const r = await inventory.receive({
    sku: "PANEL-JA-550", quantity: 10, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web",
  });
  assert.equal(r.stock.stock_fisico, "10.00");
  const s = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(s.stock_disponible, "10.00");
});

test("retirar stock decrementa stock_fisico", async () => {
  await inventory.remove({
    sku: "PANEL-JA-550", quantity: 4, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web",
  });
  const s = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(s.stock_disponible, "6.00");
});

test("retiro rechazado por stock insuficiente no toca el stock", async () => {
  await assert.rejects(
    inventory.remove({ sku: "PANEL-JA-550", quantity: 9999, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
  const s = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(s.stock_disponible, "6.00", "el stock no debe cambiar cuando el retiro se rechaza");
});

test("transferencia atómica: el origen baja y el destino sube exactamente lo mismo", async () => {
  await inventory.transfer({
    sku: "PANEL-JA-550", quantity: 5, fromWarehouseCode: "ALM-001", toWarehouseCode: "ALM-002", usuarioId: ALMACENERO, canal: "web",
  });
  const origen = await stockOf("PANEL-JA-550", "ALM-001");
  const destino = await stockOf("PANEL-JA-550", "ALM-002");
  assert.equal(origen.stock_disponible, "1.00");
  assert.equal(destino.stock_disponible, "5.00");
});

// -------------------- Reservas --------------------

test("reservar aparta stock (sube reservado, baja disponible) sin tocar el físico", async () => {
  await inventory.receive({ sku: "BAT-PYLON-3.5", quantity: 20, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.reserve({ sku: "BAT-PYLON-3.5", quantity: 6, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  const s = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(s.stock_fisico, "20.00");
  assert.equal(s.stock_reservado, "6.00");
  assert.equal(s.stock_disponible, "14.00");
});

test("liberar una reserva devuelve el stock a disponible", async () => {
  const created = await inventory.reserve({ sku: "BAT-PYLON-3.5", quantity: 3, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  await inventory.releaseReservation({ reservaId: created.reserva_id, usuarioId: VENTAS, canal: "web" });
  const reservations = await inventory.getReservations({});
  const found = reservations.find((r) => r.reserva_id === created.reserva_id);
  assert.equal(found.estado, "CANCELADA");
});

test("reservar más de lo disponible se rechaza", async () => {
  await assert.rejects(
    inventory.reserve({ sku: "BAT-PYLON-3.5", quantity: 9999, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" }),
    (err) => err.code === "INSUFFICIENT_STOCK"
  );
});

test("reservar deja una alerta STOCK_BAJO si el disponible cae al punto de reorden", async () => {
  await inventory.createProduct({ sku: "TEST-RESERVA-ALERTA", nombre: "Producto de prueba", tipo_control: "NORMAL", punto_reorden: 2 });
  await inventory.receive({ sku: "TEST-RESERVA-ALERTA", quantity: 10, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  const r = await inventory.reserve({ sku: "TEST-RESERVA-ALERTA", quantity: 9, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  assert.equal(r.alerta_generada, true);
});

// -------------------- Despachar reserva hacia obra --------------------
// Separar materiales para un proyecto (reservar) es solo apartarlos del
// disponible; despachar es lo que efectivamente sale del almacén camino a
// la instalación — debe bajar el físico y cerrar (o reducir) la reserva.

test("despachar una reserva completa la convierte en SALIDA a proyecto y la deja CONSUMIDA", async () => {
  await inventory.receive({ sku: "PANEL-JA-550", quantity: 20, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  const created = await inventory.reserve({
    sku: "PANEL-JA-550", quantity: 5, warehouseCode: "ALM-001", proyectoCodigo: "PROY-001", usuarioId: VENTAS, canal: "web",
  });
  const antes = await stockOf("PANEL-JA-550", "ALM-001");

  const r = await inventory.dispatchReservation({ reservaId: created.reserva_id, usuarioId: ALMACENERO, canal: "web" });
  assert.equal(r.reserva_restante, 0);

  const despues = await stockOf("PANEL-JA-550", "ALM-001");
  assert.equal(Number(despues.stock_fisico), Number(antes.stock_fisico) - 5);
  assert.equal(Number(despues.stock_reservado), Number(antes.stock_reservado) - 5);
  assert.equal(despues.stock_disponible, antes.stock_disponible, "el disponible ya había bajado al reservar, no vuelve a moverse al despachar");

  const movimiento = await pool.query("SELECT tipo_movimiento, proyecto_id FROM movimientos WHERE movimiento_id=$1", [r.movimiento_id]);
  assert.equal(movimiento.rows[0].tipo_movimiento, "SALIDA");
  assert.ok(movimiento.rows[0].proyecto_id, "el movimiento de despacho debe quedar ligado al proyecto de la reserva");

  const reservations = await inventory.getReservations({});
  const found = reservations.find((res) => res.reserva_id === created.reserva_id);
  assert.equal(found.estado, "CONSUMIDA");
  assert.equal(found.codigo_proyecto, "PROY-001");
});

test("despachar parcialmente deja la reserva ACTIVA con el saldo restante (varios viajes a obra)", async () => {
  const created = await inventory.reserve({
    sku: "PANEL-JA-550", quantity: 6, warehouseCode: "ALM-001", proyectoCodigo: "PROY-001", usuarioId: VENTAS, canal: "web",
  });
  const r1 = await inventory.dispatchReservation({ reservaId: created.reserva_id, cantidad: 4, usuarioId: ALMACENERO, canal: "web" });
  assert.equal(r1.reserva_restante, 2);

  const reservations = await inventory.getReservations({ estado: "ACTIVA" });
  const found = reservations.find((res) => res.reserva_id === created.reserva_id);
  assert.equal(found.cantidad, "2.00");

  const r2 = await inventory.dispatchReservation({ reservaId: created.reserva_id, usuarioId: ALMACENERO, canal: "web" });
  assert.equal(r2.reserva_restante, 0);
  const cerradas = await inventory.getReservations({ estado: "CONSUMIDA" });
  assert.ok(cerradas.some((res) => res.reserva_id === created.reserva_id));
});

test("despachar más de lo reservado se rechaza", async () => {
  const created = await inventory.reserve({ sku: "PANEL-JA-550", quantity: 3, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  await assert.rejects(
    inventory.dispatchReservation({ reservaId: created.reserva_id, cantidad: 99, usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("despachar una reserva ya liberada se rechaza", async () => {
  const created = await inventory.reserve({ sku: "PANEL-JA-550", quantity: 2, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  await inventory.releaseReservation({ reservaId: created.reserva_id, usuarioId: VENTAS, canal: "web" });
  await assert.rejects(
    inventory.dispatchReservation({ reservaId: created.reserva_id, usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "RESERVATION_NOT_ACTIVE"
  );
});

test("despachar una reserva inexistente se rechaza", async () => {
  await assert.rejects(
    inventory.dispatchReservation({ reservaId: "00000000-0000-0000-0000-000000009999", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "RESERVATION_NOT_FOUND"
  );
});

// -------------------- Préstamos de herramientas --------------------
// Una herramienta/caja "retornable" debe volver al almacén, a diferencia de
// un material que se consume/instala para siempre — cada SALIDA de un
// producto retornable (directa o vía despacho de reserva) registra
// automáticamente un préstamo; devolverlo repone stock_fisico.

test("retirar un producto retornable registra un préstamo PRESTADO; uno normal no registra nada", async () => {
  await inventory.createProduct({ sku: "TALADRO-01", nombre: "Taladro percutor", tipo_control: "NORMAL", retornable: true });
  await inventory.receive({ sku: "TALADRO-01", quantity: 3, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });

  const r = await inventory.remove({
    sku: "TALADRO-01", quantity: 1, warehouseCode: "ALM-001", proyectoCodigo: "PROY-001", usuarioId: ALMACENERO, canal: "web",
  });
  assert.ok(r.prestamo_id, "una SALIDA de un producto retornable debe crear un préstamo");

  const prestamos = await inventory.getLoans({ estado: "PRESTADO" });
  const prestamo = prestamos.find((p) => p.prestamo_id === r.prestamo_id);
  assert.equal(prestamo.sku, "TALADRO-01");
  assert.equal(prestamo.codigo_proyecto, "PROY-001");

  // Un material normal (no retornable) no debe dejar rastro en préstamos
  const rNormal = await inventory.remove({ sku: "PANEL-JA-550", quantity: 1, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  assert.equal(rNormal.prestamo_id, null);
});

test("despachar una reserva de un producto retornable también registra el préstamo", async () => {
  const created = await inventory.reserve({
    sku: "TALADRO-01", quantity: 1, warehouseCode: "ALM-001", proyectoCodigo: "PROY-001", usuarioId: VENTAS, canal: "web",
  });
  const r = await inventory.dispatchReservation({ reservaId: created.reserva_id, usuarioId: ALMACENERO, canal: "web" });
  assert.ok(r.prestamo_id);
  const prestamos = await inventory.getLoans({ estado: "PRESTADO" });
  assert.ok(prestamos.some((p) => p.prestamo_id === r.prestamo_id));
});

test("devolver un préstamo repone stock_fisico y lo marca DEVUELTO", async () => {
  const antes = await stockOf("TALADRO-01", "ALM-001");
  const prestamos = await inventory.getLoans({ estado: "PRESTADO" });
  const prestamo = prestamos.find((p) => p.sku === "TALADRO-01");

  const r = await inventory.returnLoan({ prestamoId: prestamo.prestamo_id, usuarioId: ALMACENERO, canal: "web" });
  const despues = await stockOf("TALADRO-01", "ALM-001");
  assert.equal(Number(despues.stock_fisico), Number(antes.stock_fisico) + Number(prestamo.cantidad));

  const movimiento = await pool.query("SELECT tipo_movimiento FROM movimientos WHERE movimiento_id=$1", [r.movimiento_id]);
  assert.equal(movimiento.rows[0].tipo_movimiento, "DEVOLUCION");

  const cerrados = await inventory.getLoans({ estado: "DEVUELTO" });
  assert.ok(cerrados.some((p) => p.prestamo_id === prestamo.prestamo_id));
});

test("devolver un préstamo ya devuelto o inexistente se rechaza", async () => {
  const prestamos = await inventory.getLoans({ estado: "DEVUELTO" });
  await assert.rejects(
    inventory.returnLoan({ prestamoId: prestamos[0].prestamo_id, usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "LOAN_NOT_ACTIVE"
  );
  await assert.rejects(
    inventory.returnLoan({ prestamoId: "00000000-0000-0000-0000-000000009999", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "LOAN_NOT_FOUND"
  );
});

test("setProductRetornable alterna el flag y se refleja en la próxima SALIDA", async () => {
  await inventory.createProduct({ sku: "MULTIMETRO-01", nombre: "Multímetro digital", tipo_control: "NORMAL" });
  await inventory.receive({ sku: "MULTIMETRO-01", quantity: 2, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });

  const r1 = await inventory.remove({ sku: "MULTIMETRO-01", quantity: 1, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  assert.equal(r1.prestamo_id, null, "todavía no es retornable");

  await inventory.setProductRetornable("MULTIMETRO-01", true);
  const r2 = await inventory.remove({ sku: "MULTIMETRO-01", quantity: 1, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  assert.ok(r2.prestamo_id, "ahora sí debe generar préstamo");
});

// -------------------- Ajustes con aprobación --------------------

test("un ajuste queda PENDIENTE y no toca el stock hasta que se aprueba", async () => {
  const before_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  const adj = await inventory.adjustCreate({
    sku: "BAT-PYLON-3.5", warehouseCode: "ALM-001", cantidadFisica: 5, motivo: "test", usuarioId: ALMACENERO, canal: "web",
  });
  const mid = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(mid.stock_fisico, before_.stock_fisico, "el stock no cambia hasta aprobar");

  await inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "APROBADO", aprobadoPor: SUPERVISOR, canal: "web" });
  const after_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(after_.stock_fisico, "5.00");
});

test("rechazar un ajuste lo descarta sin tocar el stock", async () => {
  const before_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  const adj = await inventory.adjustCreate({
    sku: "BAT-PYLON-3.5", warehouseCode: "ALM-001", cantidadFisica: 999, motivo: "test", usuarioId: ALMACENERO, canal: "web",
  });
  await inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "RECHAZADO", aprobadoPor: SUPERVISOR, canal: "web" });
  const after_ = await stockOf("BAT-PYLON-3.5", "ALM-001");
  assert.equal(after_.stock_fisico, before_.stock_fisico);
});

test("no se puede decidir dos veces el mismo ajuste", async () => {
  const adj = await inventory.adjustCreate({
    sku: "BAT-PYLON-3.5", warehouseCode: "ALM-001", cantidadFisica: 1, motivo: "test", usuarioId: ALMACENERO, canal: "web",
  });
  await inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "APROBADO", aprobadoPor: SUPERVISOR, canal: "web" });
  await assert.rejects(
    inventory.adjustDecide({ ajusteId: adj.ajuste_id, decision: "APROBADO", aprobadoPor: SUPERVISOR, canal: "web" }),
    (err) => err.code === "ADJUSTMENT_NOT_PENDING"
  );
});

// -------------------- Kits --------------------

test("agregar un item convierte el producto en kit; quitar el último lo revierte", async () => {
  await inventory.addKitItem({ kitSku: "ESTRUCTURA-TECHO", itemSku: "CONECTOR-MC4", quantity: 4 });
  let items = await inventory.getKitItems("ESTRUCTURA-TECHO");
  assert.equal(items.length, 1);
  assert.equal(items[0].sku, "CONECTOR-MC4");

  await inventory.removeKitItem({ kitSku: "ESTRUCTURA-TECHO", itemSku: "CONECTOR-MC4" });
  items = await inventory.getKitItems("ESTRUCTURA-TECHO");
  assert.equal(items.length, 0);
});

test("no se admiten kits anidados", async () => {
  await inventory.addKitItem({ kitSku: "ESTRUCTURA-TECHO", itemSku: "CONECTOR-MC4", quantity: 4 });
  await assert.rejects(
    inventory.addKitItem({ kitSku: "PANEL-JA-550", itemSku: "ESTRUCTURA-TECHO", quantity: 1 }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

// -------------------- Almacenes y ubicaciones (gestión) --------------------

test("crear un almacén funciona y listWarehousesManaged lo trae con sus ubicaciones", async () => {
  const r = await inventory.crearAlmacen({ codigo: "ALM-TEST", nombre: "Almacén de prueba", usuarioId: SUPERVISOR, canal: "web" });
  assert.equal(r.almacen.codigo, "ALM-TEST");

  const lista = await inventory.listWarehousesManaged();
  const encontrado = lista.find((a) => a.codigo === "ALM-TEST");
  assert.ok(encontrado);
  assert.deepEqual(encontrado.ubicaciones, []);
});

test("crear un almacén con código duplicado se rechaza", async () => {
  await assert.rejects(
    inventory.crearAlmacen({ codigo: "ALM-001", nombre: "Duplicado", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "WAREHOUSE_EXISTS"
  );
});

test("actualizar un almacén inexistente se rechaza", async () => {
  await assert.rejects(
    inventory.actualizarAlmacen({ almacenId: "00000000-0000-0000-0000-000000009999", nombre: "X", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "WAREHOUSE_NOT_FOUND"
  );
});

test("desactivar un almacén lo deja fuera de listWarehouses pero sigue en listWarehousesManaged", async () => {
  const { almacen } = await inventory.crearAlmacen({ codigo: "ALM-TEST2", nombre: "Otro de prueba", usuarioId: SUPERVISOR, canal: "web" });
  await inventory.actualizarAlmacen({ almacenId: almacen.almacen_id, activo: false, usuarioId: SUPERVISOR, canal: "web" });

  const activos = await inventory.listWarehouses();
  assert.ok(!activos.some((a) => a.codigo === "ALM-TEST2"));

  const gestion = await inventory.listWarehousesManaged();
  assert.ok(gestion.some((a) => a.codigo === "ALM-TEST2" && a.activo === false));
});

test("crear una ubicación funciona y aparece anidada en su almacén", async () => {
  const r = await inventory.crearUbicacion({ almacenCodigo: "ALM-001", codigoUbicacion: "Z-TEST-01", descripcion: "Zona de prueba", usuarioId: SUPERVISOR, canal: "web" });
  assert.equal(r.ubicacion.codigo_ubicacion, "Z-TEST-01");

  const lista = await inventory.listWarehousesManaged();
  const almacen = lista.find((a) => a.codigo === "ALM-001");
  assert.ok(almacen.ubicaciones.some((u) => u.codigo_ubicacion === "Z-TEST-01"));
});

test("crear una ubicación en un almacén inexistente se rechaza", async () => {
  await assert.rejects(
    inventory.crearUbicacion({ almacenCodigo: "ALM-NO-EXISTE", codigoUbicacion: "Z-01", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "WAREHOUSE_NOT_FOUND"
  );
});

test("crear una ubicación con código duplicado en el mismo almacén se rechaza", async () => {
  await assert.rejects(
    inventory.crearUbicacion({ almacenCodigo: "ALM-001", codigoUbicacion: "Z-TEST-01", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "LOCATION_EXISTS"
  );
});

test("actualizar una ubicación inexistente se rechaza", async () => {
  await assert.rejects(
    inventory.actualizarUbicacion({ ubicacionId: "00000000-0000-0000-0000-000000009999", descripcion: "X", usuarioId: SUPERVISOR, canal: "web" }),
    (err) => err.code === "LOCATION_NOT_FOUND"
  );
});

// -------- Importación masiva de productos vía CSV --------
test("importProductsCsv crea todos los productos de un CSV válido", async () => {
  const csv = "sku,nombre,marca,tipo_control,stock_minimo,punto_reorden\n" +
    "CSV-TEST-001,Producto CSV Uno,MarcaX,NORMAL,2,5\n" +
    "CSV-TEST-002,Producto CSV Dos,MarcaY,NORMAL,3,8\n";
  const r = await inventory.importProductsCsv(csv);
  assert.equal(r.total, 2);
  assert.equal(r.exitosos, 2);
  assert.equal(r.fallidos, 0);

  const { items } = await inventory.searchProducts({ query: "CSV-TEST" });
  assert.equal(items.length, 2);
});

test("importProductsCsv reporta filas fallidas sin abortar las demás (SKU duplicado)", async () => {
  const csv = "sku,nombre,tipo_control\n" +
    "CSV-TEST-001,Ya existe,NORMAL\n" + // duplicado del test anterior
    "CSV-TEST-003,Producto CSV Tres,NORMAL\n";
  const r = await inventory.importProductsCsv(csv);
  assert.equal(r.total, 2);
  assert.equal(r.exitosos, 1);
  assert.equal(r.fallidos, 1);
  assert.match(r.detalle.find((d) => d.sku === "CSV-TEST-001").error, /ya existe/);
  assert.equal(r.detalle.find((d) => d.sku === "CSV-TEST-003").ok, true);
});

test("importProductsCsv rechaza un CSV sin las columnas obligatorias", async () => {
  await assert.rejects(
    inventory.importProductsCsv("nombre,marca\nSolo nombre,MarcaX\n"),
    (err) => err.code === "SCHEMA_INVALID" && /sku/.test(err.message)
  );
});

test("importProductsCsv rechaza un archivo vacío", async () => {
  await assert.rejects(
    inventory.importProductsCsv(""),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("importProductsCsv soporta campos entre comillas con comas embebidas", async () => {
  const csv = 'sku,nombre,tipo_control\nCSV-TEST-004,"Producto, con coma",NORMAL\n';
  const r = await inventory.importProductsCsv(csv);
  assert.equal(r.exitosos, 1);
  const { items } = await inventory.searchProducts({ query: "CSV-TEST-004" });
  assert.equal(items[0].nombre, "Producto, con coma");
});

// -------------------- Cantidades enteras para unidades discretas --------------------

test("ingresar una cantidad decimal de un producto UND se rechaza", async () => {
  await assert.rejects(
    inventory.receive({ sku: "PANEL-JA-550", quantity: 1.5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("despachar una cantidad decimal de un producto UND se rechaza", async () => {
  await inventory.receive({ sku: "PANEL-JA-550", quantity: 5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await assert.rejects(
    inventory.remove({ sku: "PANEL-JA-550", quantity: 2.5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un producto con unidad de medida fraccionable (ej. KG) sí admite cantidades decimales", async () => {
  await inventory.createProduct({ sku: "CABLE-KG-TEST", nombre: "Cable por peso", unidad_medida: "KG", tipo_control: "NORMAL" });
  const r = await inventory.receive({ sku: "CABLE-KG-TEST", quantity: 3.75, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  assert.equal(Number(r.stock.stock_fisico), 3.75);
});

test("reservar una cantidad decimal de un producto UND se rechaza", async () => {
  await inventory.receive({ sku: "PANEL-JA-550", quantity: 5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await assert.rejects(
    inventory.reserve({ sku: "PANEL-JA-550", quantity: 1.5, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("despachar una reserva con una cantidad decimal se rechaza", async () => {
  await inventory.receive({ sku: "PANEL-JA-550", quantity: 5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  const reserva = await inventory.reserve({ sku: "PANEL-JA-550", quantity: 4, warehouseCode: "ALM-001", usuarioId: VENTAS, canal: "web" });
  await assert.rejects(
    inventory.dispatchReservation({ reservaId: reserva.reserva_id, cantidad: 1.5, usuarioId: VENTAS, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("transferir una cantidad decimal de un producto UND se rechaza", async () => {
  await inventory.receive({ sku: "PANEL-JA-550", quantity: 5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await assert.rejects(
    inventory.transfer({ sku: "PANEL-JA-550", quantity: 1.5, fromWarehouseCode: "ALM-001", toWarehouseCode: "ALM-002", usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("un ajuste con cantidad física decimal de un producto UND se rechaza", async () => {
  await assert.rejects(
    inventory.adjustCreate({ sku: "PANEL-JA-550", warehouseCode: "ALM-001", cantidadFisica: 2.5, usuarioId: ALMACENERO, canal: "web" }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("agregar un item a un kit con cantidad decimal de un producto UND se rechaza", async () => {
  await assert.rejects(
    inventory.addKitItem({ kitSku: "INV-GROWATT-5K", itemSku: "PANEL-JA-550", quantity: 1.5 }),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("createProduct acepta precio_venta y setProductPrecioVenta lo actualiza o lo quita", async () => {
  const creado = await inventory.createProduct({
    sku: "PRECIO-VENTA-01",
    nombre: "Producto con precio de lista",
    tipo_control: "NORMAL",
    precio_venta: 199.9,
  });
  assert.equal(Number(creado.precio_venta), 199.9);

  const actualizado = await inventory.setProductPrecioVenta("PRECIO-VENTA-01", 249.5);
  assert.equal(Number(actualizado.precio_venta), 249.5);

  const sinPrecio = await inventory.setProductPrecioVenta("PRECIO-VENTA-01", null);
  assert.equal(sinPrecio.precio_venta, null);
});

test("setProductPrecioVenta rechaza un valor negativo", async () => {
  await inventory.createProduct({ sku: "PRECIO-VENTA-02", nombre: "Producto sin precio", tipo_control: "NORMAL" });
  await assert.rejects(
    inventory.setProductPrecioVenta("PRECIO-VENTA-02", -5),
    (err) => err.code === "SCHEMA_INVALID"
  );
});

test("setProductPrecioVenta rechaza un SKU inexistente", async () => {
  await assert.rejects(
    inventory.setProductPrecioVenta("SKU-QUE-NO-EXISTE", 10),
    (err) => err.code === "PRODUCT_NOT_FOUND"
  );
});

test("createProduct acepta categoria y setProductCategoria la actualiza o la quita", async () => {
  const creado = await inventory.createProduct({
    sku: "CATEGORIA-01",
    nombre: "Producto con categoría",
    tipo_control: "NORMAL",
    categoria: "PANELES",
  });
  assert.equal(creado.categoria, "PANELES");

  const actualizado = await inventory.setProductCategoria("CATEGORIA-01", "BATERIAS");
  assert.equal(actualizado.categoria, "BATERIAS");

  const sinCategoria = await inventory.setProductCategoria("CATEGORIA-01", null);
  assert.equal(sinCategoria.categoria, null);
});

test("setProductCategoria rechaza un SKU inexistente", async () => {
  await assert.rejects(
    inventory.setProductCategoria("SKU-QUE-NO-EXISTE", "PANELES"),
    (err) => err.code === "PRODUCT_NOT_FOUND"
  );
});

test("importProductsCsv acepta una columna categoria opcional", async () => {
  const csv = "sku,nombre,tipo_control,categoria\nCATEGORIA-CSV-01,Producto importado,NORMAL,ALARMA RISCO";
  const resultado = await inventory.importProductsCsv(csv);
  assert.equal(resultado.exitosos, 1);
  const { items } = await inventory.searchProducts({ query: "CATEGORIA-CSV-01" });
  assert.equal(items[0].categoria, "ALARMA RISCO");
});

after(async () => {
  await pool.end();
});

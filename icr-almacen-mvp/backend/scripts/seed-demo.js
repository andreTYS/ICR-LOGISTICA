// Genera un historial de movimientos realista para demos/desarrollo local.
// Usa los mismos comandos de negocio que expone la API (inventoryService),
// así que el stock resultante queda garantizado consistente con el ledger —
// a diferencia de escribir stock/movimientos "a mano" en el seed SQL.
//
// Requiere que db/schema.sql + db/seed.sql ya estén cargados.
// Uso: cd backend && npm run seed:demo

require("dotenv").config();
const { pool } = require("../src/db");
const inventory = require("../src/services/inventoryService");
const compras = require("../src/services/comprasService");
const proyectos = require("../src/services/proyectosService");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const ALMACENERO = "00000000-0000-0000-0000-000000000002";
const SUPERVISOR = "00000000-0000-0000-0000-000000000003";
const COMPRAS = "00000000-0000-0000-0000-000000000004";
const VENTAS = "00000000-0000-0000-0000-000000000005";

async function run() {
  console.log("Generando historial de demo...");

  await inventory.receive({ sku: "PANEL-JA-550", quantity: 60, warehouseCode: "ALM-001", locationCode: "A-01-R01-N01", documento: { tipo_documento: "FACTURA", numero_documento: "F001-2201" }, usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "PANEL-JINKO-450", quantity: 45, warehouseCode: "ALM-001", locationCode: "A-01-R02-N01", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "INV-GROWATT-5K", quantity: 8, warehouseCode: "ALM-001", documento: { tipo_documento: "GUIA", numero_documento: "G-88213" }, usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "INV-HUAWEI-10K", quantity: 6, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "BAT-PYLON-3.5", quantity: 12, warehouseCode: "ALM-002", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "BAT-DEYE-5.1", quantity: 10, warehouseCode: "ALM-002", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "CABLE-SOLAR-6MM", quantity: 1200, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "CONECTOR-MC4", quantity: 300, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "ESTRUCTURA-TECHO", quantity: 15, warehouseCode: "ALM-001", documento: { tipo_documento: "ORDEN_COMPRA", numero_documento: "OC-3390" }, usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "MONITOR-WIFI", quantity: 20, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });

  await inventory.receive({ sku: "HERR-CRIMP-MC4", quantity: 10, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "HERR-EXTRACTOR-MC4", quantity: 10, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "HERR-MULTIMETRO", quantity: 8, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "HERR-TORQUIMETRO", quantity: 6, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "HERR-DESTORNILLADOR", quantity: 9, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "MALETA-MC4", quantity: 6, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.receive({ sku: "MALETA-INSTALACION", quantity: 4, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });

  await inventory.remove({ sku: "PANEL-JA-550", quantity: 18, warehouseCode: "ALM-001", locationCode: "A-01-R01-N01", proyectoCodigo: "PROY-001", clienteRuc: "20512345678", usuarioId: ALMACENERO, canal: "web" });
  await inventory.remove({ sku: "INV-GROWATT-5K", quantity: 3, warehouseCode: "ALM-001", proyectoCodigo: "PROY-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.remove({ sku: "CABLE-SOLAR-6MM", quantity: 350, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.remove({ sku: "CONECTOR-MC4", quantity: 120, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" });
  await inventory.remove({ sku: "PANEL-JINKO-450", quantity: 20, warehouseCode: "ALM-001", locationCode: "A-01-R02-N01", usuarioId: ALMACENERO, canal: "web" });
  await inventory.remove({ sku: "INV-HUAWEI-10K", quantity: 5, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" }); // dispara alerta de stock bajo
  await inventory.remove({ sku: "MONITOR-WIFI", quantity: 16, warehouseCode: "ALM-001", usuarioId: ALMACENERO, canal: "web" }); // dispara alerta de stock bajo

  await inventory.transfer({ sku: "BAT-PYLON-3.5", quantity: 5, fromWarehouseCode: "ALM-002", toWarehouseCode: "ALM-003", toLocationCode: "B-01-R01-N01", usuarioId: ALMACENERO, canal: "web" });
  await inventory.transfer({ sku: "ESTRUCTURA-TECHO", quantity: 5, fromWarehouseCode: "ALM-001", toWarehouseCode: "ALM-003", toLocationCode: "B-01-R01-N01", usuarioId: ALMACENERO, canal: "web" });

  await inventory.reserve({ sku: "PANEL-JA-550", quantity: 10, warehouseCode: "ALM-001", locationCode: "A-01-R01-N01", proyectoCodigo: "PROY-001", usuarioId: VENTAS, canal: "web" });

  await inventory.adjustCreate({ sku: "BAT-DEYE-5.1", warehouseCode: "ALM-002", cantidadFisica: 9, motivo: "Conteo cíclico — diferencia detectada", usuarioId: ALMACENERO, canal: "web" });

  console.log("Armando maletas de herramientas (kits)...");
  await inventory.addKitItem({ kitSku: "MALETA-MC4", itemSku: "HERR-CRIMP-MC4", quantity: 1 });
  await inventory.addKitItem({ kitSku: "MALETA-MC4", itemSku: "HERR-EXTRACTOR-MC4", quantity: 1 });
  await inventory.addKitItem({ kitSku: "MALETA-MC4", itemSku: "CONECTOR-MC4", quantity: 10 });
  await inventory.addKitItem({ kitSku: "MALETA-MC4", itemSku: "CABLE-SOLAR-6MM", quantity: 5 });

  await inventory.addKitItem({ kitSku: "MALETA-INSTALACION", itemSku: "HERR-TORQUIMETRO", quantity: 1 });
  await inventory.addKitItem({ kitSku: "MALETA-INSTALACION", itemSku: "HERR-DESTORNILLADOR", quantity: 1 });
  await inventory.addKitItem({ kitSku: "MALETA-INSTALACION", itemSku: "HERR-MULTIMETRO", quantity: 1 });
  await inventory.addKitItem({ kitSku: "MALETA-INSTALACION", itemSku: "CONECTOR-MC4", quantity: 4 });
  await inventory.addKitItem({ kitSku: "MALETA-INSTALACION", itemSku: "CABLE-SOLAR-6MM", quantity: 10 });

  console.log("Generando órdenes de compra de ejemplo (una por cada estado)...");
  const ocRecibida = await compras.crearOrdenCompra({
    proveedorRuc: "20100047218", warehouseCode: "ALM-001",
    items: [{ sku: "PANEL-JA-550", quantity: 40 }, { sku: "CONECTOR-MC4", quantity: 200 }],
    usuarioId: COMPRAS, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: ocRecibida.numero, usuarioId: COMPRAS, canal: "web" });
  await compras.recibirOrdenCompra({
    numero: ocRecibida.numero, items: [{ sku: "PANEL-JA-550", quantity: 40 }, { sku: "CONECTOR-MC4", quantity: 200 }],
    documento: { tipo_documento: "FACTURA", numero_documento: "F002-5541" }, usuarioId: ALMACENERO, canal: "web",
  });

  const ocParcial = await compras.crearOrdenCompra({
    proveedorRuc: "20605309489", warehouseCode: "ALM-002",
    items: [{ sku: "BAT-DEYE-5.1", quantity: 8 }],
    usuarioId: COMPRAS, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: ocParcial.numero, usuarioId: COMPRAS, canal: "web" });
  await compras.recibirOrdenCompra({
    numero: ocParcial.numero, items: [{ sku: "BAT-DEYE-5.1", quantity: 5 }],
    documento: { tipo_documento: "GUIA", numero_documento: "G-77120" }, usuarioId: ALMACENERO, canal: "web",
  });

  const ocEnviada = await compras.crearOrdenCompra({
    proveedorRuc: "20100047218", warehouseCode: "ALM-001",
    items: [{ sku: "CABLE-SOLAR-6MM", quantity: 600 }],
    usuarioId: COMPRAS, canal: "web",
  });
  await compras.enviarOrdenCompra({ numero: ocEnviada.numero, usuarioId: COMPRAS, canal: "web" });

  await compras.crearOrdenCompra({
    proveedorRuc: "20605309489", warehouseCode: "ALM-001",
    items: [{ sku: "MONITOR-WIFI", quantity: 15 }],
    usuarioId: COMPRAS, canal: "web",
  });

  console.log("Registrando mano de obra del proyecto de ejemplo (PROY-001)...");
  await proyectos.registrarManoObra({
    codigoProyecto: "PROY-001", tecnicoId: ALMACENERO, horas: 24, costoHora: 28,
    descripcion: "Montaje de estructura y paneles", usuarioId: SUPERVISOR, canal: "web",
  });
  await proyectos.registrarManoObra({
    codigoProyecto: "PROY-001", tecnicoId: ALMACENERO, horas: 10, costoHora: 32,
    descripcion: "Cableado e instalación del inversor", usuarioId: SUPERVISOR, canal: "web",
  });

  console.log("Movimientos generados. Redistribuyendo fechas en los últimos 8 días para el gráfico de actividad...");

  // El servicio siempre inserta con created_at = now(); para que la demo no
  // se vea como "todo pasó en el mismo segundo", redistribuimos las fechas
  // en orden de inserción, terminando en el momento actual.
  await pool.query(`
    WITH ranked AS (
      SELECT movimiento_id, row_number() OVER (ORDER BY created_at) AS rn, count(*) OVER () AS total
      FROM movimientos
    )
    UPDATE movimientos m
    SET created_at = now() - ((r.total - r.rn) * interval '8 hours') - (random() * interval '4 hours')
    FROM ranked r WHERE r.movimiento_id = m.movimiento_id
  `);
  await pool.query(`
    UPDATE auditoria a SET created_at = m.created_at
    FROM movimientos m WHERE a.transaction_id = m.transaction_id
  `);

  console.log("Listo. Historial de demo generado correctamente.");
  await pool.end();
}

run().catch((err) => {
  console.error("Error generando datos de demo:", err.message);
  process.exit(1);
});

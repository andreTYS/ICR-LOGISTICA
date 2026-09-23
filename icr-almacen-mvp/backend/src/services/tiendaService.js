const { pool } = require("../db");
const { AppError } = require("../errors");
const {
  withAuditedTransaction, findProductBySku, findWarehouseByCode, lockOrCreateStockRow, requireIntegerIfUnidadDiscreta,
} = require("./inventoryService");
const contabilidad = require("./contabilidadService");

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// Segunda fuente de ingresos, separada de Cotización -> Contrato: una venta
// de mostrador o entrega inmediata, sin cronograma de cobro. Si viene
// sku+warehouseCode, descuenta stock real (mismo criterio que
// inventory.remove, en la misma transacción); si no, es un ítem libre
// (servicio o algo fuera de catálogo) y no toca el inventario.
async function registrarVenta({ sku, warehouseCode, descripcion, cantidad, precioUnitario, clienteRuc, comprobante, usuarioId, canal }) {
  if (!descripcion || !cantidad || cantidad <= 0 || precioUnitario == null || precioUnitario < 0) {
    throw new AppError("SCHEMA_INVALID", "descripcion, cantidad (>0) y precioUnitario (>=0) son obligatorios", 400);
  }
  if (!!sku !== !!warehouseCode) {
    throw new AppError("SCHEMA_INVALID", "sku y warehouseCode van juntos: ambos o ninguno", 400);
  }

  const result = await withAuditedTransaction("store.sale.register", usuarioId, canal, async (client) => {
    let clienteId = null;
    if (clienteRuc) {
      const cr = await client.query("SELECT cliente_id FROM clientes WHERE (ruc=$1 OR dni=$1) AND activo=true", [clienteRuc]);
      if (cr.rows.length === 0) throw new AppError("CLIENT_NOT_FOUND", `Cliente con RUC/DNI '${clienteRuc}' no existe o está inactivo`, 404);
      clienteId = cr.rows[0].cliente_id;
    }

    let productoId = null;
    let almacenId = null;
    let movimientoId = null;
    if (sku) {
      const producto = await findProductBySku(client, sku);
      requireIntegerIfUnidadDiscreta(producto, cantidad);
      const almacen = await findWarehouseByCode(client, warehouseCode);
      const stockRow = await lockOrCreateStockRow(client, producto.producto_id, almacen.almacen_id, null);
      if (Number(stockRow.stock_disponible) < Number(cantidad)) {
        throw new AppError("INSUFFICIENT_STOCK", `Stock disponible insuficiente (disponible: ${stockRow.stock_disponible}, solicitado: ${cantidad})`, 409);
      }
      const movR = await client.query(
        `INSERT INTO movimientos (tipo_movimiento, producto_id, cantidad, almacen_origen_id, cliente_id, usuario_id)
         VALUES ('SALIDA',$1,$2,$3,$4,$5) RETURNING movimiento_id`,
        [producto.producto_id, cantidad, almacen.almacen_id, clienteId, usuarioId]
      );
      await client.query(
        `UPDATE stock SET stock_fisico = stock_fisico - $1, updated_at = now()
         WHERE producto_id=$2 AND almacen_id=$3 AND ubicacion_id IS NULL`,
        [cantidad, producto.producto_id, almacen.almacen_id]
      );
      productoId = producto.producto_id;
      almacenId = almacen.almacen_id;
      movimientoId = movR.rows[0].movimiento_id;
    }

    const numR = await client.query("SELECT 'VT-' || to_char(nextval('venta_tienda_numero_seq'), 'FM00000') AS codigo");
    const codigo = numR.rows[0].codigo;
    const r = await client.query(
      `INSERT INTO ventas_tienda (codigo, cliente_id, producto_id, almacen_id, descripcion, cantidad, precio_unitario,
                                   comprobante_tipo, comprobante_serie_numero, movimiento_id, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [codigo, clienteId, productoId, almacenId, descripcion, cantidad, precioUnitario,
        comprobante?.tipo || null, comprobante?.serie_numero || null, movimientoId, usuarioId]
    );
    return { entidad: "ventas_tienda", entidadId: r.rows[0].venta_tienda_id, valorNuevo: { codigo, cantidad, precioUnitario }, venta: r.rows[0] };
  });

  try {
    await contabilidad.generarAsientoAutomatico({
      evento: "store.sale.registered", monto: Number(result.venta.monto_total),
      glosa: `Venta de tienda ${result.venta.codigo} — ${descripcion}`, origenId: result.venta.venta_tienda_id,
      usuarioId, canal,
    });
  } catch (err) {
    console.error(`No se pudo generar el asiento automático para la venta de tienda '${result.venta.codigo}'`, err);
  }

  return result;
}

async function listVentas({ desde, hasta, page, pageSize } = {}) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (desde) { params.push(desde); conditions.push(`v.fecha_venta >= $${params.length}`); }
  if (hasta) { params.push(hasta); conditions.push(`v.fecha_venta <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT v.*, c.razon_social AS cliente_nombre, p.sku, u.nombre_completo AS registrado_por_nombre,
            COUNT(*) OVER() AS total_count
     FROM ventas_tienda v
     LEFT JOIN clientes c ON c.cliente_id = v.cliente_id
     LEFT JOIN productos p ON p.producto_id = v.producto_id
     JOIN usuarios u ON u.usuario_id = v.registrado_por
     ${where}
     ORDER BY v.fecha_venta DESC, v.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

module.exports = { registrarVenta, listVentas };

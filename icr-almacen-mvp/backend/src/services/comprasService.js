const { pool } = require("../db");
const { AppError } = require("../errors");
const {
  withAuditedTransaction, findProductBySku, findWarehouseByCode, lockOrCreateStockRow, findOrCreateDocumento,
} = require("./inventoryService");

// -------------------- Helpers --------------------

async function findProveedorByRuc(client, ruc) {
  const r = await client.query("SELECT * FROM proveedores WHERE ruc = $1 AND activo = true", [ruc]);
  if (r.rows.length === 0) {
    throw new AppError("SUPPLIER_NOT_FOUND", `Proveedor con RUC '${ruc}' no existe o está inactivo`, 404);
  }
  return r.rows[0];
}

async function findOrdenCompraByNumero(client, numero, { forUpdate = false } = {}) {
  const r = await client.query(
    `SELECT * FROM ordenes_compra WHERE numero = $1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [numero]
  );
  if (r.rows.length === 0) {
    throw new AppError("PURCHASE_ORDER_NOT_FOUND", `Orden de compra '${numero}' no existe`, 404);
  }
  return r.rows[0];
}

function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

// -------------------- Comandos --------------------

async function crearOrdenCompra({ proveedorRuc, warehouseCode, items, fechaEsperada, observaciones, usuarioId, canal }) {
  if (!proveedorRuc || !warehouseCode || !Array.isArray(items) || items.length === 0) {
    throw new AppError("SCHEMA_INVALID", "proveedorRuc, warehouseCode e items (al menos 1) son obligatorios", 400);
  }

  return withAuditedTransaction("purchases.create", usuarioId, canal, async (client) => {
    const proveedor = await findProveedorByRuc(client, proveedorRuc);
    const almacen = await findWarehouseByCode(client, warehouseCode);

    const numR = await client.query("SELECT 'OC-' || to_char(nextval('oc_numero_seq'), 'FM00000') AS numero");
    const numero = numR.rows[0].numero;

    const ocR = await client.query(
      `INSERT INTO ordenes_compra (numero, proveedor_id, almacen_id, fecha_esperada, observaciones, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [numero, proveedor.proveedor_id, almacen.almacen_id, fechaEsperada || null, observaciones || null, usuarioId]
    );
    const oc = ocR.rows[0];

    for (const it of items) {
      if (!it.sku || !it.quantity || it.quantity <= 0) {
        throw new AppError("SCHEMA_INVALID", "cada item requiere sku y quantity (>0)", 400);
      }
      const producto = await findProductBySku(client, it.sku);
      await client.query(
        `INSERT INTO orden_compra_items (orden_compra_id, producto_id, cantidad_pedida, costo_unitario)
         VALUES ($1,$2,$3,$4)`,
        [oc.orden_compra_id, producto.producto_id, it.quantity, it.unitCost ?? producto.costo_unitario ?? 0]
      );
    }

    return {
      entidad: "ordenes_compra", entidadId: oc.orden_compra_id,
      valorNuevo: { numero, proveedorRuc, warehouseCode, items },
      orden_compra: oc, numero,
    };
  });
}

async function enviarOrdenCompra({ numero, usuarioId, canal }) {
  return withAuditedTransaction("purchases.send", usuarioId, canal, async (client) => {
    const oc = await findOrdenCompraByNumero(client, numero, { forUpdate: true });
    if (oc.estado !== "BORRADOR") {
      throw new AppError("PURCHASE_ORDER_NOT_DRAFT", `La orden '${numero}' ya no está en BORRADOR (estado actual: ${oc.estado})`, 400);
    }
    const r = await client.query(
      "UPDATE ordenes_compra SET estado = 'ENVIADA', updated_at = now() WHERE orden_compra_id = $1 RETURNING *",
      [oc.orden_compra_id]
    );
    return { entidad: "ordenes_compra", entidadId: oc.orden_compra_id, valorNuevo: { estado: "ENVIADA" }, orden_compra: r.rows[0] };
  });
}

async function cancelarOrdenCompra({ numero, usuarioId, canal }) {
  return withAuditedTransaction("purchases.cancel", usuarioId, canal, async (client) => {
    const oc = await findOrdenCompraByNumero(client, numero, { forUpdate: true });
    if (oc.estado === "RECIBIDA" || oc.estado === "CANCELADA") {
      throw new AppError("PURCHASE_ORDER_NOT_CANCELLABLE", `La orden '${numero}' no se puede cancelar (estado actual: ${oc.estado})`, 400);
    }
    const r = await client.query(
      "UPDATE ordenes_compra SET estado = 'CANCELADA', updated_at = now() WHERE orden_compra_id = $1 RETURNING *",
      [oc.orden_compra_id]
    );
    return { entidad: "ordenes_compra", entidadId: oc.orden_compra_id, valorNuevo: { estado: "CANCELADA" }, orden_compra: r.rows[0] };
  });
}

// Registra una recepción (total o parcial) de una o más líneas de la orden.
// Cada línea recibida actualiza cantidad_recibida, genera el movimiento de
// INGRESO correspondiente y actualiza el stock — exactamente igual que
// inventory.receive, pero dentro de la misma transacción que el resto del
// flujo de compras. No se admite recibir más de lo pedido por línea.
async function recibirOrdenCompra({ numero, items, documento, usuarioId, canal }) {
  if (!numero || !Array.isArray(items) || items.length === 0) {
    throw new AppError("SCHEMA_INVALID", "numero e items (al menos 1) son obligatorios", 400);
  }

  return withAuditedTransaction("purchases.receive", usuarioId, canal, async (client) => {
    const oc = await findOrdenCompraByNumero(client, numero, { forUpdate: true });
    if (oc.estado === "BORRADOR") {
      throw new AppError("PURCHASE_ORDER_NOT_SENT", `La orden '${numero}' todavía no fue enviada al proveedor`, 400);
    }
    if (oc.estado === "RECIBIDA" || oc.estado === "CANCELADA") {
      throw new AppError("PURCHASE_ORDER_NOT_RECEIVABLE", `La orden '${numero}' no admite recepciones (estado actual: ${oc.estado})`, 400);
    }

    const documentoId = await findOrCreateDocumento(client, documento ? { ...documento, proveedor_id: oc.proveedor_id } : null);

    const recepcionR = await client.query(
      `INSERT INTO recepciones (orden_compra_id, documento_id, usuario_id) VALUES ($1,$2,$3) RETURNING recepcion_id`,
      [oc.orden_compra_id, documentoId, usuarioId]
    );
    const recepcionId = recepcionR.rows[0].recepcion_id;

    for (const it of items) {
      if (!it.sku || !it.quantity || it.quantity <= 0) {
        throw new AppError("SCHEMA_INVALID", "cada item requiere sku y quantity (>0)", 400);
      }
      const producto = await findProductBySku(client, it.sku);

      const itemR = await client.query(
        `SELECT * FROM orden_compra_items WHERE orden_compra_id = $1 AND producto_id = $2 FOR UPDATE`,
        [oc.orden_compra_id, producto.producto_id]
      );
      if (itemR.rows.length === 0) {
        throw new AppError("PURCHASE_ITEM_NOT_FOUND", `El SKU '${it.sku}' no forma parte de la orden '${numero}'`, 404);
      }
      const item = itemR.rows[0];
      const pendiente = Number(item.cantidad_pedida) - Number(item.cantidad_recibida);
      if (it.quantity > pendiente) {
        throw new AppError(
          "OVER_RECEIPT",
          `No se puede recibir ${it.quantity} de '${it.sku}': solo quedan ${pendiente} pendientes en la orden '${numero}'`,
          400
        );
      }

      await client.query(
        "UPDATE orden_compra_items SET cantidad_recibida = cantidad_recibida + $1 WHERE orden_compra_item_id = $2",
        [it.quantity, item.orden_compra_item_id]
      );
      await client.query(
        "INSERT INTO recepcion_items (recepcion_id, orden_compra_item_id, cantidad) VALUES ($1,$2,$3)",
        [recepcionId, item.orden_compra_item_id, it.quantity]
      );

      // Mismo efecto que inventory.receive: bloquea/crea la fila de stock,
      // registra el movimiento de INGRESO y suma al stock físico.
      await lockOrCreateStockRow(client, producto.producto_id, oc.almacen_id, null);
      await client.query(
        `INSERT INTO movimientos (tipo_movimiento, producto_id, cantidad, almacen_destino_id, documento_id, proveedor_id, usuario_id)
         VALUES ('INGRESO',$1,$2,$3,$4,$5,$6)`,
        [producto.producto_id, it.quantity, oc.almacen_id, documentoId, oc.proveedor_id, usuarioId]
      );
      await client.query(
        `UPDATE stock SET stock_fisico = stock_fisico + $1, updated_at = now()
         WHERE producto_id = $2 AND almacen_id = $3 AND ubicacion_id IS NULL`,
        [it.quantity, producto.producto_id, oc.almacen_id]
      );
    }

    const totales = await client.query(
      "SELECT COALESCE(SUM(cantidad_pedida),0) AS pedida, COALESCE(SUM(cantidad_recibida),0) AS recibida FROM orden_compra_items WHERE orden_compra_id = $1",
      [oc.orden_compra_id]
    );
    const nuevoEstado = Number(totales.rows[0].recibida) >= Number(totales.rows[0].pedida) ? "RECIBIDA" : "PARCIAL";
    const ocR = await client.query(
      "UPDATE ordenes_compra SET estado = $1, updated_at = now() WHERE orden_compra_id = $2 RETURNING *",
      [nuevoEstado, oc.orden_compra_id]
    );

    return {
      entidad: "ordenes_compra", entidadId: oc.orden_compra_id,
      valorNuevo: { numero, items, estado: nuevoEstado },
      orden_compra: ocR.rows[0], recepcion_id: recepcionId,
    };
  });
}

// -------------------- Consultas --------------------

async function listProveedores() {
  const r = await pool.query("SELECT ruc, razon_social FROM proveedores WHERE activo = true ORDER BY razon_social");
  return r.rows;
}

async function getOrdenesCompra({ estado, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 200);
  const conditions = [];
  const params = [];
  if (estado) { params.push(estado); conditions.push(`oc.estado = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT oc.*, prov.razon_social AS proveedor_nombre, prov.ruc AS proveedor_ruc,
            a.codigo AS almacen_codigo, a.nombre AS almacen_nombre,
            COUNT(*) OVER() AS total_count
     FROM ordenes_compra oc
     JOIN proveedores prov ON prov.proveedor_id = oc.proveedor_id
     JOIN almacenes a ON a.almacen_id = oc.almacen_id
     ${where}
     ORDER BY oc.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function getOrdenCompra(numero) {
  const ocR = await pool.query(
    `SELECT oc.*, prov.razon_social AS proveedor_nombre, prov.ruc AS proveedor_ruc,
            a.codigo AS almacen_codigo, a.nombre AS almacen_nombre
     FROM ordenes_compra oc
     JOIN proveedores prov ON prov.proveedor_id = oc.proveedor_id
     JOIN almacenes a ON a.almacen_id = oc.almacen_id
     WHERE oc.numero = $1`,
    [numero]
  );
  if (ocR.rows.length === 0) throw new AppError("PURCHASE_ORDER_NOT_FOUND", `Orden de compra '${numero}' no existe`, 404);
  const oc = ocR.rows[0];

  const itemsR = await pool.query(
    `SELECT oci.*, p.sku, p.nombre AS producto_nombre,
            (oci.cantidad_pedida - oci.cantidad_recibida) AS cantidad_pendiente
     FROM orden_compra_items oci
     JOIN productos p ON p.producto_id = oci.producto_id
     WHERE oci.orden_compra_id = $1
     ORDER BY p.nombre`,
    [oc.orden_compra_id]
  );

  const recepcionesR = await pool.query(
    `SELECT r.recepcion_id, r.created_at, r.usuario_id, u.nombre_completo AS usuario_nombre,
            d.tipo_documento, d.numero_documento,
            json_agg(json_build_object('sku', p.sku, 'nombre', p.nombre, 'cantidad', ri.cantidad) ORDER BY p.nombre) AS items
     FROM recepciones r
     JOIN usuarios u ON u.usuario_id = r.usuario_id
     LEFT JOIN documentos d ON d.documento_id = r.documento_id
     JOIN recepcion_items ri ON ri.recepcion_id = r.recepcion_id
     JOIN orden_compra_items oci ON oci.orden_compra_item_id = ri.orden_compra_item_id
     JOIN productos p ON p.producto_id = oci.producto_id
     WHERE r.orden_compra_id = $1
     GROUP BY r.recepcion_id, r.created_at, r.usuario_id, u.nombre_completo, d.tipo_documento, d.numero_documento
     ORDER BY r.created_at DESC`,
    [oc.orden_compra_id]
  );

  return { ...oc, items: itemsR.rows, recepciones: recepcionesR.rows };
}

// Productos cuyo stock disponible ya cayó al punto de reorden o por debajo,
// con una cantidad sugerida a comprar (hasta completar stock_maximo cuando
// está definido; si no, el doble del punto de reorden).
async function getSugerenciasReabastecimiento() {
  const r = await pool.query(
    `SELECT sku, producto_nombre, almacen_codigo, almacen_nombre,
            stock_disponible, punto_reorden, stock_maximo,
            GREATEST(COALESCE(stock_maximo, punto_reorden * 2) - stock_disponible, 0) AS cantidad_sugerida
     FROM vw_stock_bajo
     ORDER BY producto_nombre`
  );
  return r.rows;
}

module.exports = {
  crearOrdenCompra, enviarOrdenCompra, cancelarOrdenCompra, recibirOrdenCompra,
  getOrdenesCompra, getOrdenCompra, getSugerenciasReabastecimiento, listProveedores,
};

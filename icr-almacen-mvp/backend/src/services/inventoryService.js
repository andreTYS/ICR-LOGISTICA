const { pool } = require("../db");
const { AppError } = require("../errors");

// -------------------- Helpers --------------------

async function findProductBySku(client, sku) {
  const r = await client.query("SELECT * FROM productos WHERE sku = $1 AND activo = true", [sku]);
  if (r.rows.length === 0) {
    throw new AppError("PRODUCT_NOT_FOUND", `Producto con SKU '${sku}' no existe o está inactivo`, 404);
  }
  return r.rows[0];
}

async function findWarehouseByCode(client, code) {
  const r = await client.query("SELECT * FROM almacenes WHERE codigo = $1 AND activo = true", [code]);
  if (r.rows.length === 0) {
    throw new AppError("WAREHOUSE_NOT_FOUND", `Almacén '${code}' no existe o está inactivo`, 404);
  }
  return r.rows[0];
}

async function findLocation(client, almacenId, codigoUbicacion) {
  if (!codigoUbicacion) return null;
  const r = await client.query(
    "SELECT * FROM ubicaciones WHERE almacen_id = $1 AND codigo_ubicacion = $2 AND activo = true",
    [almacenId, codigoUbicacion]
  );
  if (r.rows.length === 0) {
    throw new AppError("LOCATION_NOT_FOUND", `Ubicación '${codigoUbicacion}' no existe en ese almacén`, 404);
  }
  return r.rows[0];
}

// Bloquea (o crea si no existe) la fila de stock para producto+almacen+ubicacion, y la retorna con lock FOR UPDATE
async function lockOrCreateStockRow(client, productoId, almacenId, ubicacionId) {
  let r = await client.query(
    `SELECT * FROM stock WHERE producto_id = $1 AND almacen_id = $2
       AND ubicacion_id IS NOT DISTINCT FROM $3
     FOR UPDATE`,
    [productoId, almacenId, ubicacionId]
  );
  if (r.rows.length === 0) {
    r = await client.query(
      `INSERT INTO stock (producto_id, almacen_id, ubicacion_id, stock_fisico, stock_reservado)
       VALUES ($1, $2, $3, 0, 0) RETURNING *`,
      [productoId, almacenId, ubicacionId]
    );
  }
  return r.rows[0];
}

async function insertAuditoria(client, { usuarioId, canal, accion, entidad, entidadId, resultado, error, transactionId, valorNuevo }) {
  await client.query(
    `INSERT INTO auditoria (usuario_id, canal, accion, entidad, entidad_id, resultado, error, transaction_id, valor_nuevo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [usuarioId, canal || "web", accion, entidad || null, entidadId || null, resultado, error || null, transactionId || null, valorNuevo ? JSON.stringify(valorNuevo) : null]
  );
}

async function withAuditedTransaction(action, usuarioId, canal, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await insertAuditoria(client, {
      usuarioId, canal, accion: action,
      entidad: result?.entidad, entidadId: result?.entidadId,
      resultado: "success", transactionId: result?.transactionId, valorNuevo: result?.valorNuevo,
    });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    // Auditar el error en una transacción nueva (la anterior se revirtió)
    try {
      const auditClient = await pool.connect();
      await insertAuditoria(auditClient, {
        usuarioId, canal, accion: action,
        resultado: "error", error: err.code ? `${err.code}: ${err.message}` : err.message,
      });
      auditClient.release();
    } catch (auditErr) {
      console.error("No se pudo registrar auditoría de error", auditErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

// -------------------- Comandos --------------------

async function receive({ sku, quantity, warehouseCode, locationCode, documento, usuarioId, canal }) {
  if (!sku || !quantity || quantity <= 0 || !warehouseCode) {
    throw new AppError("SCHEMA_INVALID", "sku, quantity (>0) y warehouseCode son obligatorios", 400);
  }

  return withAuditedTransaction("inventory.receive", usuarioId, canal, async (client) => {
    const producto = await findProductBySku(client, sku);
    const almacen = await findWarehouseByCode(client, warehouseCode);
    const ubicacion = await findLocation(client, almacen.almacen_id, locationCode);

    let documentoId = null;
    if (documento?.tipo_documento && documento?.numero_documento) {
      const existing = await client.query(
        "SELECT documento_id FROM documentos WHERE tipo_documento=$1 AND numero_documento=$2",
        [documento.tipo_documento, documento.numero_documento]
      );
      if (existing.rows.length > 0) {
        documentoId = existing.rows[0].documento_id;
      } else {
        const docR = await client.query(
          `INSERT INTO documentos (tipo_documento, numero_documento, proveedor_id)
           VALUES ($1,$2,$3) RETURNING documento_id`,
          [documento.tipo_documento, documento.numero_documento, documento.proveedor_id || null]
        );
        documentoId = docR.rows[0].documento_id;
      }
    }

    await lockOrCreateStockRow(client, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null);

    const movR = await client.query(
      `INSERT INTO movimientos (tipo_movimiento, producto_id, cantidad, almacen_destino_id, ubicacion_destino_id, documento_id, usuario_id)
       VALUES ('INGRESO',$1,$2,$3,$4,$5,$6) RETURNING movimiento_id, transaction_id`,
      [producto.producto_id, quantity, almacen.almacen_id, ubicacion?.ubicacion_id || null, documentoId, usuarioId]
    );

    const stockR = await client.query(
      `UPDATE stock SET stock_fisico = stock_fisico + $1, updated_at = now()
       WHERE producto_id = $2 AND almacen_id = $3 AND ubicacion_id IS NOT DISTINCT FROM $4
       RETURNING stock_fisico, stock_disponible`,
      [quantity, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null]
    );

    return {
      entidad: "movimientos",
      entidadId: movR.rows[0].movimiento_id,
      transactionId: movR.rows[0].transaction_id,
      valorNuevo: { sku, quantity, warehouseCode },
      movimiento_id: movR.rows[0].movimiento_id,
      stock: stockR.rows[0],
    };
  });
}

async function remove({ sku, quantity, warehouseCode, locationCode, proyectoCodigo, clienteRuc, documento, usuarioId, canal }) {
  if (!sku || !quantity || quantity <= 0 || !warehouseCode) {
    throw new AppError("SCHEMA_INVALID", "sku, quantity (>0) y warehouseCode son obligatorios", 400);
  }

  return withAuditedTransaction("inventory.remove", usuarioId, canal, async (client) => {
    const producto = await findProductBySku(client, sku);
    const almacen = await findWarehouseByCode(client, warehouseCode);
    const ubicacion = await findLocation(client, almacen.almacen_id, locationCode);

    let proyectoId = null;
    if (proyectoCodigo) {
      const pr = await client.query("SELECT proyecto_id FROM proyectos WHERE codigo_proyecto=$1", [proyectoCodigo]);
      if (pr.rows.length === 0) throw new AppError("PROJECT_OR_CLIENT_INVALID", `Proyecto '${proyectoCodigo}' no existe`, 404);
      proyectoId = pr.rows[0].proyecto_id;
    }
    let clienteId = null;
    if (clienteRuc) {
      const cr = await client.query("SELECT cliente_id FROM clientes WHERE ruc=$1", [clienteRuc]);
      if (cr.rows.length === 0) throw new AppError("PROJECT_OR_CLIENT_INVALID", `Cliente RUC '${clienteRuc}' no existe`, 404);
      clienteId = cr.rows[0].cliente_id;
    }

    let documentoId = null;
    if (documento?.tipo_documento && documento?.numero_documento) {
      const docR = await client.query(
        `INSERT INTO documentos (tipo_documento, numero_documento, cliente_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (tipo_documento, numero_documento) DO UPDATE SET tipo_documento = EXCLUDED.tipo_documento
         RETURNING documento_id`,
        [documento.tipo_documento, documento.numero_documento, clienteId]
      );
      documentoId = docR.rows[0].documento_id;
    }

    const stockRow = await lockOrCreateStockRow(client, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null);

    const paramR = await client.query("SELECT valor FROM parametros WHERE clave = 'STOCK_NEGATIVO_PERMITIDO'");
    const negativoPermitido = paramR.rows[0]?.valor === "true";

    if (Number(stockRow.stock_disponible) < Number(quantity) && !negativoPermitido) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `Stock disponible insuficiente (disponible: ${stockRow.stock_disponible}, solicitado: ${quantity})`,
        409
      );
    }

    const movR = await client.query(
      `INSERT INTO movimientos (tipo_movimiento, producto_id, cantidad, almacen_origen_id, ubicacion_origen_id, proyecto_id, cliente_id, documento_id, usuario_id)
       VALUES ('SALIDA',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING movimiento_id, transaction_id`,
      [producto.producto_id, quantity, almacen.almacen_id, ubicacion?.ubicacion_id || null, proyectoId, clienteId, documentoId, usuarioId]
    );

    const stockR = await client.query(
      `UPDATE stock SET stock_fisico = stock_fisico - $1, updated_at = now()
       WHERE producto_id = $2 AND almacen_id = $3 AND ubicacion_id IS NOT DISTINCT FROM $4
       RETURNING stock_fisico, stock_disponible`,
      [quantity, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null]
    );

    let alertaGenerada = false;
    if (Number(stockR.rows[0].stock_disponible) <= Number(producto.punto_reorden)) {
      const existingAlert = await client.query(
        `SELECT alerta_id FROM alertas WHERE producto_id=$1 AND almacen_id=$2 AND estado != 'RESUELTA'`,
        [producto.producto_id, almacen.almacen_id]
      );
      if (existingAlert.rows.length === 0) {
        await client.query(
          `INSERT INTO alertas (producto_id, almacen_id, tipo_alerta, nivel_actual, nivel_minimo, prioridad)
           VALUES ($1,$2,'STOCK_BAJO',$3,$4,'MEDIA')`,
          [producto.producto_id, almacen.almacen_id, stockR.rows[0].stock_disponible, producto.punto_reorden]
        );
        alertaGenerada = true;
      }
    }

    return {
      entidad: "movimientos",
      entidadId: movR.rows[0].movimiento_id,
      transactionId: movR.rows[0].transaction_id,
      valorNuevo: { sku, quantity, warehouseCode },
      movimiento_id: movR.rows[0].movimiento_id,
      stock: stockR.rows[0],
      alerta_generada: alertaGenerada,
    };
  });
}

async function transfer({ sku, quantity, fromWarehouseCode, fromLocationCode, toWarehouseCode, toLocationCode, usuarioId, canal }) {
  if (!sku || !quantity || quantity <= 0 || !fromWarehouseCode || !toWarehouseCode) {
    throw new AppError("SCHEMA_INVALID", "sku, quantity (>0), fromWarehouseCode y toWarehouseCode son obligatorios", 400);
  }

  return withAuditedTransaction("inventory.transfer", usuarioId, canal, async (client) => {
    const producto = await findProductBySku(client, sku);
    const almacenOrigen = await findWarehouseByCode(client, fromWarehouseCode);
    const almacenDestino = await findWarehouseByCode(client, toWarehouseCode);
    const ubicacionOrigen = await findLocation(client, almacenOrigen.almacen_id, fromLocationCode);
    const ubicacionDestino = await findLocation(client, almacenDestino.almacen_id, toLocationCode);

    // Orden determinístico de locking (por almacen_id) para evitar deadlocks entre transferencias cruzadas
    let stockOrigen, stockDestino;
    if (almacenOrigen.almacen_id < almacenDestino.almacen_id) {
      stockOrigen = await lockOrCreateStockRow(client, producto.producto_id, almacenOrigen.almacen_id, ubicacionOrigen?.ubicacion_id || null);
      stockDestino = await lockOrCreateStockRow(client, producto.producto_id, almacenDestino.almacen_id, ubicacionDestino?.ubicacion_id || null);
    } else {
      stockDestino = await lockOrCreateStockRow(client, producto.producto_id, almacenDestino.almacen_id, ubicacionDestino?.ubicacion_id || null);
      stockOrigen = await lockOrCreateStockRow(client, producto.producto_id, almacenOrigen.almacen_id, ubicacionOrigen?.ubicacion_id || null);
    }

    if (Number(stockOrigen.stock_disponible) < Number(quantity)) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `Stock disponible insuficiente en origen (disponible: ${stockOrigen.stock_disponible}, solicitado: ${quantity})`,
        409
      );
    }

    const movR = await client.query(
      `INSERT INTO movimientos (tipo_movimiento, producto_id, cantidad, almacen_origen_id, ubicacion_origen_id, almacen_destino_id, ubicacion_destino_id, usuario_id)
       VALUES ('TRANSFERENCIA',$1,$2,$3,$4,$5,$6,$7) RETURNING movimiento_id, transaction_id`,
      [producto.producto_id, quantity, almacenOrigen.almacen_id, ubicacionOrigen?.ubicacion_id || null, almacenDestino.almacen_id, ubicacionDestino?.ubicacion_id || null, usuarioId]
    );

    const origenR = await client.query(
      `UPDATE stock SET stock_fisico = stock_fisico - $1, updated_at = now()
       WHERE producto_id=$2 AND almacen_id=$3 AND ubicacion_id IS NOT DISTINCT FROM $4
       RETURNING stock_fisico, stock_disponible`,
      [quantity, producto.producto_id, almacenOrigen.almacen_id, ubicacionOrigen?.ubicacion_id || null]
    );
    const destinoR = await client.query(
      `UPDATE stock SET stock_fisico = stock_fisico + $1, updated_at = now()
       WHERE producto_id=$2 AND almacen_id=$3 AND ubicacion_id IS NOT DISTINCT FROM $4
       RETURNING stock_fisico, stock_disponible`,
      [quantity, producto.producto_id, almacenDestino.almacen_id, ubicacionDestino?.ubicacion_id || null]
    );

    return {
      entidad: "movimientos",
      entidadId: movR.rows[0].movimiento_id,
      transactionId: movR.rows[0].transaction_id,
      valorNuevo: { sku, quantity, fromWarehouseCode, toWarehouseCode },
      movimiento_id: movR.rows[0].movimiento_id,
      stock_origen: origenR.rows[0],
      stock_destino: destinoR.rows[0],
    };
  });
}

// -------------------- Consultas (sin transacción de escritura) --------------------

async function getStock({ sku, warehouseCode }) {
  const conditions = [];
  const params = [];
  if (sku) { params.push(sku); conditions.push(`sku = $${params.length}`); }
  if (warehouseCode) { params.push(warehouseCode); conditions.push(`almacen_codigo = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const r = await pool.query(`SELECT * FROM vw_inventario_disponible ${where} ORDER BY producto_nombre`, params);
  return r.rows;
}

async function searchProducts({ query }) {
  const r = await pool.query(
    `SELECT * FROM productos WHERE activo = true AND (sku ILIKE $1 OR nombre ILIKE $1) ORDER BY nombre LIMIT 50`,
    [`%${query || ""}%`]
  );
  return r.rows;
}

async function createProduct(data) {
  const { sku, nombre, marca, modelo, unidad_medida, tipo_control, stock_minimo, punto_reorden, stock_maximo, costo_unitario } = data;
  if (!sku || !nombre || !tipo_control) {
    throw new AppError("SCHEMA_INVALID", "sku, nombre y tipo_control son obligatorios", 400);
  }
  const r = await pool.query(
    `INSERT INTO productos (sku, nombre, marca, modelo, unidad_medida, tipo_control, stock_minimo, punto_reorden, stock_maximo, costo_unitario)
     VALUES ($1,$2,$3,$4,COALESCE($5,'UND'),$6,COALESCE($7,0),COALESCE($8,0),$9,$10) RETURNING *`,
    [sku, nombre, marca || null, modelo || null, unidad_medida, tipo_control, stock_minimo, punto_reorden, stock_maximo || null, costo_unitario || 0]
  );
  return r.rows[0];
}

async function getMovements({ sku, limit = 50 }) {
  const params = [];
  let where = "";
  if (sku) {
    params.push(sku);
    where = "WHERE p.sku = $1";
  }
  params.push(limit);
  const r = await pool.query(
    `SELECT m.*, p.sku, p.nombre AS producto_nombre,
            ao.codigo AS almacen_origen_codigo, ad.codigo AS almacen_destino_codigo
     FROM movimientos m
     JOIN productos p ON p.producto_id = m.producto_id
     LEFT JOIN almacenes ao ON ao.almacen_id = m.almacen_origen_id
     LEFT JOIN almacenes ad ON ad.almacen_id = m.almacen_destino_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

async function getAlerts({ estado }) {
  const params = [];
  let where = "";
  if (estado) {
    params.push(estado);
    where = "WHERE al.estado = $1";
  }
  const r = await pool.query(
    `SELECT al.*, p.sku, p.nombre AS producto_nombre, a.codigo AS almacen_codigo
     FROM alertas al
     JOIN productos p ON p.producto_id = al.producto_id
     JOIN almacenes a ON a.almacen_id = al.almacen_id
     ${where}
     ORDER BY al.created_at DESC`,
    params
  );
  return r.rows;
}

async function listWarehouses() {
  const r = await pool.query("SELECT * FROM almacenes WHERE activo = true ORDER BY codigo");
  return r.rows;
}

module.exports = {
  receive, remove, transfer,
  getStock, searchProducts, createProduct, getMovements, getAlerts, listWarehouses,
};

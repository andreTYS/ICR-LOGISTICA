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

// Normaliza page/pageSize y calcula el OFFSET; pageSize tiene un tope duro
// para que nadie pueda pedir toda la tabla de un tirón por accidente.
function paginationParams(page, pageSize, defaultSize, maxSize) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(pageSize) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

async function getStock({ sku, warehouseCode, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 500);
  const conditions = [];
  const params = [];
  if (sku) { params.push(`%${sku}%`); conditions.push(`(sku ILIKE $${params.length} OR producto_nombre ILIKE $${params.length})`); }
  if (warehouseCode) { params.push(warehouseCode); conditions.push(`almacen_codigo = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(size, offset);
  const r = await pool.query(
    `SELECT *, COUNT(*) OVER() AS total_count FROM vw_inventario_disponible ${where}
     ORDER BY producto_nombre LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
}

async function searchProducts({ query, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 20, 500);
  const r = await pool.query(
    `SELECT *, COUNT(*) OVER() AS total_count FROM productos
     WHERE activo = true AND (sku ILIKE $1 OR nombre ILIKE $1)
     ORDER BY nombre LIMIT $2 OFFSET $3`,
    [`%${query || ""}%`, size, offset]
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
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

async function setProductPhoto(sku, imagenUrl) {
  const r = await pool.query(
    "UPDATE productos SET imagen_url = $1 WHERE sku = $2 AND activo = true RETURNING *",
    [imagenUrl, sku]
  );
  if (r.rows.length === 0) throw new AppError("PRODUCT_NOT_FOUND", `Producto con SKU '${sku}' no existe o está inactivo`, 404);
  return r.rows[0];
}

// -------------------- Kits ("cajas de herramientas") --------------------
// Un producto "kit" (es_kit = true) agrupa otros productos con una cantidad
// cada uno (producto_kit_items). No afecta al stock por sí mismo — es un
// catálogo de composición para que el operario sepa qué junta al armar la
// caja; el ingreso/salida de cada componente se sigue registrando por separado.

async function addKitItem({ kitSku, itemSku, quantity }) {
  if (!kitSku || !itemSku || !quantity || quantity <= 0) {
    throw new AppError("SCHEMA_INVALID", "kitSku, itemSku y quantity (>0) son obligatorios", 400);
  }
  if (kitSku === itemSku) {
    throw new AppError("SCHEMA_INVALID", "Un kit no puede contenerse a sí mismo", 400);
  }
  const kitR = await pool.query("SELECT producto_id, es_kit FROM productos WHERE sku=$1 AND activo=true", [kitSku]);
  if (kitR.rows.length === 0) throw new AppError("PRODUCT_NOT_FOUND", `Producto con SKU '${kitSku}' no existe o está inactivo`, 404);
  const itemR = await pool.query("SELECT producto_id, es_kit FROM productos WHERE sku=$1 AND activo=true", [itemSku]);
  if (itemR.rows.length === 0) throw new AppError("PRODUCT_NOT_FOUND", `Producto con SKU '${itemSku}' no existe o está inactivo`, 404);
  if (itemR.rows[0].es_kit) {
    throw new AppError("SCHEMA_INVALID", "No se admiten kits anidados (el item tampoco puede ser un kit)", 400);
  }

  await pool.query("UPDATE productos SET es_kit = true WHERE producto_id = $1", [kitR.rows[0].producto_id]);
  const r = await pool.query(
    `INSERT INTO producto_kit_items (producto_kit_id, producto_id, cantidad)
     VALUES ($1,$2,$3)
     ON CONFLICT (producto_kit_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad
     RETURNING *`,
    [kitR.rows[0].producto_id, itemR.rows[0].producto_id, quantity]
  );
  return r.rows[0];
}

async function removeKitItem({ kitSku, itemSku }) {
  const r = await pool.query(
    `DELETE FROM producto_kit_items
     WHERE producto_kit_id = (SELECT producto_id FROM productos WHERE sku=$1)
       AND producto_id = (SELECT producto_id FROM productos WHERE sku=$2)
     RETURNING kit_item_id`,
    [kitSku, itemSku]
  );
  if (r.rows.length === 0) throw new AppError("KIT_ITEM_NOT_FOUND", "Ese item no forma parte del kit", 404);

  const remaining = await pool.query(
    `SELECT count(*) FROM producto_kit_items WHERE producto_kit_id = (SELECT producto_id FROM productos WHERE sku=$1)`,
    [kitSku]
  );
  if (Number(remaining.rows[0].count) === 0) {
    await pool.query("UPDATE productos SET es_kit = false WHERE sku = $1", [kitSku]);
  }
  return { removed: true };
}

async function getKitItems(kitSku) {
  const r = await pool.query(
    `SELECT ki.*, p.sku, p.nombre, p.imagen_url
     FROM producto_kit_items ki
     JOIN productos p ON p.producto_id = ki.producto_id
     WHERE ki.producto_kit_id = (SELECT producto_id FROM productos WHERE sku = $1)
     ORDER BY p.nombre`,
    [kitSku]
  );
  return r.rows;
}

async function getMovements({ sku, page, pageSize }) {
  const { page: p, pageSize: size, offset } = paginationParams(page, pageSize, 50, 1000);
  const params = [];
  let where = "";
  if (sku) {
    params.push(sku);
    where = "WHERE p.sku = $1";
  }
  params.push(size, offset);
  const r = await pool.query(
    `SELECT m.*, p.sku, p.nombre AS producto_nombre,
            ao.codigo AS almacen_origen_codigo, ad.codigo AS almacen_destino_codigo,
            COUNT(*) OVER() AS total_count
     FROM movimientos m
     JOIN productos p ON p.producto_id = m.producto_id
     LEFT JOIN almacenes ao ON ao.almacen_id = m.almacen_origen_id
     LEFT JOIN almacenes ad ON ad.almacen_id = m.almacen_destino_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = r.rows[0]?.total_count ? Number(r.rows[0].total_count) : 0;
  return { items: r.rows.map(({ total_count, ...row }) => row), total, page: p, pageSize: size };
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

// -------------------- Reservas --------------------

async function reserve({ sku, quantity, warehouseCode, locationCode, proyectoCodigo, clienteRuc, fechaExpiracion, usuarioId, canal }) {
  if (!sku || !quantity || quantity <= 0 || !warehouseCode) {
    throw new AppError("SCHEMA_INVALID", "sku, quantity (>0) y warehouseCode son obligatorios", 400);
  }
  return withAuditedTransaction("inventory.reserve", usuarioId, canal, async (client) => {
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

    const stockRow = await lockOrCreateStockRow(client, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null);
    if (Number(stockRow.stock_disponible) < Number(quantity)) {
      throw new AppError("INSUFFICIENT_STOCK", `Stock disponible insuficiente (disponible: ${stockRow.stock_disponible}, solicitado: ${quantity})`, 409);
    }

    const resR = await client.query(
      `INSERT INTO reservas (producto_id, almacen_id, ubicacion_id, proyecto_id, cliente_id, usuario_id, cantidad, fecha_expiracion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING reserva_id`,
      [producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null, proyectoId, clienteId, usuarioId, quantity, fechaExpiracion || null]
    );
    const stockR = await client.query(
      `UPDATE stock SET stock_reservado = stock_reservado + $1, updated_at = now()
       WHERE producto_id=$2 AND almacen_id=$3 AND ubicacion_id IS NOT DISTINCT FROM $4
       RETURNING stock_reservado, stock_disponible`,
      [quantity, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null]
    );

    return {
      entidad: "reservas",
      entidadId: resR.rows[0].reserva_id,
      valorNuevo: { sku, quantity, warehouseCode },
      reserva_id: resR.rows[0].reserva_id,
      stock: stockR.rows[0],
    };
  });
}

async function releaseReservation({ reservaId, usuarioId, canal }) {
  if (!reservaId) throw new AppError("SCHEMA_INVALID", "reservaId es obligatorio", 400);
  return withAuditedTransaction("inventory.release_reservation", usuarioId, canal, async (client) => {
    const r = await client.query("SELECT * FROM reservas WHERE reserva_id=$1 FOR UPDATE", [reservaId]);
    if (r.rows.length === 0) throw new AppError("RESERVATION_NOT_FOUND", `Reserva '${reservaId}' no existe`, 404);
    const reserva = r.rows[0];
    if (reserva.estado !== "ACTIVA") {
      throw new AppError("RESERVATION_NOT_ACTIVE", `La reserva ya está en estado '${reserva.estado}'`, 409);
    }
    await client.query(
      `UPDATE stock SET stock_reservado = stock_reservado - $1, updated_at = now()
       WHERE producto_id=$2 AND almacen_id=$3 AND ubicacion_id IS NOT DISTINCT FROM $4`,
      [reserva.cantidad, reserva.producto_id, reserva.almacen_id, reserva.ubicacion_id]
    );
    await client.query("UPDATE reservas SET estado='CANCELADA' WHERE reserva_id=$1", [reservaId]);
    return { entidad: "reservas", entidadId: reservaId, valorNuevo: { estado: "CANCELADA" } };
  });
}

async function getReservations({ estado }) {
  const params = [];
  let where = "";
  if (estado) { params.push(estado); where = "WHERE r.estado = $1"; }
  const res = await pool.query(
    `SELECT r.*, p.sku, p.nombre AS producto_nombre, a.codigo AS almacen_codigo, u.nombre_completo AS solicitante
     FROM reservas r
     JOIN productos p ON p.producto_id = r.producto_id
     JOIN almacenes a ON a.almacen_id = r.almacen_id
     JOIN usuarios u ON u.usuario_id = r.usuario_id
     ${where}
     ORDER BY r.fecha_reserva DESC LIMIT 200`,
    params
  );
  return res.rows;
}

// -------------------- Ajustes con aprobación --------------------

async function adjustCreate({ sku, warehouseCode, locationCode, cantidadFisica, motivo, usuarioId, canal }) {
  if (!sku || !warehouseCode || cantidadFisica === undefined || cantidadFisica === null || Number(cantidadFisica) < 0) {
    throw new AppError("SCHEMA_INVALID", "sku, warehouseCode y cantidadFisica (>=0) son obligatorios", 400);
  }
  return withAuditedTransaction("inventory.adjust", usuarioId, canal, async (client) => {
    const producto = await findProductBySku(client, sku);
    const almacen = await findWarehouseByCode(client, warehouseCode);
    const ubicacion = await findLocation(client, almacen.almacen_id, locationCode);
    const stockRow = await lockOrCreateStockRow(client, producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null);

    const ajR = await client.query(
      `INSERT INTO ajustes (producto_id, almacen_id, ubicacion_id, cantidad_sistema, cantidad_fisica, motivo, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ajuste_id, diferencia`,
      [producto.producto_id, almacen.almacen_id, ubicacion?.ubicacion_id || null, stockRow.stock_fisico, cantidadFisica, motivo || null, usuarioId]
    );

    return {
      entidad: "ajustes",
      entidadId: ajR.rows[0].ajuste_id,
      valorNuevo: { sku, warehouseCode, cantidadFisica },
      ajuste_id: ajR.rows[0].ajuste_id,
      diferencia: ajR.rows[0].diferencia,
    };
  });
}

async function adjustDecide({ ajusteId, decision, aprobadoPor, canal }) {
  if (!["APROBADO", "RECHAZADO"].includes(decision)) {
    throw new AppError("SCHEMA_INVALID", "decision debe ser APROBADO o RECHAZADO", 400);
  }
  return withAuditedTransaction(`inventory.adjust.${decision.toLowerCase()}`, aprobadoPor, canal, async (client) => {
    const r = await client.query("SELECT * FROM ajustes WHERE ajuste_id=$1 FOR UPDATE", [ajusteId]);
    if (r.rows.length === 0) throw new AppError("ADJUSTMENT_NOT_FOUND", `Ajuste '${ajusteId}' no existe`, 404);
    const ajuste = r.rows[0];
    if (ajuste.estado !== "PENDIENTE") {
      throw new AppError("ADJUSTMENT_NOT_PENDING", `El ajuste ya está en estado '${ajuste.estado}'`, 409);
    }
    if (decision === "APROBADO") {
      await client.query(
        `UPDATE stock SET stock_fisico=$1, updated_at=now()
         WHERE producto_id=$2 AND almacen_id=$3 AND ubicacion_id IS NOT DISTINCT FROM $4`,
        [ajuste.cantidad_fisica, ajuste.producto_id, ajuste.almacen_id, ajuste.ubicacion_id]
      );
    }
    await client.query("UPDATE ajustes SET estado=$1, aprobado_por=$2 WHERE ajuste_id=$3", [decision, aprobadoPor, ajusteId]);
    return { entidad: "ajustes", entidadId: ajusteId, valorNuevo: { estado: decision } };
  });
}

async function getAdjustments({ estado }) {
  const params = [];
  let where = "";
  if (estado) { params.push(estado); where = "WHERE aj.estado = $1"; }
  const res = await pool.query(
    `SELECT aj.*, p.sku, p.nombre AS producto_nombre, a.codigo AS almacen_codigo,
            u.nombre_completo AS solicitante, ap.nombre_completo AS aprobador
     FROM ajustes aj
     JOIN productos p ON p.producto_id = aj.producto_id
     JOIN almacenes a ON a.almacen_id = aj.almacen_id
     JOIN usuarios u ON u.usuario_id = aj.usuario_id
     LEFT JOIN usuarios ap ON ap.usuario_id = aj.aprobado_por
     ${where}
     ORDER BY aj.created_at DESC LIMIT 200`,
    params
  );
  return res.rows;
}

// -------------------- Auditoría --------------------

async function getAuditLog({ accion, resultado, limit = 100 }) {
  const conditions = [];
  const params = [];
  if (accion) { params.push(accion); conditions.push(`au.accion = $${params.length}`); }
  if (resultado) { params.push(resultado); conditions.push(`au.resultado = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(500, Number(limit) || 100));
  const res = await pool.query(
    `SELECT au.*, u.nombre_completo AS usuario_nombre
     FROM auditoria au
     LEFT JOIN usuarios u ON u.usuario_id = au.usuario_id
     ${where}
     ORDER BY au.created_at DESC LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

module.exports = {
  receive, remove, transfer,
  getStock, searchProducts, createProduct, getMovements, getAlerts, listWarehouses,
  reserve, releaseReservation, getReservations,
  adjustCreate, adjustDecide, getAdjustments,
  getAuditLog,
  setProductPhoto, addKitItem, removeKitItem, getKitItems,
};

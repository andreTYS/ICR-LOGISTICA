-- ============================================================
-- ICR Inventario — Módulo de Almacén
-- Schema PostgreSQL: 18 tablas + 2 vistas
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- CONFIGURACIÓN ----------

CREATE TABLE parametros (
    parametro_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clave           TEXT NOT NULL UNIQUE,
    valor           TEXT NOT NULL,
    tipo_dato       TEXT NOT NULL CHECK (tipo_dato IN ('STRING','NUMBER','BOOLEAN','DATE')),
    descripcion     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalogos (
    catalogo_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            TEXT NOT NULL,
    codigo          TEXT NOT NULL,
    valor           TEXT NOT NULL,
    descripcion     TEXT,
    activo          BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (tipo, codigo)
);

-- ---------- MAESTROS ----------

CREATE TABLE usuarios (
    usuario_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_completo      TEXT NOT NULL,
    email               TEXT UNIQUE,
    password_hash       TEXT,
    telegram_id         TEXT UNIQUE,
    rol_codigo          TEXT NOT NULL CHECK (rol_codigo IN
                          ('ADMIN','SUPERVISOR','ALMACENERO','COMPRAS','VENTAS','CONSULTA')),
    nivel_autorizacion  INT NOT NULL DEFAULT 1,
    activo              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE almacenes (
    almacen_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,
    nombre          TEXT NOT NULL,
    responsable_id  UUID REFERENCES usuarios(usuario_id),
    activo          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ubicaciones (
    ubicacion_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    almacen_id       UUID NOT NULL REFERENCES almacenes(almacen_id),
    codigo_ubicacion TEXT NOT NULL,
    descripcion      TEXT,
    activo           BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (almacen_id, codigo_ubicacion)
);

CREATE TABLE proveedores (
    proveedor_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ruc             TEXT NOT NULL UNIQUE,
    razon_social    TEXT NOT NULL,
    contacto        TEXT,
    activo          BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE clientes (
    cliente_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ruc             TEXT NOT NULL UNIQUE,
    razon_social    TEXT NOT NULL,
    contacto        TEXT,
    activo          BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE proyectos (
    proyecto_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_proyecto  TEXT NOT NULL UNIQUE,
    nombre           TEXT NOT NULL,
    cliente_id       UUID REFERENCES clientes(cliente_id),
    responsable_id   UUID REFERENCES usuarios(usuario_id),
    presupuesto      NUMERIC(14,2),
    moneda           TEXT DEFAULT 'PEN',
    fecha_inicio     DATE,
    fecha_fin        DATE,
    estado           TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','PAUSADO','FINALIZADO','CANCELADO')),
    activo           BOOLEAN NOT NULL DEFAULT true
);

-- Horas de mano de obra imputadas a un proyecto (costo/hora por técnico
-- todavía no viene de un módulo de RRHH — se registra por entrada, como en
-- el resto del MVP). Junto con los movimientos de SALIDA que ya llevan
-- proyecto_id, es la otra mitad del costeo real de una instalación (PRD §5.4).
CREATE TABLE proyecto_mano_obra (
    mano_obra_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proyecto_id      UUID NOT NULL REFERENCES proyectos(proyecto_id),
    tecnico_id       UUID NOT NULL REFERENCES usuarios(usuario_id),
    fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
    horas            NUMERIC(6,2) NOT NULL CHECK (horas > 0),
    costo_hora       NUMERIC(10,2) NOT NULL CHECK (costo_hora >= 0),
    descripcion      TEXT,
    registrado_por   UUID NOT NULL REFERENCES usuarios(usuario_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- RRHH ----------
-- Ficha de empleado (opcionalmente ligada a un usuario del sistema) y
-- fichaje de asistencia. No es una planilla completa (PRD §4.2 la deja
-- fuera de este MVP): solo lo necesario para que Proyectos pueda sugerir
-- un costo/hora por técnico en vez de escribirlo a mano cada vez.
CREATE TABLE empleados (
    empleado_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id      UUID UNIQUE REFERENCES usuarios(usuario_id),
    nombre_completo TEXT NOT NULL,
    dni             TEXT UNIQUE,
    cargo           TEXT,
    tipo_contrato   TEXT CHECK (tipo_contrato IN ('PLANILLA','LOCACION','PRACTICANTE')),
    fecha_ingreso   DATE,
    costo_hora      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (costo_hora >= 0),
    activo          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asistencias (
    asistencia_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empleado_id       UUID NOT NULL REFERENCES empleados(empleado_id),
    fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
    hora_entrada      TIMESTAMPTZ,
    hora_salida       TIMESTAMPTZ,
    horas_trabajadas  NUMERIC(6,2),
    observaciones     TEXT,
    UNIQUE (empleado_id, fecha)
);

CREATE TABLE productos (
    producto_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku             TEXT NOT NULL UNIQUE,
    codigo_barras   TEXT UNIQUE,
    nombre          TEXT NOT NULL,
    descripcion     TEXT,
    marca           TEXT,
    modelo          TEXT,
    unidad_medida   TEXT NOT NULL DEFAULT 'UND',
    tipo_control    TEXT NOT NULL CHECK (tipo_control IN ('NORMAL','LOTE','SERIE','SERIE_LOTE')),
    stock_minimo    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    punto_reorden   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (punto_reorden >= 0),
    stock_maximo    NUMERIC(14,2),
    costo_unitario  NUMERIC(14,2) DEFAULT 0,
    imagen_url      TEXT,
    es_kit          BOOLEAN NOT NULL DEFAULT false,
    activo          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composición de un producto "caja/kit" (es_kit = true): qué productos
-- individuales incluye y en qué cantidad. Un producto normal no tiene filas
-- aquí; un kit puede tener varios items, cada uno referenciando un producto
-- no-kit (no se admiten kits anidados, ver CHECK en la app).
CREATE TABLE producto_kit_items (
    kit_item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_kit_id  UUID NOT NULL REFERENCES productos(producto_id),
    producto_id      UUID NOT NULL REFERENCES productos(producto_id),
    cantidad         NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
    UNIQUE (producto_kit_id, producto_id),
    CHECK (producto_kit_id <> producto_id)
);

-- ---------- TRANSACCIONAL ----------

CREATE TABLE documentos (
    documento_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_documento    TEXT NOT NULL CHECK (tipo_documento IN
                        ('FACTURA','GUIA','ORDEN_COMPRA','GUIA_REMISION')),
    numero_documento  TEXT NOT NULL,
    proveedor_id      UUID REFERENCES proveedores(proveedor_id),
    cliente_id        UUID REFERENCES clientes(cliente_id),
    fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (tipo_documento, numero_documento)
);

CREATE TABLE lotes (
    lote_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id         UUID NOT NULL REFERENCES productos(producto_id),
    proveedor_id        UUID REFERENCES proveedores(proveedor_id),
    numero_lote         TEXT NOT NULL,
    fecha_fabricacion   DATE,
    fecha_vencimiento   DATE,
    UNIQUE (producto_id, numero_lote)
);

CREATE TABLE series (
    serie_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id     UUID NOT NULL REFERENCES productos(producto_id),
    lote_id         UUID REFERENCES lotes(lote_id),
    numero_serie    TEXT NOT NULL UNIQUE,
    almacen_id      UUID REFERENCES almacenes(almacen_id),
    ubicacion_id    UUID REFERENCES ubicaciones(ubicacion_id),
    proyecto_id     UUID REFERENCES proyectos(proyecto_id),
    cliente_id      UUID REFERENCES clientes(cliente_id),
    estado          TEXT NOT NULL DEFAULT 'EN_STOCK' CHECK (estado IN
                      ('EN_STOCK','RESERVADO','DESPACHADO','DEVUELTO','BAJA')),
    garantia_inicio DATE,
    garantia_fin    DATE,
    fecha_salida    TIMESTAMPTZ,
    CHECK (garantia_fin IS NULL OR garantia_inicio IS NULL OR garantia_fin >= garantia_inicio)
);

CREATE TABLE reservas (
    reserva_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id       UUID NOT NULL REFERENCES productos(producto_id),
    almacen_id        UUID NOT NULL REFERENCES almacenes(almacen_id),
    ubicacion_id      UUID REFERENCES ubicaciones(ubicacion_id),
    proyecto_id       UUID REFERENCES proyectos(proyecto_id),
    cliente_id        UUID REFERENCES clientes(cliente_id),
    usuario_id        UUID NOT NULL REFERENCES usuarios(usuario_id),
    cantidad          NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
    estado            TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN
                        ('ACTIVA','CONSUMIDA','CANCELADA','EXPIRADA')),
    fecha_reserva     TIMESTAMPTZ NOT NULL DEFAULT now(),
    fecha_expiracion  TIMESTAMPTZ,
    CHECK (fecha_expiracion IS NULL OR fecha_expiracion >= fecha_reserva)
);

CREATE TABLE stock (
    stock_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id       UUID NOT NULL REFERENCES productos(producto_id),
    almacen_id        UUID NOT NULL REFERENCES almacenes(almacen_id),
    ubicacion_id      UUID REFERENCES ubicaciones(ubicacion_id),
    stock_fisico      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock_fisico >= 0),
    stock_reservado   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
    stock_danado      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock_danado >= 0),
    stock_transito     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock_transito >= 0),
    stock_disponible  NUMERIC(14,2) GENERATED ALWAYS AS (stock_fisico - stock_reservado) STORED,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (producto_id, almacen_id, ubicacion_id)
);

CREATE TABLE ajustes (
    ajuste_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id       UUID NOT NULL REFERENCES productos(producto_id),
    almacen_id        UUID NOT NULL REFERENCES almacenes(almacen_id),
    ubicacion_id      UUID REFERENCES ubicaciones(ubicacion_id),
    cantidad_sistema  NUMERIC(14,2) NOT NULL,
    cantidad_fisica   NUMERIC(14,2) NOT NULL,
    diferencia        NUMERIC(14,2) GENERATED ALWAYS AS (cantidad_fisica - cantidad_sistema) STORED,
    motivo            TEXT,
    usuario_id        UUID NOT NULL REFERENCES usuarios(usuario_id),
    estado            TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','APROBADO','RECHAZADO')),
    aprobado_por      UUID REFERENCES usuarios(usuario_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE movimientos (
    movimiento_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    tipo_movimiento       TEXT NOT NULL CHECK (tipo_movimiento IN
                            ('INGRESO','SALIDA','TRANSFERENCIA','AJUSTE','DEVOLUCION')),
    producto_id           UUID NOT NULL REFERENCES productos(producto_id),
    cantidad              NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
    almacen_origen_id     UUID REFERENCES almacenes(almacen_id),
    ubicacion_origen_id   UUID REFERENCES ubicaciones(ubicacion_id),
    almacen_destino_id    UUID REFERENCES almacenes(almacen_id),
    ubicacion_destino_id  UUID REFERENCES ubicaciones(ubicacion_id),
    documento_id          UUID REFERENCES documentos(documento_id),
    proveedor_id          UUID REFERENCES proveedores(proveedor_id),
    cliente_id            UUID REFERENCES clientes(cliente_id),
    proyecto_id           UUID REFERENCES proyectos(proyecto_id),
    lote_id               UUID REFERENCES lotes(lote_id),
    serie_id              UUID REFERENCES series(serie_id),
    usuario_id            UUID NOT NULL REFERENCES usuarios(usuario_id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- COMPRAS ----------
-- Flujo: orden_compra (BORRADOR) -> ENVIADA -> recepcion(es) parciales
-- registran cantidad_recibida por item y actualizan stock/movimientos como
-- cualquier otro ingreso -> PARCIAL mientras falte algo, RECIBIDA cuando se
-- completa. No se admite recibir más de lo pedido (ver CHECK y validación
-- en la app).

CREATE SEQUENCE oc_numero_seq START 1;

CREATE TABLE ordenes_compra (
    orden_compra_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero            TEXT NOT NULL UNIQUE,
    proveedor_id      UUID NOT NULL REFERENCES proveedores(proveedor_id),
    almacen_id        UUID NOT NULL REFERENCES almacenes(almacen_id),
    estado            TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN
                        ('BORRADOR','ENVIADA','PARCIAL','RECIBIDA','CANCELADA')),
    moneda            TEXT DEFAULT 'PEN',
    fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_esperada    DATE,
    observaciones     TEXT,
    creado_por        UUID NOT NULL REFERENCES usuarios(usuario_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orden_compra_items (
    orden_compra_item_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_compra_id       UUID NOT NULL REFERENCES ordenes_compra(orden_compra_id) ON DELETE CASCADE,
    producto_id           UUID NOT NULL REFERENCES productos(producto_id),
    cantidad_pedida       NUMERIC(14,2) NOT NULL CHECK (cantidad_pedida > 0),
    cantidad_recibida     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
    costo_unitario        NUMERIC(14,2) NOT NULL DEFAULT 0,
    UNIQUE (orden_compra_id, producto_id),
    CHECK (cantidad_recibida <= cantidad_pedida)
);

CREATE TABLE recepciones (
    recepcion_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_compra_id    UUID NOT NULL REFERENCES ordenes_compra(orden_compra_id),
    documento_id       UUID REFERENCES documentos(documento_id),
    usuario_id         UUID NOT NULL REFERENCES usuarios(usuario_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recepcion_items (
    recepcion_item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id           UUID NOT NULL REFERENCES recepciones(recepcion_id) ON DELETE CASCADE,
    orden_compra_item_id   UUID NOT NULL REFERENCES orden_compra_items(orden_compra_item_id),
    cantidad               NUMERIC(14,2) NOT NULL CHECK (cantidad > 0)
);

-- ---------- VENTAS ----------
-- Ventas "básicas" (PRD §4.1): no es un CRM (eso queda fuera de alcance,
-- PRD §4.2) ni facturación electrónica SUNAT (Fase 5, diferida) — es un
-- contrato de venta con un cronograma de cobro (hitos) y el registro del
-- comprobante emitido por fuera del sistema cuando se cobra cada hito.

CREATE SEQUENCE contrato_numero_seq START 1;

CREATE TABLE contratos (
    contrato_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_contrato   TEXT NOT NULL UNIQUE,
    cliente_id        UUID NOT NULL REFERENCES clientes(cliente_id),
    proyecto_id       UUID REFERENCES proyectos(proyecto_id),
    monto_total       NUMERIC(14,2) NOT NULL CHECK (monto_total >= 0),
    moneda            TEXT DEFAULT 'PEN',
    fecha_firma       DATE NOT NULL DEFAULT CURRENT_DATE,
    estado            TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN
                        ('BORRADOR','VIGENTE','FINALIZADO','CANCELADO')),
    responsable_id    UUID REFERENCES usuarios(usuario_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cronograma de cobro de un contrato. Un hito PAGADO no se puede volver a
-- pagar ni editar (ver validación en la app); ANULADO es para descartar un
-- hito sin borrarlo (ej. renegociación de condiciones de pago).
CREATE TABLE contrato_hitos (
    hito_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id       UUID NOT NULL REFERENCES contratos(contrato_id) ON DELETE CASCADE,
    descripcion       TEXT NOT NULL,
    monto             NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    fecha_esperada    DATE,
    orden             INT NOT NULL DEFAULT 1,
    estado            TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN
                        ('PENDIENTE','PAGADO','VENCIDO','ANULADO')),
    fecha_pago        DATE,
    monto_pagado      NUMERIC(14,2),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No es facturación electrónica SUNAT — es solo el registro del número de
-- comprobante emitido por fuera del sistema (a mano o por otro software) al
-- cobrar un hito, para tener trazabilidad. Fase 5 (diferida) es la que
-- integraría emisión real ante SUNAT.
CREATE TABLE comprobantes (
    comprobante_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hito_id           UUID NOT NULL REFERENCES contrato_hitos(hito_id),
    tipo              TEXT NOT NULL CHECK (tipo IN ('FACTURA','BOLETA','RECIBO')),
    serie_numero      TEXT NOT NULL,
    fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
    monto             NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
    registrado_por    UUID NOT NULL REFERENCES usuarios(usuario_id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tipo, serie_numero)
);

-- ---------- CONTABILIDAD ----------
-- Motor de asientos por reglas de imputación (PRD §5.1) + parámetros
-- fiscales versionados por vigencia (PRD §5.2). Un asiento nace en BORRADOR
-- (manual o generado automático por una regla) y solo afecta reportes una
-- vez CONTABILIZADO — el PRD pide esto explícitamente como mitigación de
-- riesgo hasta que un contador revise las reglas.

CREATE TABLE plan_cuentas (
    cuenta_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo            TEXT NOT NULL UNIQUE,
    nombre            TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','GASTO')),
    cuenta_padre_id   UUID REFERENCES plan_cuentas(cuenta_id),
    activo            BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE parametros_fiscales (
    parametro_fiscal_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo                 TEXT NOT NULL,
    valor                NUMERIC(10,4) NOT NULL,
    vigente_desde        DATE NOT NULL,
    vigente_hasta        DATE,
    descripcion          TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

-- Un evento de negocio (ej. 'purchases.receive') mapea a un debe/haber fijo.
-- Agregar un evento nuevo o cambiar una cuenta es una fila, no un despliegue.
CREATE TABLE reglas_imputacion (
    regla_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento            TEXT NOT NULL UNIQUE,
    cuenta_debe_id    UUID NOT NULL REFERENCES plan_cuentas(cuenta_id),
    cuenta_haber_id   UUID NOT NULL REFERENCES plan_cuentas(cuenta_id),
    descripcion       TEXT,
    activo            BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE asiento_numero_seq START 1;

CREATE TABLE asientos (
    asiento_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero           TEXT NOT NULL UNIQUE,
    fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
    glosa            TEXT NOT NULL,
    origen_evento    TEXT,
    origen_id        UUID,
    estado           TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','CONTABILIZADO','ANULADO')),
    creado_por       UUID NOT NULL REFERENCES usuarios(usuario_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asiento_lineas (
    asiento_linea_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asiento_id        UUID NOT NULL REFERENCES asientos(asiento_id) ON DELETE CASCADE,
    cuenta_id         UUID NOT NULL REFERENCES plan_cuentas(cuenta_id),
    debe              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
    haber             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
    proyecto_id       UUID REFERENCES proyectos(proyecto_id),
    CHECK ((debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0))
);

-- ---------- MONITOREO ----------

CREATE TABLE alertas (
    alerta_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id        UUID NOT NULL REFERENCES productos(producto_id),
    almacen_id         UUID NOT NULL REFERENCES almacenes(almacen_id),
    tipo_alerta        TEXT NOT NULL DEFAULT 'STOCK_BAJO',
    nivel_actual       NUMERIC(14,2),
    nivel_minimo       NUMERIC(14,2),
    prioridad          TEXT NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA','MEDIA','ALTA')),
    estado             TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','EN_PROCESO','RESUELTA')),
    notificado         BOOLEAN NOT NULL DEFAULT false,
    fecha_notificacion TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auditoria (
    auditoria_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id       UUID REFERENCES usuarios(usuario_id),
    canal            TEXT NOT NULL DEFAULT 'web' CHECK (canal IN ('web','telegram','api','n8n')),
    accion           TEXT NOT NULL,
    entidad          TEXT,
    entidad_id       UUID,
    valor_anterior   JSONB,
    valor_nuevo      JSONB,
    workflow_n8n     TEXT,
    execution_id     TEXT,
    ip_origen        TEXT,
    resultado        TEXT NOT NULL DEFAULT 'success' CHECK (resultado IN ('success','error')),
    error            TEXT,
    transaction_id   UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- VISTAS
-- ============================================================

CREATE VIEW vw_inventario_disponible AS
SELECT
    s.stock_id,
    p.producto_id,
    p.sku,
    p.nombre        AS producto_nombre,
    p.tipo_control,
    p.imagen_url,
    p.es_kit,
    a.almacen_id,
    a.codigo        AS almacen_codigo,
    a.nombre        AS almacen_nombre,
    u.ubicacion_id,
    u.codigo_ubicacion,
    s.stock_fisico,
    s.stock_reservado,
    s.stock_disponible,
    s.stock_danado,
    s.stock_transito,
    p.stock_minimo,
    p.punto_reorden,
    p.stock_maximo
FROM stock s
JOIN productos p  ON p.producto_id = s.producto_id
JOIN almacenes a  ON a.almacen_id  = s.almacen_id
LEFT JOIN ubicaciones u ON u.ubicacion_id = s.ubicacion_id
WHERE a.activo = true AND p.activo = true;

CREATE VIEW vw_stock_bajo AS
SELECT *
FROM vw_inventario_disponible
WHERE stock_disponible <= punto_reorden;

-- ============================================================
-- ÍNDICES DE APOYO
-- ============================================================

CREATE INDEX idx_movimientos_producto ON movimientos(producto_id);
CREATE INDEX idx_movimientos_fecha ON movimientos(created_at);
CREATE INDEX idx_stock_producto_almacen ON stock(producto_id, almacen_id);
CREATE INDEX idx_auditoria_fecha ON auditoria(created_at);
CREATE INDEX idx_auditoria_transaction ON auditoria(transaction_id);
CREATE INDEX idx_oc_items_orden ON orden_compra_items(orden_compra_id);
CREATE INDEX idx_recepcion_items_recepcion ON recepcion_items(recepcion_id);
CREATE INDEX idx_mano_obra_proyecto ON proyecto_mano_obra(proyecto_id);
CREATE INDEX idx_movimientos_proyecto ON movimientos(proyecto_id);
CREATE INDEX idx_asiento_lineas_asiento ON asiento_lineas(asiento_id);
CREATE INDEX idx_asientos_fecha ON asientos(fecha);
CREATE INDEX idx_parametros_fiscales_tipo ON parametros_fiscales(tipo, vigente_desde);
CREATE INDEX idx_asistencias_empleado ON asistencias(empleado_id);
CREATE INDEX idx_asistencias_fecha ON asistencias(fecha);
CREATE INDEX idx_contrato_hitos_contrato ON contrato_hitos(contrato_id);
CREATE INDEX idx_contrato_hitos_estado ON contrato_hitos(estado);
CREATE INDEX idx_comprobantes_hito ON comprobantes(hito_id);
CREATE INDEX idx_contratos_cliente ON contratos(cliente_id);

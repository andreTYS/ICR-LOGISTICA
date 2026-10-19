// Varias columnas/constraints se agregaron a db/schema.sql ENTRE el 23 de
// setiembre (commit e40c887) y el 10 de octubre (cuando recién empezó a
// existir este sistema de migraciones) — una instalación nueva las recibe
// vía schema.sql, pero la base del VPS (volumen ya creado desde antes) se
// quedó sin ellas: docker-entrypoint-initdb.d solo corre una vez, al crear
// el volumen. Confirmado en producción: "column producto_id of relation
// cotizacion_items does not exist" (42703) al crear una cotización con un
// ítem de catálogo — las cotizaciones vienen fallando con "Error interno
// del servidor" desde entonces.
//
// Esta migración junta TODO lo que quedó sin migrar de esa ventana en un
// solo backfill — no solo el que ya se confirmó roto, sino el resto del
// mismo hueco (constraints de e40c887, y las columnas/tabla de
// precio_venta/categoria/destacado/clientes_tienda/drive_folder_id y la
// lista ampliada de categoria en gastos, de los commits siguientes). Todo
// con IF NOT EXISTS / guards idempotentes: en una instalación nueva (donde
// schema.sql ya trae todo esto) cada paso es un no-op seguro.

exports.up = (pgm) => {
  // --- e40c887: enlazar ítems de cotización a un producto real ---
  pgm.sql(`
    ALTER TABLE cotizacion_items ADD COLUMN IF NOT EXISTS producto_id UUID REFERENCES productos(producto_id);
  `);

  // --- e40c887: 3 CHECK de formato/validación que faltaban ---
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE plan_cuentas ADD CONSTRAINT plan_cuentas_codigo_formato CHECK (codigo ~ '^[0-9]+(\\.[0-9]+)*$');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE parametros_fiscales ADD CONSTRAINT parametros_fiscales_valor_no_negativo CHECK (valor >= 0);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE reglas_imputacion ADD CONSTRAINT reglas_imputacion_evento_formato CHECK (evento ~ '^[a-zA-Z][a-zA-Z0-9_.]*$');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // --- Carpeta de Drive propia por proyecto ---
  pgm.sql(`
    ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
  `);

  // --- Precio de lista, categoría y destacado para Tienda/tienda online ---
  pgm.sql(`
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_venta NUMERIC(14,2);
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE productos ADD CONSTRAINT productos_precio_venta_check CHECK (precio_venta IS NULL OR precio_venta >= 0);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria TEXT;
  `);
  pgm.sql(`
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT false;
  `);

  // --- Cuentas de autoservicio de la tienda online ---
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS clientes_tienda (
        cliente_tienda_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre             TEXT NOT NULL,
        correo             TEXT NOT NULL UNIQUE,
        password_hash      TEXT NOT NULL,
        telefono           TEXT,
        empresa            TEXT,
        ruc                TEXT,
        dni                TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // --- gastos.categoria: la lista de valores se amplió (gastos de campo/
  // obra que el negocio ya usaba a mano) — el CHECK original quedó con solo
  // los 8 valores viejos. Busca el CHECK actual sobre esa columna por su
  // definición (no por nombre, por si alguna instalación lo tiene distinto
  // a la convención) y lo reemplaza por el de la lista completa; en una
  // instalación nueva, dropea el correcto y pone uno idéntico — no-op real.
  pgm.sql(`
    DO $$
    DECLARE
      nombre_restriccion TEXT;
    BEGIN
      SELECT con.conname INTO nombre_restriccion
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'gastos' AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) LIKE '%categoria%';
      IF nombre_restriccion IS NOT NULL THEN
        EXECUTE format('ALTER TABLE gastos DROP CONSTRAINT %I', nombre_restriccion);
      END IF;
    END $$;
  `);
  pgm.sql(`
    ALTER TABLE gastos ADD CONSTRAINT gastos_categoria_check CHECK (categoria IN
      ('COMBUSTIBLE','VIATICOS','ALQUILER','SERVICIOS','SOFTWARE','MANTENIMIENTO','HONORARIOS','REEMBOLSO',
       'EQUIPOS_OBRA','MOVILIDAD','MATERIAL','SUELDO','OFICINA','FLETES','ALIMENTACION','OTROS'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      nombre_restriccion TEXT;
    BEGIN
      SELECT con.conname INTO nombre_restriccion
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'gastos' AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) LIKE '%categoria%';
      IF nombre_restriccion IS NOT NULL THEN
        EXECUTE format('ALTER TABLE gastos DROP CONSTRAINT %I', nombre_restriccion);
      END IF;
    END $$;
  `);
  pgm.sql(`
    ALTER TABLE gastos ADD CONSTRAINT gastos_categoria_check CHECK (categoria IN
      ('COMBUSTIBLE','VIATICOS','ALQUILER','SERVICIOS','SOFTWARE','MANTENIMIENTO','HONORARIOS','REEMBOLSO'));
  `);
  pgm.sql(`DROP TABLE IF EXISTS clientes_tienda;`);
  pgm.sql(`ALTER TABLE productos DROP COLUMN IF EXISTS destacado;`);
  pgm.sql(`ALTER TABLE productos DROP COLUMN IF EXISTS categoria;`);
  pgm.sql(`ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_precio_venta_check;`);
  pgm.sql(`ALTER TABLE productos DROP COLUMN IF EXISTS precio_venta;`);
  pgm.sql(`ALTER TABLE proyectos DROP COLUMN IF EXISTS drive_folder_id;`);
  pgm.sql(`ALTER TABLE reglas_imputacion DROP CONSTRAINT IF EXISTS reglas_imputacion_evento_formato;`);
  pgm.sql(`ALTER TABLE parametros_fiscales DROP CONSTRAINT IF EXISTS parametros_fiscales_valor_no_negativo;`);
  pgm.sql(`ALTER TABLE plan_cuentas DROP CONSTRAINT IF EXISTS plan_cuentas_codigo_formato;`);
  pgm.sql(`ALTER TABLE cotizacion_items DROP COLUMN IF EXISTS producto_id;`);
};

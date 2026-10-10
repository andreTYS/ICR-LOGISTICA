// Primera migración real del sistema (ver backend/src/runMigrations.js).
// Antes de esto, todo cambio de schema se aplicaba a mano con psql en el
// VPS — este archivo representa justamente el último cambio que se hizo
// así (destacado + clientes_tienda), para que el historial de migraciones
// arranque desde un estado conocido. Todo IF NOT EXISTS/IF EXISTS a
// propósito: una instalación nueva ya tiene esto vía db/schema.sql (se
// ejecuta una sola vez, al crear el volumen de Postgres), así que esta
// migración debe ser un no-op seguro ahí — el cambio real es solo para
// instalaciones existentes (como producción) que todavía no lo tengan.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT false;
  `);

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
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS clientes_tienda;`);
  pgm.sql(`ALTER TABLE productos DROP COLUMN IF EXISTS destacado;`);
};

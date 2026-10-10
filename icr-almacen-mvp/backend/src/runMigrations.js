const path = require("path");
const { runner } = require("node-pg-migrate");

// Corre todas las migraciones pendientes de migrations/ contra la misma
// base que usa el resto de la app (mismas variables PGHOST/PGPORT/...).
// Se llama una vez al arrancar el backend (ver index.js) — así un cambio
// de schema queda listo con el deploy normal (git pull + rebuild), sin
// que nadie tenga que entrar a psql a mano en el VPS nunca más.
async function runMigrations() {
  await runner({
    databaseUrl: {
      host: process.env.PGHOST || "localhost",
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      database: process.env.PGDATABASE || "icr_almacen",
    },
    dir: path.join(__dirname, "..", "migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    logger: { info: console.log, warn: console.warn, error: console.error },
  });
}

module.exports = { runMigrations };

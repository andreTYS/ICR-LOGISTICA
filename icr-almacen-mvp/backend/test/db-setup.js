// Recrea una base de datos de test desde cero (schema + seed reales, no
// mocks) antes de correr la suite. Deliberadamente se niega a tocar
// cualquier base cuyo nombre no contenga "test", para que un PGDATABASE mal
// configurado nunca pueda borrar una base de desarrollo o producción.
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const pgConfig = () => ({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

async function resetTestDatabase() {
  const dbName = process.env.PGDATABASE;
  if (!dbName || !dbName.toLowerCase().includes("test")) {
    throw new Error(
      `Rehúso a resetear la base '${dbName}': PGDATABASE debe incluir 'test' (ej. icr_almacen_test) para correr la suite.`
    );
  }

  const admin = new Client({ ...pgConfig(), database: "postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const client = new Client({ ...pgConfig(), database: dbName });
  await client.connect();
  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf8");
  const seed = fs.readFileSync(path.join(__dirname, "..", "..", "db", "seed.sql"), "utf8");
  await client.query(schema);
  await client.query(seed);
  await client.end();
}

module.exports = { resetTestDatabase };

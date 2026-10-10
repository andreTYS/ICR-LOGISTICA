# Migraciones

(este archivo vive fuera de `migrations/` a propósito: node-pg-migrate
escanea TODO archivo de esa carpeta como una migración, y un `.md` ahí
rompe el runner con "Cannot determine numeric prefix")

Antes, un cambio de schema (columna/tabla nueva) significaba pasarle a
Andre un bloque de `ALTER TABLE`/`CREATE TABLE` para que lo pegara a mano
contra la base de producción por `psql`. Eso se terminó: ahora el backend
corre las migraciones pendientes **solo al arrancar** (`src/runMigrations.js`,
llamado desde `src/index.js` antes de `app.listen`), así que un deploy
normal (`git pull && docker compose up -d --build backend`) ya deja el
schema al día. Si una migración falla, el proceso no levanta — se ve en los
logs del contenedor de inmediato, en vez de servir contra un schema roto a
medio aplicar.

## Cómo agregar un cambio de schema nuevo

1. Creá un archivo en este directorio con el patrón
   `<timestamp-ms>_<nombre-corto>.js` (podés copiar el de
   `1759900000000_destacado-y-clientes-tienda.js` como plantilla).
2. Exportá `up`/`down` usando `pgm.sql(...)` con SQL normal — nada de DSL
   nuevo que aprender, es el mismo SQL que ya se escribe en `db/schema.sql`.
3. Agregá también el cambio a `db/schema.sql` (con el mismo criterio de
   siempre, comentado) — eso sigue siendo lo que arma una instalación
   *nueva* desde cero (`docker-entrypoint-initdb.d`). La migración es lo
   que pone al día una instalación que **ya existe** (como producción).
   Por eso toda migración debe ser segura de correr dos veces — usar
   `IF NOT EXISTS`/`IF EXISTS` siempre, igual que ya se hacía a mano.
4. Corré `npm run migrate` localmente contra tu base de desarrollo para
   probarla antes de subirla (ver `package.json`).

## Por qué no se reescribió todo el historial de schema como migraciones

Sería un trabajo grande y arriesgado (reconstruir a mano años de cambios
reales de producción) para cero beneficio real — lo que importa es que
*de acá para adelante* todo cambio quede versionado y se aplique solo. El
historial de migraciones arranca desde el estado actual conocido
(`1759900000000_destacado-y-clientes-tienda.js`, que es justamente el
último cambio que se había aplicado a mano); `db/schema.sql` sigue siendo
la referencia completa para una instalación nueva.

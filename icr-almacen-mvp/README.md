# ICR Almacén — MVP (Módulo de Inventario)

MVP funcional del módulo de Almacén: base de datos PostgreSQL (18 tablas + 2 vistas), backend Node.js/Express con los comandos `inventory.receive`, `inventory.remove`, `inventory.transfer` y consultas, y un panel web para operarlo. **Probado de punta a punta**: los 5 casos de aceptación del PRD (consultar, ingresar, retirar, retiro rechazado por stock insuficiente, transferencia atómica) corren correctamente.

La automatización con N8N / Telegram **no está incluida en este MVP** — queda para la siguiente fase, tal como se acordó. El backend ya expone los comandos en el formato de request/response definido en el documento técnico, así que conectar N8N después es solo apuntar los workflows a estos mismos endpoints.

## Qué incluye

- `db/schema.sql` — DDL completo (18 tablas, 2 vistas, índices).
- `db/seed.sql` — catálogo base para operar: 6 usuarios (uno por rol), 3 almacenes, 4 ubicaciones, 17 productos (10 equipos solares/BESS, 5 herramientas y 2 maletas armadas como kits), 2 proveedores, 2 clientes, 1 proyecto.
- `backend/scripts/seed-demo.js` (`npm run seed:demo`) — genera un historial de movimientos realista (ingresos, salidas, transferencias, una reserva activa, un ajuste pendiente) usando los mismos comandos de la API, así que el stock resultante queda garantizado consistente con el ledger; también carga stock de las herramientas y arma las dos maletas de ejemplo (`inventory.addKitItem`).
- `backend/` — API Node.js/Express + PostgreSQL (`pg`), con transacciones atómicas y locking para evitar condiciones de carrera (ver `src/services/inventoryService.js`).
- `frontend/` — panel web (HTML/JS puro, sin build step en runtime) servido por el mismo backend: Panel (dashboard), Stock, Ingreso, Salida, Transferencia, Productos, Movimientos, Alertas, Reservas, Ajustes, Auditoría, Usuarios. Stock/Productos/Movimientos con paginación y exportación a CSV. Estilizado con Tailwind CSS (paleta `#00004C` / `#000073` / `#00B7C2` / `#00FFC2`), compilado a `frontend/style.css` en tiempo de desarrollo — ver [`frontend/README.md`](frontend/README.md) para regenerarlo tras tocar clases de Tailwind.
- `docker-compose.yml` — para desplegar en el VPS de Hostinger junto a Traefik.

## Opción A — Levantar en local (para revisar antes del jueves)

Requiere PostgreSQL y Node.js 18+ instalados.

```bash
# 1. Crear la base de datos y cargar el schema
createdb icr_almacen
psql -d icr_almacen -f db/schema.sql
psql -d icr_almacen -f db/seed.sql

# 2. Backend
cd backend
npm install
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=icr_almacen PORT=4000 npm start

# 3. (Opcional) generar historial de movimientos de demo — en otra terminal:
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres PGDATABASE=icr_almacen npm run seed:demo

# 4. Abrir el panel
# http://localhost:4000
```

## Opción B — Desplegar en el VPS (Docker + Traefik)

1. Copiar la carpeta `icr-almacen-mvp/` al VPS.
2. Crear un archivo `.env` en la raíz del proyecto:
   ```
   DB_PASSWORD=<una contraseña segura>
   JWT_SECRET=<una cadena aleatoria larga>
   DOMAIN=almacen.icr.tudominio.com
   ```
3. Confirmar que el nombre de la red externa de Traefik en `docker-compose.yml` (`traefik_public`) coincide con la red real que ya usa Traefik en el VPS — si se llama distinto, cambiarlo ahí.
4. El logo y las fotos de producto se guardan en `/app/uploads` dentro del contenedor, montado como el volumen `icr_almacen_uploads` — sobrevive a un `docker compose up -d --build`. Si el VPS tiene backups de volúmenes, agregar este a la lista.
5. Levantar:
   ```bash
   docker compose up -d --build
   ```
6. El schema y el seed se cargan automáticamente la primera vez que arranca el contenedor de PostgreSQL (vía `docker-entrypoint-initdb.d`).

## Usuarios de prueba (seed)

| Rol | Email | Contraseña |
|---|---|---|
| Admin | `admin@moqueguasoft.com` | `admin123` |
| Supervisor | `supervisor@icr.pe` | `supervisor123` |
| Almacenero | `almacen@icr.pe` | `almacen123` |
| Compras | `compras@icr.pe` | `compras123` |
| Ventas | `ventas@icr.pe` | `ventas123` |
| Consulta | `consulta@icr.pe` | `consulta123` |

El panel ahora exige login (pantalla inicial). El backend valida el token JWT en cada request y aplica el mapa de permisos por rol definido en el documento técnico (`backend/src/auth.js`) — por ejemplo, un usuario con rol `CONSULTA` no puede ejecutar `inventory.receive`, solo consultar.

**Hardening para producción:**
- `JWT_SECRET` es **obligatorio** cuando `NODE_ENV=production` — el backend falla al arrancar si no está definido (en desarrollo cae a un valor por defecto).
- `POST /auth/login` está limitado a 10 intentos por IP cada 15 minutos.
- CORS está abierto por defecto (conveniente en local); definir `ALLOWED_ORIGIN` (uno o varios dominios separados por coma) para restringirlo en producción.

## Productos de ejemplo cargados

| SKU | Producto | Control |
|---|---|---|
| `PANEL-JA-550` | Panel Solar JA Solar 550W | NORMAL |
| `PANEL-JINKO-450` | Panel Solar Jinko 450W | NORMAL |
| `INV-GROWATT-5K` | Inversor Growatt 5kW | SERIE |
| `INV-HUAWEI-10K` | Inversor Huawei SUN2000 10kW | SERIE |
| `BAT-PYLON-3.5` | Batería BESS Pylontech 3.5kWh | SERIE |
| `BAT-DEYE-5.1` | Batería LiFePO4 Deye 5.1kWh | SERIE |
| `CABLE-SOLAR-6MM` | Cable solar fotovoltaico 6mm² | NORMAL |
| `CONECTOR-MC4` | Par de conectores MC4 | NORMAL |
| `ESTRUCTURA-TECHO` | Kit estructura de montaje para techo | NORMAL |
| `MONITOR-WIFI` | Módulo de monitoreo WiFi para inversor | SERIE |
| `HERR-CRIMP-MC4` | Pinza crimpadora MC4 | NORMAL |
| `HERR-EXTRACTOR-MC4` | Extractor de terminales MC4 | NORMAL |
| `HERR-MULTIMETRO` | Multímetro digital de gancho | NORMAL |
| `HERR-TORQUIMETRO` | Llave torquímetro 1/2" | NORMAL |
| `HERR-DESTORNILLADOR` | Set de destornilladores aislados 1000V | NORMAL |
| `MALETA-MC4` (KIT) | Maleta de conectorizado MC4 — pinza crimpadora, extractor, conectores y cable de repuesto | NORMAL |
| `MALETA-INSTALACION` (KIT) | Maleta de instalación eléctrica — torquímetro, set de destornilladores, multímetro, conectores y cable de repuesto | NORMAL |

## Qué NO incluye este MVP (a propósito)

- Automatización N8N / Telegram — fase siguiente.
- Control completo por lote/serie (trazabilidad individual de números de serie en `receive`/`remove`) — las tablas `lotes`/`series` existen en el schema pero no están conectadas a los comandos de API todavía.
- HTTPS en local (sí lo maneja Traefik en el VPS vía el `docker-compose.yml`).

## Tests automatizados

```bash
cd backend
npm install
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm test
```

`npm test` corre contra una base Postgres real, no mocks — la lógica de negocio vive en transacciones con locking (`FOR UPDATE`, orden determinístico en transferencias) y eso es justamente lo que un mock no puede validar. `test/db-setup.js` recrea `icr_almacen_test` desde cero (mismo `schema.sql` + `seed.sql` que usa el resto del proyecto) antes de cada corrida, y **se niega a tocar cualquier base cuyo nombre no contenga "test"** para que un `PGDATABASE` mal configurado no pueda borrar una base de desarrollo real.

Cada archivo de test que toca la base (`inventory.test.js`, `purchases.test.js`) llama a `resetTestDatabase()` en su propio `before()`. Como `node --test` corre archivos en paralelo por defecto, dos `DROP/CREATE DATABASE` simultáneos sobre la misma base se pisan entre sí y cuelgan el runner — por eso el script usa `--test-concurrency=1` (los archivos corren uno detrás del otro, no en paralelo).

Cobertura: los 5 casos de aceptación del PRD, reservar/liberar (incluyendo rechazo por stock insuficiente), ajustes con aprobación/rechazo (y que no se puedan decidir dos veces), kits (composición + rechazo de kits anidados), compras (creación sin afectar stock, recepción parcial/total con Kardex actualizado, rechazo de sobre-recepción, cancelación, sugerencias de reabastecimiento), y el mapa de permisos por rol (`backend/test/auth.test.js`, sin DB).

Escribir estos tests encontró un bug real preexistente: cuando fallaba el registro de auditoría de un error (por ejemplo con un `canal` inválido), el cliente de conexión nunca se liberaba de vuelta al pool — bajo una racha sostenida de errores, esto terminaba agotando el pool de conexiones y colgando el backend entero. Ya está corregido en `inventoryService.js`.

## Cómo probar los 5 casos de aceptación del PRD manualmente

1. **Consultar stock** → pestaña *Stock*.
2. **Ingresar stock** → pestaña *Ingreso*, llenar SKU + cantidad + almacén → "Registrar ingreso".
3. **Retirar stock** → pestaña *Salida*.
4. **Retiro rechazado por stock insuficiente** → pedir una cantidad mayor a la disponible; el panel muestra el error `INSUFFICIENT_STOCK` sin tocar el stock.
5. **Transferencia atómica** → pestaña *Transferencia*; verificar en *Stock* que el origen bajó y el destino subió exactamente lo mismo.

## Funcionalidad agregada tras el MVP inicial

- **Reservas** (`inventory.reserve` / `inventory.release_reservation`) — apartar stock para un proyecto o cliente sin retirarlo aún; libera el `stock_reservado` al cancelar. Rol `VENTAS` puede reservar/liberar; la mayoría de roles pueden consultar la lista.
- **Ajustes con aprobación** (`inventory.adjust` / `inventory.adjust.approve`) — cualquier rol con permiso de ajuste registra el conteo físico; el ajuste queda `PENDIENTE` y solo aplica al stock cuando un `SUPERVISOR` o `ADMIN` lo aprueba (o queda descartado si lo rechaza).
- **Auditoría** — visor de solo lectura sobre la tabla `auditoria`, que ya registraba cada comando (éxito o error) desde el día uno; ahora tiene UI (`SUPERVISOR`/`ADMIN`).
- **Usuarios** — alta, cambio de rol y activar/desactivar usuarios desde el panel (antes solo por SQL directo). Exclusivo de `ADMIN`.
- **Paginación** en Stock, Productos y Movimientos (antes Productos cortaba en 50 resultados sin avisar). Exportar a CSV disponible en Stock y Movimientos.
- **Kardex por producto** — clic en cualquier SKU (en Stock o Productos) abre un panel con el desglose de stock por almacén/ubicación y el historial completo de movimientos de ese producto.
- **Acciones rápidas + gráfico de actividad** en el Panel — accesos directos a Ingreso/Salida/Transferencia/Reservar, y un gráfico de barras (Ingresos vs. Salidas) de los últimos 7 días con tooltip al pasar el mouse. Colores validados para daltonismo con el script de la skill de dataviz (`#2a78d6` / `#eb6834`, ΔE CVD 24.7 — muy por encima del piso de 8).
- **Estados vacíos con ícono** en todas las tablas (sin resultados, sin permiso, todo al día) en vez de solo texto en cursiva.
- **Logo configurable** — pestaña *Configuración* (solo `ADMIN`): subir una imagen (JPEG/PNG/WebP, hasta 3MB) que reemplaza la marca "IC" en el menú lateral y en la pantalla de login. Se guarda en `parametros` (`LOGO_URL`) y el archivo en `/uploads`, servido como estático por el propio backend.
- **Fotos de producto** — botón "Subir foto" en la tabla de Productos y dentro del Kardex de cada SKU. Aparece como miniatura en la lista y como imagen grande en el Kardex.
- Toda imagen subida (logo o foto de producto) se **reescala a un máximo de 800px de lado y se recomprime** con `sharp` antes de guardarse (`backend/src/uploads.js`) — una foto de celular de varios MB no se guarda tal cual.
- **Kits ("cajas de herramientas")** — cualquier producto puede agrupar otros productos con una cantidad cada uno (tabla `producto_kit_items`), gestionable desde la sección "Kit / lista de materiales" del Kardex. Agregar el primer item convierte automáticamente el producto en kit (badge `KIT` en Productos); no se admiten kits anidados. Es un catálogo de composición — el stock de cada componente se sigue registrando por separado con `inventory.receive`/`remove`.
- **Compras** (Fase 1 del roadmap del ERP) — flujo completo Orden de compra → Recepción → Kardex: crear una OC en `BORRADOR`, enviarla al proveedor, y registrar una o más recepciones (parciales o totales) que actualizan el stock exactamente igual que un ingreso normal. Una orden queda `PARCIAL` mientras falte algo y `RECIBIDA` al completarse; no se admite recibir más de lo pedido en ninguna línea. Incluye sugerencias de reabastecimiento (productos por debajo del punto de reorden, con cantidad sugerida hasta `stock_maximo`) con un botón para agregarlas directo a una orden nueva. Pestaña *Compras*, roles `COMPRAS`/`ADMIN` para crear y gestionar, `ALMACENERO`/`SUPERVISOR` pueden recibir/consultar.

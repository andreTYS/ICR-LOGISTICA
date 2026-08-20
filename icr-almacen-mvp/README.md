# ICR Almacén — MVP (Módulo de Inventario)

MVP funcional del módulo de Almacén: base de datos PostgreSQL (18 tablas + 2 vistas), backend Node.js/Express con los comandos `inventory.receive`, `inventory.remove`, `inventory.transfer` y consultas, y un panel web para operarlo. **Probado de punta a punta**: los 5 casos de aceptación del PRD (consultar, ingresar, retirar, retiro rechazado por stock insuficiente, transferencia atómica) corren correctamente.

La automatización con N8N / Telegram **no está incluida en este MVP** — queda para la siguiente fase, tal como se acordó. El backend ya expone los comandos en el formato de request/response definido en el documento técnico, así que conectar N8N después es solo apuntar los workflows a estos mismos endpoints.

## Qué incluye

- `db/schema.sql` — DDL completo (18 tablas, 2 vistas, índices).
- `db/seed.sql` — datos mínimos para operar: 3 usuarios, 2 almacenes, 2 ubicaciones, 3 productos de ejemplo.
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

# 3. Abrir el panel
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
4. Levantar:
   ```bash
   docker compose up -d --build
   ```
5. El schema y el seed se cargan automáticamente la primera vez que arranca el contenedor de PostgreSQL (vía `docker-entrypoint-initdb.d`).

## Usuarios de prueba (seed)

| Rol | Email | Contraseña |
|---|---|---|
| Admin | `admin@moqueguasoft.com` | `admin123` |
| Almacenero | `almacen@icr.pe` | `almacen123` |
| Supervisor | `supervisor@icr.pe` | `supervisor123` |

El panel ahora exige login (pantalla inicial). El backend valida el token JWT en cada request y aplica el mapa de permisos por rol definido en el documento técnico (`backend/src/auth.js`) — por ejemplo, un usuario con rol `CONSULTA` no puede ejecutar `inventory.receive`, solo consultar.

**Hardening para producción:**
- `JWT_SECRET` es **obligatorio** cuando `NODE_ENV=production` — el backend falla al arrancar si no está definido (en desarrollo cae a un valor por defecto).
- `POST /auth/login` está limitado a 10 intentos por IP cada 15 minutos.
- CORS está abierto por defecto (conveniente en local); definir `ALLOWED_ORIGIN` (uno o varios dominios separados por coma) para restringirlo en producción.

## Productos de ejemplo cargados

| SKU | Producto | Control |
|---|---|---|
| `PANEL-JA-550` | Panel Solar JA Solar 550W | NORMAL |
| `INV-GROWATT-5K` | Inversor Growatt 5kW | SERIE |
| `BAT-PYLON-3.5` | Batería BESS Pylontech 3.5kWh | SERIE |

## Qué NO incluye este MVP (a propósito)

- Automatización N8N / Telegram — fase siguiente.
- Control completo por lote/serie (trazabilidad individual de números de serie en `receive`/`remove`) — las tablas `lotes`/`series` existen en el schema pero no están conectadas a los comandos de API todavía.
- HTTPS en local (sí lo maneja Traefik en el VPS vía el `docker-compose.yml`).
- Tests automatizados — la verificación de los casos de aceptación sigue siendo manual (ver abajo).

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

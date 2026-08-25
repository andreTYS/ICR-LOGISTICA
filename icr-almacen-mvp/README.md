# ICR Almacén — MVP (Módulo de Inventario)

MVP funcional del módulo de Almacén: base de datos PostgreSQL (18 tablas + 2 vistas), backend Node.js/Express con los comandos `inventory.receive`, `inventory.remove`, `inventory.transfer` y consultas, y un panel web para operarlo. **Probado de punta a punta**: los 5 casos de aceptación del PRD (consultar, ingresar, retirar, retiro rechazado por stock insuficiente, transferencia atómica) corren correctamente.

La automatización con N8N / Telegram **no está incluida en este MVP** — queda para la siguiente fase, tal como se acordó. El backend ya expone los comandos en el formato de request/response definido en el documento técnico, así que conectar N8N después es solo apuntar los workflows a estos mismos endpoints.

## Qué incluye

- `db/schema.sql` — DDL completo (18 tablas, 2 vistas, índices).
- `db/seed.sql` — catálogo base para operar: 6 usuarios (uno por rol), 3 almacenes, 4 ubicaciones, 10 productos, 2 proveedores, 2 clientes, 1 proyecto.
- `backend/scripts/seed-demo.js` (`npm run seed:demo`) — genera un historial de movimientos realista (ingresos, salidas, transferencias, una reserva activa, un ajuste pendiente) usando los mismos comandos de la API, así que el stock resultante queda garantizado consistente con el ledger.
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
4. Levantar:
   ```bash
   docker compose up -d --build
   ```
5. El schema y el seed se cargan automáticamente la primera vez que arranca el contenedor de PostgreSQL (vía `docker-entrypoint-initdb.d`).

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
- **Kardex por producto** — clic en cualquier SKU (en Stock o Productos) abre un panel con el desglose de stock por almacén/ubicación y el historial completo de movimientos de ese producto.
- **Acciones rápidas + gráfico de actividad** en el Panel — accesos directos a Ingreso/Salida/Transferencia/Reservar, y un gráfico de barras (Ingresos vs. Salidas) de los últimos 7 días con tooltip al pasar el mouse. Colores validados para daltonismo con el script de la skill de dataviz (`#2a78d6` / `#eb6834`, ΔE CVD 24.7 — muy por encima del piso de 8).
- **Estados vacíos con ícono** en todas las tablas (sin resultados, sin permiso, todo al día) en vez de solo texto en cursiva.

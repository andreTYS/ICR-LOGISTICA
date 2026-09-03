# Inversiones ICR — ERP

Sistema ERP de Inversiones ICR, construido por fases sobre el MVP inicial del módulo de Almacén: base de datos PostgreSQL (crece por fase — ver changelog más abajo), backend Node.js/Express con los comandos `inventory.receive`, `inventory.remove`, `inventory.transfer` y consultas, y un panel web (con login "Acceso ERP de Inversiones ICR") para operar Almacén, Compras, Proyectos y Contabilidad. **Probado de punta a punta**: los 5 casos de aceptación del PRD original de Almacén (consultar, ingresar, retirar, retiro rechazado por stock insuficiente, transferencia atómica) corren correctamente, y cada fase nueva suma su propia suite de tests (ver "Tests automatizados").

La automatización con N8N / Telegram **no está incluida en este MVP** — queda para la siguiente fase, tal como se acordó. El backend ya expone los comandos en el formato de request/response definido en el documento técnico, así que conectar N8N después es solo apuntar los workflows a estos mismos endpoints.

## Qué incluye

- `db/schema.sql` — DDL completo (crece por fase: Almacén, Compras, Proyectos, Contabilidad — ver índices al final del archivo).
- `db/seed.sql` — catálogo base para operar: 6 usuarios (uno por rol), 5 almacenes, 7 ubicaciones, 30 productos (equipos solares/BESS, herramientas, 2 maletas armadas como kits y accesorios de instalación), 5 proveedores, 5 clientes, 3 proyectos, y el plan de cuentas/parámetro de IGV/regla de imputación inicial de Contabilidad.
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

Más 13 productos adicionales en `db/seed.sql` (paneles Canadian/Trina, inversores Sungrow/Fronius, batería BYD, estructura de suelo, cable 4mm², breakers/SPD DC, caja combinadora, monitor Victron, arnés de seguridad, cinta UV) — 30 productos en total.

## Qué NO incluye este MVP (a propósito)

- Automatización N8N / Telegram — infraestructura externa (ver "Integración N8N / Telegram" más abajo); el contrato de endpoints ya está listo.
- Control completo por lote/serie (trazabilidad individual de números de serie en `receive`/`remove`) — las tablas `lotes`/`series` existen en el schema pero no están conectadas a los comandos de API todavía.
- Planillas completas (cálculo de sueldos, boletas, aportes) — el PRD (§4.2) deja esto explícitamente fuera del MVP. RRHH solo cubre fichas de empleado, fichaje de asistencia y costo/hora sugerido para Proyectos.
- CRM avanzado (pipeline comercial multi-etapa, seguimiento de leads) — el PRD (§4.2) lo deja fuera; Ventas cubre solo "ventas básicas": contratos con hitos de cobro y cuentas por cobrar (§4.1).
- Facturación electrónica SUNAT — Fase 5 del roadmap, diferida explícitamente por el PRD. El módulo de Ventas registra el número de comprobante emitido por fuera del sistema (a mano o por otro software), no emite comprobantes válidos ante SUNAT.
- HTTPS en local (sí lo maneja Traefik en el VPS vía el `docker-compose.yml`).

## Tests automatizados

```bash
cd backend
npm install
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres npm test
```

`npm test` corre contra una base Postgres real, no mocks — la lógica de negocio vive en transacciones con locking (`FOR UPDATE`, orden determinístico en transferencias) y eso es justamente lo que un mock no puede validar. `test/db-setup.js` recrea `icr_almacen_test` desde cero (mismo `schema.sql` + `seed.sql` que usa el resto del proyecto) antes de cada corrida, y **se niega a tocar cualquier base cuyo nombre no contenga "test"** para que un `PGDATABASE` mal configurado no pueda borrar una base de desarrollo real.

Cada archivo de test que toca la base (`inventory.test.js`, `purchases.test.js`) llama a `resetTestDatabase()` en su propio `before()`. Como `node --test` corre archivos en paralelo por defecto, dos `DROP/CREATE DATABASE` simultáneos sobre la misma base se pisan entre sí y cuelgan el runner — por eso el script usa `--test-concurrency=1` (los archivos corren uno detrás del otro, no en paralelo).

Cobertura: los 5 casos de aceptación del PRD, reservar/liberar (incluyendo rechazo por stock insuficiente), ajustes con aprobación/rechazo (y que no se puedan decidir dos veces), kits (composición + rechazo de kits anidados), compras (creación sin afectar stock, recepción parcial/total con Kardex actualizado, rechazo de sobre-recepción, cancelación, sugerencias de reabastecimiento), proyectos (costeo real cruzando movimientos con `proyecto_id` + mano de obra, rechazo de horas en proyecto cancelado), contabilidad (parámetro fiscal vigente por fecha, asiento desbalanceado rechazado, contabilizar/anular, generación automática del asiento al recibir una compra — y que NO se genere si la regla está desactivada), el reporte de rentabilidad por proyecto (margen y margen % calculados correctamente, proyecto sin actividad en 0), RRHH (alta de empleado con/sin usuario vinculado, marcar entrada/salida con cálculo de horas trabajadas, rechazo de doble entrada y de salida sin entrada abierta, y que `listTecnicos()` de Proyectos refleje el `costo_hora` de la ficha de empleado), Ventas (crear contrato con hitos, agregar hito a un contrato vigente y rechazo en uno cancelado, registrar el pago de un hito con comprobante y verificar que dispara el asiento automático en `BORRADOR`, rechazo de pagar el mismo hito dos veces, y que el reporte de cuentas por cobrar venza automáticamente los hitos con fecha pasada), y el mapa de permisos por rol (`backend/test/auth.test.js`, sin DB).

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
- **Proyectos** (Fase 2 del roadmap del ERP) — cada obra/instalación es un proyecto (tabla `proyectos`, ya existía como dimensión de movimientos/reservas; ahora tiene CRUD y un estado `ACTIVO`/`PAUSADO`/`FINALIZADO`/`CANCELADO`). El costeo real cruza dos fuentes: los movimientos de `SALIDA` que ya llevan `proyecto_id` (materiales consumidos, valorizados al `costo_unitario` actual del producto) y las horas de mano de obra registradas por técnico (`proyecto_mano_obra`, costo/hora sugerido automáticamente desde la ficha de RRHH del técnico si tiene una vinculada — editable a mano igual que antes si no la tiene). El detalle del proyecto muestra materiales + mano de obra + costo total vs. presupuesto = margen. **Nota**: el costeo de materiales usa el costo unitario *actual* del producto, no un histórico por movimiento (no hay AVCO real todavía, es la misma aproximación que usa el resto del MVP). Pestaña *Proyectos*, `SUPERVISOR`/`ADMIN` crean y cambian estado, `ALMACENERO` puede registrar horas, el resto de roles consulta.
- **Menú lateral reorganizado en módulos colapsables** (Almacén, Compras, Proyectos, Ventas, Contabilidad, RR.HH., Administración) en vez de una lista plana — necesario a medida que el ERP suma módulos. Cada módulo agrupa varias pantallas (igual que Almacén): Compras tiene Órdenes de compra / Reabastecimiento / Proveedores; Proyectos tiene Obras-costeo / Clientes; Ventas tiene Contratos / Cuentas por cobrar; Contabilidad tiene Asientos / Plan de cuentas / Reglas de imputación / Parámetros fiscales; RR.HH. tiene Empleados / Asistencia. Con esto quedan construidos todos los módulos funcionales del PRD (§6) salvo Facturación electrónica SUNAT, diferida explícitamente a una fase posterior.
- **Contabilidad** (Fase 3 del roadmap del ERP) — motor de asientos por reglas de imputación (PRD §5.1) + parámetros fiscales versionados por vigencia (PRD §5.2). Un asiento nace en `BORRADOR` (manual o generado automático) y solo cuenta para reportes una vez `CONTABILIZADO` — la app nunca lo activa sola. Plan de cuentas simple (jerárquico por `cuenta_padre_id`), reglas de imputación que mapean un evento de negocio (ej. `purchases.receive`) a un debe/haber fijo — agregar una regla nueva es una fila, no un despliegue —, y un gancho **best-effort** en `comprasService.recibirOrdenCompra`: si hay una regla activa para `purchases.receive`, cada recepción de compra genera su asiento en Borrador automáticamente (si no hay regla configurada, no pasa nada — nunca rompe la recepción). Pestaña *Contabilidad*, `SUPERVISOR`/`ADMIN` gestionan, el resto de roles consulta. **Nota**: como con el costeo de Proyectos, esto es una aproximación de MVP — antes de usarlo en producción real, el PRD pide revisión de un contador sobre las reglas y los parámetros fiscales.
- **Base de datos y dashboard ampliados** — el seed base pasó de 3 a 5 almacenes y de 17 a 30 productos (ver arriba), y el Panel ahora suma una fila de resumen de los módulos nuevos (órdenes de compra pendientes, proyectos activos, asientos contables en borrador) además de las métricas de Almacén que ya tenía.
- **Reporte de rentabilidad por proyecto** (mitad de la Fase 4 del roadmap) — cruza en una sola consulta agregada el costo real de cada proyecto (materiales vía movimientos con `proyecto_id` + mano de obra) contra su presupuesto, con margen y margen % por proyecto y totales agregados. Pestaña *Proyectos → Rentabilidad*, ordenado por margen ascendente (los proyectos con peor margen aparecen primero), con exportación a CSV. La otra mitad de la Fase 4 — automatización N8N/Telegram — es infraestructura externa; ver la sección "Integración N8N / Telegram" más abajo.
- **RR.HH.** (prioridad Media del roadmap del ERP) — fichas de empleado (`empleados`: cargo, tipo de contrato, DNI, fecha de ingreso, costo/hora, opcionalmente vinculadas a un usuario del sistema) y fichaje de asistencia (`asistencias`: marcar entrada/salida, con `horas_trabajadas` calculado automáticamente al marcar la salida; un empleado no puede marcar dos entradas el mismo día ni una salida sin una entrada abierta). Deliberadamente **no** incluye planillas completas (PRD §4.2). El punto de integración con Proyectos: `listTecnicos()` ahora hace `LEFT JOIN` con `empleados` y sugiere el `costo_hora` de la ficha del técnico al elegirlo en el formulario de mano de obra — cerrando el hueco que antes obligaba a escribirlo a mano cada vez. Pestaña *RR. HH.*, `SUPERVISOR`/`ADMIN` gestionan empleados, el resto de roles puede marcar su propia asistencia y consultar.
- **Ventas** (prioridad Media del roadmap del ERP, PRD §4.1: "ventas básicas") — contratos de venta (`contratos`, ligados a un cliente y opcionalmente a un proyecto) con un cronograma de cobro por hitos (`contrato_hitos`). Al registrar el pago de un hito se puede adjuntar el comprobante emitido por fuera del sistema (`comprobantes`: tipo, serie-número — **no** es facturación electrónica SUNAT, eso es la Fase 5 diferida) y se dispara, best-effort igual que en Compras, un asiento contable automático (`sales.milestone_paid`) si hay una regla de imputación activa. El reporte de *Cuentas por cobrar* vence automáticamente los hitos `PENDIENTE` cuya fecha esperada ya pasó cada vez que se consulta, sin necesitar un cron aparte. Deliberadamente **no** es un CRM (PRD §4.2 deja el pipeline comercial multi-etapa fuera de alcance). Pestaña *Ventas*, roles `VENTAS`/`SUPERVISOR`/`ADMIN` gestionan contratos, el resto de roles consulta.

## Integración N8N / Telegram

La otra mitad de la Fase 4 del roadmap (automatización conversacional de movimientos vía Telegram + N8N) **no se construye dentro de este repositorio** — es infraestructura externa: tu propia instancia de N8N y un bot de Telegram con su token, ninguno de los cuales existe en este entorno de desarrollo. Lo que sí está listo desde el día uno es el contrato para conectarla:

- **Cada comando de escritura acepta un campo `channel`** (`web` | `telegram` | `api` | `n8n`) en el body del request, y ese valor queda en `auditoria.canal` — así un movimiento hecho por un workflow de N8N queda trazado igual que uno hecho a mano en el panel.
- **Los comandos ya están expuestos como endpoints REST** con el formato de request/response que pide el documento técnico: `POST /api/inventory/receive`, `/remove`, `/transfer`, `/reserve`, `/adjust`, y equivalentes en Compras/Proyectos/Contabilidad (ver `backend/src/routes.js`). Un workflow de N8N solo necesita:
  1. Recibir el mensaje de Telegram (nodo Telegram Trigger).
  2. Interpretar la intención con un nodo de LLM — **el LLM interpreta, nunca escribe directo sobre las tablas** (principio del PRD §5): su única salida es qué comando llamar y con qué parámetros.
  3. Llamar al endpoint REST correspondiente con `Authorization: Bearer <token>` (un usuario de servicio con el rol que corresponda) y `channel: "n8n"` en el body.
  4. Cada llamada corre en la misma transacción atómica con locking que ya usa el panel web — no hay un camino de escritura distinto para N8N.
- **Autenticación**: como cualquier otro cliente de la API, un workflow de N8N necesita loguearse primero (`POST /api/auth/login`) con un usuario dedicado (creado desde *Administración → Usuarios*) y usar el JWT resultante en cada llamada subsiguiente hasta que expire (12h).

Cuando el usuario tenga su instancia de N8N y el bot de Telegram, conectar esto es apuntar los workflows a los endpoints de arriba — no requiere cambios en el backend.

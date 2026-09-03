-- Datos semilla para operar el MVP con un catálogo y roles representativos.
-- El historial de movimientos (ingresos/salidas/transferencias, una reserva
-- activa, un ajuste pendiente) se genera aparte con `npm run seed:demo`
-- (backend/scripts/seed-demo.js), que usa los mismos comandos de la API para
-- garantizar que el stock resultante sea siempre consistente con el ledger.

INSERT INTO parametros (clave, valor, tipo_dato, descripcion) VALUES
    ('TIMEZONE', 'America/Lima', 'STRING', 'Huso horario por defecto'),
    ('STOCK_NEGATIVO_PERMITIDO', 'false', 'BOOLEAN', 'Si se permite stock negativo en salidas'),
    ('REQUIERE_APROBACION_AJUSTE', 'true', 'BOOLEAN', 'Si los ajustes requieren aprobación de supervisor');

-- ---------- Usuarios: uno por rol, para poder probar el mapa de permisos completo ----------
INSERT INTO usuarios (usuario_id, nombre_completo, email, password_hash, rol_codigo, nivel_autorizacion, activo)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'André (Admin)', 'admin@moqueguasoft.com', '$2b$10$aPbH1uIcNCDQs3b823LefOr/aBQmtyLHew9IqXNM8AL8v.tNlzgSa', 'ADMIN', 5, true),
    ('00000000-0000-0000-0000-000000000002', 'Operario Almacén', 'almacen@icr.pe', '$2b$10$Bcqb58ZgaAUTDDa.7ZoHR.dFb4wz2XXdJKurJAefFKGMN4Ndb5xrm', 'ALMACENERO', 1, true),
    ('00000000-0000-0000-0000-000000000003', 'Supervisor Almacén', 'supervisor@icr.pe', '$2b$10$G3EKaALiEa5rz26s1vmUBu18FzOXXkrgiJO2XjU6SuWP59trri0Hi', 'SUPERVISOR', 3, true),
    ('00000000-0000-0000-0000-000000000004', 'Analista de Compras', 'compras@icr.pe', '$2b$10$vetfeLQQvO/M3r5fwRY73eIqq/EBLe/y85ZjiVnsTIExeuLH.r6Pi', 'COMPRAS', 2, true),
    ('00000000-0000-0000-0000-000000000005', 'Ejecutiva de Ventas', 'ventas@icr.pe', '$2b$10$gve9uYukIFS7jTCK.A7xkOR5WQ68ZDjVVU9WbpadpmjESiJyuN/GC', 'VENTAS', 2, true),
    ('00000000-0000-0000-0000-000000000006', 'Usuario Consulta', 'consulta@icr.pe', '$2b$10$m5NE.dahaGnacEomqbhp0uIBZnv8ijpOso7CGCAnguCpyZ8vj7.MK', 'CONSULTA', 1, true);

-- ---------- Almacenes y ubicaciones ----------
INSERT INTO almacenes (almacen_id, codigo, nombre, responsable_id)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'ALM-001', 'Almacén Principal Arequipa', '00000000-0000-0000-0000-000000000003'),
    ('10000000-0000-0000-0000-000000000002', 'ALM-002', 'Almacén Secundario Arequipa', '00000000-0000-0000-0000-000000000003'),
    ('10000000-0000-0000-0000-000000000003', 'ALM-003', 'Almacén Tacna', '00000000-0000-0000-0000-000000000002'),
    ('10000000-0000-0000-0000-000000000004', 'ALM-004', 'Almacén Lima (Callao)', '00000000-0000-0000-0000-000000000003'),
    ('10000000-0000-0000-0000-000000000005', 'ALM-005', 'Almacén Cusco', '00000000-0000-0000-0000-000000000002');

INSERT INTO ubicaciones (ubicacion_id, almacen_id, codigo_ubicacion, descripcion)
VALUES
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A-01-R01-N01', 'Zona A, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'A-01-R02-N01', 'Zona A, Rack 2, Nivel 1'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'A-01-R01-N01', 'Zona A, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'B-01-R01-N01', 'Zona B, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004', 'C-01-R01-N01', 'Zona C, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000004', 'C-01-R02-N01', 'Zona C, Rack 2, Nivel 1'),
    ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000005', 'D-01-R01-N01', 'Zona D, Rack 1, Nivel 1');

-- ---------- Catálogo de productos (equipos solares / BESS) ----------
INSERT INTO productos (producto_id, sku, nombre, marca, modelo, unidad_medida, tipo_control, stock_minimo, punto_reorden, stock_maximo, costo_unitario)
VALUES
    ('30000000-0000-0000-0000-000000000001', 'PANEL-JA-550', 'Panel Solar JA Solar 550W', 'JA Solar', 'JAM72S30-550/MR', 'UND', 'NORMAL', 5, 10, 500, 650.00),
    ('30000000-0000-0000-0000-000000000002', 'INV-GROWATT-5K', 'Inversor Growatt 5kW', 'Growatt', 'MIN 5000TL-X', 'UND', 'SERIE', 1, 2, 50, 2100.00),
    ('30000000-0000-0000-0000-000000000003', 'BAT-PYLON-3.5', 'Batería BESS Pylontech 3.5kWh', 'Pylontech', 'US3000C', 'UND', 'SERIE', 1, 3, 40, 3200.00),
    ('30000000-0000-0000-0000-000000000004', 'PANEL-JINKO-450', 'Panel Solar Jinko 450W', 'Jinko Solar', 'JKM450M-60HL4', 'UND', 'NORMAL', 5, 10, 500, 520.00),
    ('30000000-0000-0000-0000-000000000005', 'INV-HUAWEI-10K', 'Inversor Huawei SUN2000 10kW', 'Huawei', 'SUN2000-10KTL-M1', 'UND', 'SERIE', 1, 2, 30, 3800.00),
    ('30000000-0000-0000-0000-000000000006', 'BAT-DEYE-5.1', 'Batería LiFePO4 Deye 5.1kWh', 'Deye', 'SE-G5.1-PRO', 'UND', 'SERIE', 1, 3, 30, 3600.00),
    ('30000000-0000-0000-0000-000000000007', 'CABLE-SOLAR-6MM', 'Cable solar fotovoltaico 6mm²', 'Genérico', 'PV1-F', 'M', 'NORMAL', 100, 200, 3000, 3.20),
    ('30000000-0000-0000-0000-000000000008', 'CONECTOR-MC4', 'Par de conectores MC4', 'Staubli', 'MC4-EVO2', 'PAR', 'NORMAL', 50, 100, 1000, 4.50),
    ('30000000-0000-0000-0000-000000000009', 'ESTRUCTURA-TECHO', 'Kit estructura de montaje para techo (10 paneles)', 'Genérico', 'RAIL-ALU-10', 'KIT', 'NORMAL', 3, 5, 60, 850.00),
    ('30000000-0000-0000-0000-000000000010', 'MONITOR-WIFI', 'Módulo de monitoreo WiFi para inversor', 'Growatt', 'ShineWiFi-X', 'UND', 'SERIE', 2, 5, 40, 180.00),
    -- Herramientas individuales (componentes de las maletas de abajo)
    ('30000000-0000-0000-0000-000000000011', 'HERR-CRIMP-MC4', 'Pinza crimpadora MC4', 'Genérico', 'PRO-CRIMP-4-6', 'UND', 'NORMAL', 2, 4, 20, 145.00),
    ('30000000-0000-0000-0000-000000000012', 'HERR-EXTRACTOR-MC4', 'Extractor de terminales MC4', 'Staubli', 'MC4-TOOL-1', 'UND', 'NORMAL', 2, 4, 20, 38.00),
    ('30000000-0000-0000-0000-000000000013', 'HERR-MULTIMETRO', 'Multímetro digital de gancho', 'Fluke', 'CL120', 'UND', 'NORMAL', 2, 3, 15, 210.00),
    ('30000000-0000-0000-0000-000000000014', 'HERR-TORQUIMETRO', 'Llave torquímetro 1/2"', 'Stanley', 'MTS0068', 'UND', 'NORMAL', 1, 2, 10, 165.00),
    ('30000000-0000-0000-0000-000000000015', 'HERR-DESTORNILLADOR', 'Set de destornilladores aislados 1000V', 'Wera', 'Kraftform-VDE', 'JGO', 'NORMAL', 2, 4, 15, 95.00),
    -- Maletas ("cajas de herramientas"): kits armados con herramientas + materiales de repuesto
    ('30000000-0000-0000-0000-000000000016', 'MALETA-MC4', 'Maleta de conectorizado MC4', 'Genérico', 'CASE-MC4-01', 'UND', 'NORMAL', 1, 2, 10, 390.00),
    ('30000000-0000-0000-0000-000000000017', 'MALETA-INSTALACION', 'Maleta de instalación eléctrica', 'Genérico', 'CASE-INST-01', 'UND', 'NORMAL', 1, 2, 10, 470.00),
    -- Ampliación del catálogo: más paneles/inversores/baterías, estructura y accesorios
    ('30000000-0000-0000-0000-000000000018', 'PANEL-CANADIAN-545', 'Panel Solar Canadian Solar 545W', 'Canadian Solar', 'CS6R-545MS', 'UND', 'NORMAL', 5, 10, 500, 630.00),
    ('30000000-0000-0000-0000-000000000019', 'PANEL-TRINA-500', 'Panel Solar Trina Vertex 500W', 'Trina Solar', 'TSM-500NEG9R', 'UND', 'NORMAL', 5, 10, 400, 600.00),
    ('30000000-0000-0000-0000-000000000020', 'INV-SUNGROW-8K', 'Inversor Sungrow 8kW híbrido', 'Sungrow', 'SH8.0RT', 'UND', 'SERIE', 1, 2, 30, 3200.00),
    ('30000000-0000-0000-0000-000000000021', 'INV-FRONIUS-3K', 'Inversor Fronius Primo 3kW', 'Fronius', 'Primo 3.0-1', 'UND', 'SERIE', 1, 2, 25, 1850.00),
    ('30000000-0000-0000-0000-000000000022', 'BAT-BYD-5.1', 'Batería BYD Battery-Box 5.1kWh', 'BYD', 'HVS 5.1', 'UND', 'SERIE', 1, 3, 25, 3450.00),
    ('30000000-0000-0000-0000-000000000023', 'ESTRUCTURA-SUELO', 'Kit estructura de montaje en suelo (20 paneles)', 'Genérico', 'RAIL-ALU-20-GND', 'KIT', 'NORMAL', 2, 4, 40, 1650.00),
    ('30000000-0000-0000-0000-000000000024', 'CABLE-SOLAR-4MM', 'Cable solar fotovoltaico 4mm²', 'Genérico', 'PV1-F-4', 'M', 'NORMAL', 100, 200, 3000, 2.40),
    ('30000000-0000-0000-0000-000000000025', 'BREAKER-DC-1000V', 'Interruptor termomagnético DC 1000V', 'Schneider', 'C60H-DC', 'UND', 'NORMAL', 10, 20, 200, 65.00),
    ('30000000-0000-0000-0000-000000000026', 'SPD-DC-1000V', 'Protector de sobretensión DC 1000V', 'Phoenix Contact', 'VAL-MS-1000DC', 'UND', 'NORMAL', 5, 10, 100, 120.00),
    ('30000000-0000-0000-0000-000000000027', 'CAJA-COMBINER-6', 'Caja combinadora de strings (6 entradas)', 'Genérico', 'PV-CB-6', 'UND', 'NORMAL', 3, 6, 40, 280.00),
    ('30000000-0000-0000-0000-000000000028', 'MONITOR-VICTRON-GX', 'Cerebro de monitoreo Victron Cerbo GX', 'Victron Energy', 'Cerbo GX', 'UND', 'SERIE', 1, 3, 20, 420.00),
    ('30000000-0000-0000-0000-000000000029', 'ARNES-SEGURIDAD', 'Arnés de seguridad para trabajo en altura', 'Genérico', 'SAFE-H1', 'UND', 'NORMAL', 3, 6, 30, 210.00),
    ('30000000-0000-0000-0000-000000000030', 'CINTA-AISLANTE-UV', 'Cinta aislante resistente a UV', 'Genérico', 'TAPE-UV-20M', 'UND', 'NORMAL', 20, 40, 300, 8.50);

-- ---------- Proveedores, clientes y proyectos de ejemplo (para probar ingreso con documento y salida con destino) ----------
INSERT INTO proveedores (proveedor_id, ruc, razon_social, contacto, activo)
VALUES
    ('40000000-0000-0000-0000-000000000001', '20100047218', 'JA Solar Perú Distribuidora S.A.C.', 'ventas@jasolarperu.example', true),
    ('40000000-0000-0000-0000-000000000002', '20605309489', 'Growatt Andina Importaciones E.I.R.L.', 'contacto@growattandina.example', true),
    ('40000000-0000-0000-0000-000000000003', '20512398761', 'Suministros Eléctricos del Sur S.A.C.', 'ventas@electrosur.example', true),
    ('40000000-0000-0000-0000-000000000004', '20601122334', 'Baterías y Almacenamiento Perú E.I.R.L.', 'contacto@bap.example', true),
    ('40000000-0000-0000-0000-000000000005', '20498765123', 'Ferretería Industrial Arequipa S.A.', 'compras@ferreind.example', true);

INSERT INTO clientes (cliente_id, ruc, razon_social, contacto, activo)
VALUES
    ('50000000-0000-0000-0000-000000000001', '20512345678', 'Constructora Vilca Hnos S.A.C.', 'proyectos@vilcahnos.example', true),
    ('50000000-0000-0000-0000-000000000002', '20487654321', 'Minera Altiplano S.A.', 'compras@mineraaltiplano.example', true),
    ('50000000-0000-0000-0000-000000000003', '20523456789', 'Agroindustrias Majes S.A.C.', 'gerencia@agromajes.example', true),
    ('50000000-0000-0000-0000-000000000004', '20534567891', 'Hotel Colca Valley S.A.C.', 'mantenimiento@colcavalley.example', true),
    ('50000000-0000-0000-0000-000000000005', '20545678912', 'Municipalidad Distrital de Yanque', 'obras@muniyanque.example', true);

INSERT INTO proyectos (proyecto_id, codigo_proyecto, nombre, cliente_id, responsable_id, presupuesto, moneda, fecha_inicio, activo)
VALUES
    ('60000000-0000-0000-0000-000000000001', 'PROY-001', 'Planta solar 50kW — Fundo Vilca', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 185000.00, 'PEN', CURRENT_DATE - INTERVAL '20 days', true),
    ('60000000-0000-0000-0000-000000000002', 'PROY-002', 'Planta solar 120kW — Minera Altiplano', '50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 420000.00, 'PEN', CURRENT_DATE - INTERVAL '8 days', true),
    ('60000000-0000-0000-0000-000000000003', 'PROY-003', 'Sistema híbrido 15kW — Hotel Colca Valley', '50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', 68000.00, 'PEN', CURRENT_DATE - INTERVAL '3 days', true);

-- ---------- Contabilidad: plan de cuentas inicial + parámetro fiscal + regla de imputación ----------
-- Subconjunto mínimo del PCGE peruano, suficiente para que el motor de
-- reglas de imputación tenga algo con qué trabajar desde el primer arranque.
INSERT INTO plan_cuentas (cuenta_id, codigo, nombre, tipo) VALUES
    ('70000000-0000-0000-0000-000000000001', '10', 'Caja y bancos', 'ACTIVO'),
    ('70000000-0000-0000-0000-000000000002', '20', 'Mercaderías', 'ACTIVO'),
    ('70000000-0000-0000-0000-000000000003', '40', 'Tributos, contraprestaciones y aportes por pagar', 'PASIVO'),
    ('70000000-0000-0000-0000-000000000004', '42', 'Cuentas por pagar comerciales — terceros', 'PASIVO'),
    ('70000000-0000-0000-0000-000000000005', '60', 'Compras', 'GASTO'),
    ('70000000-0000-0000-0000-000000000006', '69', 'Costo de ventas', 'GASTO'),
    ('70000000-0000-0000-0000-000000000007', '70', 'Ventas', 'INGRESO');

INSERT INTO parametros_fiscales (tipo, valor, vigente_desde, descripcion) VALUES
    ('IGV', 18.0000, '2024-01-01', 'Impuesto General a las Ventas — tasa general Perú'),
    ('UIT', 5350.0000, '2026-01-01', 'Unidad Impositiva Tributaria 2026');

INSERT INTO reglas_imputacion (evento, cuenta_debe_id, cuenta_haber_id, descripcion) VALUES
    ('purchases.receive', '70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000004', 'Recepción de mercadería comprada, pendiente de pago al proveedor'),
    ('sales.milestone_paid', '70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000007', 'Cobro de un hito de contrato de venta');

-- ---------- RRHH: ficha de empleado ligada a los usuarios técnicos/operativos ----------
-- El costo_hora de acá es el que Proyectos sugiere al registrar mano de obra
-- (antes había que escribirlo a mano en cada registro).
INSERT INTO empleados (empleado_id, usuario_id, nombre_completo, dni, cargo, tipo_contrato, fecha_ingreso, costo_hora, activo)
VALUES
    ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Operario Almacén', '45123456', 'Técnico de Almacén', 'PLANILLA', CURRENT_DATE - INTERVAL '400 days', 18.50, true),
    ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'Supervisor Almacén', '43987654', 'Supervisor de Operaciones', 'PLANILLA', CURRENT_DATE - INTERVAL '900 days', 32.00, true),
    ('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005', 'Ejecutiva de Ventas', '41765432', 'Coordinadora de Proyectos', 'PLANILLA', CURRENT_DATE - INTERVAL '600 days', 28.00, true),
    ('80000000-0000-0000-0000-000000000004', NULL, 'Jorge Quispe Mamani', '47234567', 'Técnico Instalador Solar', 'LOCACION', CURRENT_DATE - INTERVAL '200 days', 22.00, true),
    ('80000000-0000-0000-0000-000000000005', NULL, 'Rosa Ttito Huamán', '48345678', 'Técnica Electricista', 'LOCACION', CURRENT_DATE - INTERVAL '150 days', 24.50, true);

-- ---------- Ventas: contratos de ejemplo, uno por cada estado de hito ----------
-- PROY-001/002/003 y sus clientes ya existen (ver arriba); un contrato de
-- venta financia la obra que Proyectos ya costea de forma independiente.
INSERT INTO contratos (contrato_id, codigo_contrato, cliente_id, proyecto_id, monto_total, moneda, fecha_firma, estado, responsable_id)
VALUES
    ('90000000-0000-0000-0000-000000000001', 'CONT-00001', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 185000.00, 'PEN', CURRENT_DATE - INTERVAL '20 days', 'VIGENTE', '00000000-0000-0000-0000-000000000005'),
    ('90000000-0000-0000-0000-000000000002', 'CONT-00002', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 420000.00, 'PEN', CURRENT_DATE - INTERVAL '8 days', 'VIGENTE', '00000000-0000-0000-0000-000000000005');

INSERT INTO contrato_hitos (hito_id, contrato_id, descripcion, monto, fecha_esperada, orden, estado, fecha_pago, monto_pagado)
VALUES
    ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Adelanto 30%', 55500.00, CURRENT_DATE - INTERVAL '20 days', 1, 'PAGADO', CURRENT_DATE - INTERVAL '18 days', 55500.00),
    ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Contra avance de obra 40%', 74000.00, CURRENT_DATE + INTERVAL '10 days', 2, 'PENDIENTE', NULL, NULL),
    ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Entrega final 30%', 55500.00, CURRENT_DATE + INTERVAL '30 days', 3, 'PENDIENTE', NULL, NULL),
    ('91000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000002', 'Adelanto 50%', 210000.00, CURRENT_DATE - INTERVAL '5 days', 1, 'VENCIDO', NULL, NULL),
    ('91000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002', 'Entrega final 50%', 210000.00, CURRENT_DATE + INTERVAL '25 days', 2, 'PENDIENTE', NULL, NULL);

INSERT INTO comprobantes (comprobante_id, hito_id, tipo, serie_numero, fecha_emision, monto, registrado_por)
VALUES
    ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'FACTURA', 'F001-00123', CURRENT_DATE - INTERVAL '18 days', 55500.00, '00000000-0000-0000-0000-000000000005');

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
    ('10000000-0000-0000-0000-000000000003', 'ALM-003', 'Almacén Tacna', '00000000-0000-0000-0000-000000000002');

INSERT INTO ubicaciones (ubicacion_id, almacen_id, codigo_ubicacion, descripcion)
VALUES
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A-01-R01-N01', 'Zona A, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'A-01-R02-N01', 'Zona A, Rack 2, Nivel 1'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'A-01-R01-N01', 'Zona A, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'B-01-R01-N01', 'Zona B, Rack 1, Nivel 1');

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
    ('30000000-0000-0000-0000-000000000017', 'MALETA-INSTALACION', 'Maleta de instalación eléctrica', 'Genérico', 'CASE-INST-01', 'UND', 'NORMAL', 1, 2, 10, 470.00);

-- ---------- Proveedores, clientes y proyecto de ejemplo (para probar ingreso con documento y salida con destino) ----------
INSERT INTO proveedores (proveedor_id, ruc, razon_social, contacto, activo)
VALUES
    ('40000000-0000-0000-0000-000000000001', '20100047218', 'JA Solar Perú Distribuidora S.A.C.', 'ventas@jasolarperu.example', true),
    ('40000000-0000-0000-0000-000000000002', '20605309489', 'Growatt Andina Importaciones E.I.R.L.', 'contacto@growattandina.example', true);

INSERT INTO clientes (cliente_id, ruc, razon_social, contacto, activo)
VALUES
    ('50000000-0000-0000-0000-000000000001', '20512345678', 'Constructora Vilca Hnos S.A.C.', 'proyectos@vilcahnos.example', true),
    ('50000000-0000-0000-0000-000000000002', '20487654321', 'Minera Altiplano S.A.', 'compras@mineraaltiplano.example', true);

INSERT INTO proyectos (proyecto_id, codigo_proyecto, nombre, cliente_id, responsable_id, presupuesto, moneda, fecha_inicio, activo)
VALUES
    ('60000000-0000-0000-0000-000000000001', 'PROY-001', 'Planta solar 50kW — Fundo Vilca', '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 185000.00, 'PEN', CURRENT_DATE - INTERVAL '20 days', true);

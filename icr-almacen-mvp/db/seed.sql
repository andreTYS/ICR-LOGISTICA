-- Datos semilla mínimos para operar el MVP

INSERT INTO parametros (clave, valor, tipo_dato, descripcion) VALUES
    ('TIMEZONE', 'America/Lima', 'STRING', 'Huso horario por defecto'),
    ('STOCK_NEGATIVO_PERMITIDO', 'false', 'BOOLEAN', 'Si se permite stock negativo en salidas'),
    ('REQUIERE_APROBACION_AJUSTE', 'true', 'BOOLEAN', 'Si los ajustes requieren aprobación de supervisor');

INSERT INTO usuarios (usuario_id, nombre_completo, email, password_hash, rol_codigo, nivel_autorizacion, activo)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'André (Admin)', 'admin@moqueguasoft.com', '$2b$10$aPbH1uIcNCDQs3b823LefOr/aBQmtyLHew9IqXNM8AL8v.tNlzgSa', 'ADMIN', 5, true),
    ('00000000-0000-0000-0000-000000000002', 'Operario Almacén', 'almacen@icr.pe', '$2b$10$Bcqb58ZgaAUTDDa.7ZoHR.dFb4wz2XXdJKurJAefFKGMN4Ndb5xrm', 'ALMACENERO', 1, true),
    ('00000000-0000-0000-0000-000000000003', 'Supervisor Almacén', 'supervisor@icr.pe', '$2b$10$G3EKaALiEa5rz26s1vmUBu18FzOXXkrgiJO2XjU6SuWP59trri0Hi', 'SUPERVISOR', 3, true);

INSERT INTO almacenes (almacen_id, codigo, nombre, responsable_id)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'ALM-001', 'Almacén Principal Arequipa', '00000000-0000-0000-0000-000000000003'),
    ('10000000-0000-0000-0000-000000000002', 'ALM-002', 'Almacén Secundario', '00000000-0000-0000-0000-000000000003');

INSERT INTO ubicaciones (ubicacion_id, almacen_id, codigo_ubicacion, descripcion)
VALUES
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'A-01-R01-N01', 'Zona A, Rack 1, Nivel 1'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'A-01-R01-N01', 'Zona A, Rack 1, Nivel 1');

INSERT INTO productos (producto_id, sku, nombre, marca, modelo, unidad_medida, tipo_control, stock_minimo, punto_reorden, stock_maximo, costo_unitario)
VALUES
    ('30000000-0000-0000-0000-000000000001', 'PANEL-JA-550', 'Panel Solar JA Solar 550W', 'JA Solar', 'JAM72S30-550/MR', 'UND', 'NORMAL', 5, 10, 500, 650.00),
    ('30000000-0000-0000-0000-000000000002', 'INV-GROWATT-5K', 'Inversor Growatt 5kW', 'Growatt', 'MIN 5000TL-X', 'UND', 'SERIE', 1, 2, 50, 2100.00),
    ('30000000-0000-0000-0000-000000000003', 'BAT-PYLON-3.5', 'Batería BESS Pylontech 3.5kWh', 'Pylontech', 'US3000C', 'UND', 'SERIE', 1, 3, 40, 3200.00);

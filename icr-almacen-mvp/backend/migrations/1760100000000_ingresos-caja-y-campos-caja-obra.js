// ICR Finanzas (app de Caja de Obra) se conecta al ERP real: necesita poder
// registrar ingresos de caja manuales (nueva tabla) y guardar la persona y
// la ciudad que detecta por OCR en un gasto (columnas nuevas en gastos).
// IF NOT EXISTS/IF EXISTS a propósito: una instalación nueva ya tiene esto
// vía db/schema.sql, así que esta migración es un no-op seguro ahí — el
// cambio real es solo para instalaciones existentes (como producción).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE gastos ADD COLUMN IF NOT EXISTS persona_texto TEXT;
  `);
  pgm.sql(`
    ALTER TABLE gastos ADD COLUMN IF NOT EXISTS ciudad TEXT;
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ingresos_caja (
        ingreso_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo             TEXT NOT NULL CHECK (tipo IN ('OBRA_PROYECTO','VENTA','OTRO')),
        detalle          TEXT NOT NULL,
        monto            NUMERIC(14,2) NOT NULL CHECK (monto > 0),
        moneda           TEXT DEFAULT 'PEN',
        fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
        proyecto_id      UUID REFERENCES proyectos(proyecto_id),
        registrado_por   UUID NOT NULL REFERENCES usuarios(usuario_id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Cuenta contable + regla de imputación para el nuevo evento
  // 'income.register' — mismo criterio que la cuenta '71' que ya tiene
  // Tienda: una instalación nueva las trae de seed.sql, pero una ya existente
  // (como producción) solo las recibe acá. ON CONFLICT DO NOTHING porque
  // tanto 'codigo' en plan_cuentas como 'evento' en reglas_imputacion son
  // UNIQUE: no pisa nada si alguien ya configuró esta cuenta/regla a mano.
  pgm.sql(`
    INSERT INTO plan_cuentas (codigo, nombre, tipo)
    VALUES ('72', 'Ingresos de caja (Caja de Obra)', 'INGRESO')
    ON CONFLICT (codigo) DO NOTHING;
  `);
  pgm.sql(`
    INSERT INTO reglas_imputacion (evento, cuenta_debe_id, cuenta_haber_id, descripcion)
    SELECT 'income.register', caja.cuenta_id, ingresos_caja_cta.cuenta_id,
           'Ingreso de caja manual registrado desde ICR Finanzas (Caja de Obra)'
    FROM plan_cuentas caja, plan_cuentas ingresos_caja_cta
    WHERE caja.codigo = '10' AND ingresos_caja_cta.codigo = '72'
    ON CONFLICT (evento) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM reglas_imputacion WHERE evento = 'income.register';`);
  pgm.sql(`DELETE FROM plan_cuentas WHERE codigo = '72';`);
  pgm.sql(`DROP TABLE IF EXISTS ingresos_caja;`);
  pgm.sql(`ALTER TABLE gastos DROP COLUMN IF EXISTS ciudad;`);
  pgm.sql(`ALTER TABLE gastos DROP COLUMN IF EXISTS persona_texto;`);
};

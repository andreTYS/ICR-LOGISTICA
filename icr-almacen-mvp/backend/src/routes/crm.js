const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const crm = require("../services/crmService");

// -------- CRM / Pipeline comercial --------

router.post(
  "/crm/leads",
  requirePermission("crm.manage"),
  handle(async (req) => {
    const b = req.body;
    return crm.crearLead({
      nombreContacto: b.nombre_contacto, dni: b.dni || null, empresa: b.empresa || null, telefono: b.telefono || null, email: b.email || null,
      clienteRuc: b.cliente_ruc || null, origen: b.origen || null, montoEstimado: b.monto_estimado != null ? Number(b.monto_estimado) : null,
      moneda: b.moneda || null, fechaProximoSeguimiento: b.fecha_proximo_seguimiento || null, notas: b.notas || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/crm/leads/:codigo/stage",
  requirePermission("crm.manage"),
  handle(async (req) => crm.actualizarEtapa({
    codigo: req.params.codigo, etapa: req.body.etapa, motivoPerdida: req.body?.motivo_perdida || null,
    usuarioId: req.user.usuario_id, canal: req.body?.channel || "web",
  }))
);

router.post(
  "/crm/leads/:codigo/activities",
  requirePermission("crm.manage"),
  handle(async (req) => {
    const b = req.body;
    return crm.registrarActividad({
      codigo: req.params.codigo, tipo: b.tipo, descripcion: b.descripcion, fecha: b.fecha || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.post(
  "/crm/leads/:codigo/convert",
  requirePermission("crm.manage"),
  handle(async (req) => {
    const b = req.body;
    return crm.convertirACotizacion({
      codigo: req.params.codigo, items: b.items || [], proyectoCodigo: b.proyecto_codigo || null,
      moneda: b.moneda || null, validezDias: b.validez_dias || null,
      usuarioId: req.user.usuario_id, canal: b.channel || "web",
    });
  })
);

router.get(
  "/crm/leads",
  requirePermission("crm.query"),
  handle(async (req) => crm.listLeads({ etapa: req.query.etapa || null, page: req.query.page, pageSize: req.query.page_size }))
);

router.get(
  "/crm/leads/:codigo",
  requirePermission("crm.query"),
  handle(async (req) => crm.getLead(req.params.codigo))
);

module.exports = router;

const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const calendario = require("../services/calendarioService");

// -------- Calendario (agenda unificada de solo lectura) --------

router.get(
  "/calendar/events",
  requirePermission("calendar.query"),
  handle(async (req) => calendario.getEventos({
    desde: req.query.desde || null,
    hasta: req.query.hasta || null,
    tipos: req.query.tipos ? String(req.query.tipos).split(",") : null,
  }))
);

module.exports = router;

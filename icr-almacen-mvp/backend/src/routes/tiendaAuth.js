const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission, requireTiendaCustomer, login } = require("../auth");
const crm = require("../services/crmService");
const tiendaAuth = require("../services/tiendaAuthService");

// -------- Tienda online: cuentas de autoservicio --------
// Login/registro/historial de los visitantes de ICR-TIENDA. Igual que
// /crm/leads, el único llamador real es el servidor de Next.js de la tienda
// (nunca el navegador directo), con el token de servicio del usuario VENTAS
// — por eso registro/login piden el mismo permiso "crm.manage". El
// historial, en cambio, viaja con el JWT propio del cliente de tienda
// (tipo:'tienda', emitido por registro/login), no con el token de servicio
// — ver requireTiendaCustomer en auth.js.

router.post(
  "/tienda-auth/registro",
  requirePermission("crm.manage"),
  handle(async (req) => tiendaAuth.registrarCliente(req.body || {}))
);

router.post(
  "/tienda-auth/login",
  requirePermission("crm.manage"),
  handle(async (req) => tiendaAuth.loginCliente(req.body || {}))
);

router.post(
  "/tienda-auth/perfil",
  requireTiendaCustomer,
  handle(async (req) => tiendaAuth.actualizarPerfil(req.user.cliente_tienda_id, req.body || {}))
);

router.get(
  "/tienda-auth/pedidos",
  requireTiendaCustomer,
  handle(async (req) => tiendaAuth.obtenerPedidos(req.user.cliente_tienda_id))
);

module.exports = router;

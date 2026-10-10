const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const users = require("../services/userService");

// -------- Usuarios (solo ADMIN vía wildcard '*') --------

router.get(
  "/users",
  requirePermission("users.manage"),
  handle(async () => users.listUsers())
);

router.post(
  "/users",
  requirePermission("users.manage"),
  handle(async (req) => users.createUser(req.body))
);

router.patch(
  "/users/:id",
  requirePermission("users.manage"),
  handle(async (req) => users.updateUser(req.params.id, req.body))
);

module.exports = router;

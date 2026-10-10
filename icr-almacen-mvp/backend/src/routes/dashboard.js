const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { requirePermission } = require("../auth");
const inventory = require("../services/inventoryService");
const dashboard = require("../services/dashboardService");

// -------- Panel: tableros agregados --------

router.get(
  "/dashboard/cashflow",
  requirePermission("accounting.query"),
  handle(async (req) => dashboard.getCashflowSummary({ months: req.query.months ? Number(req.query.months) : 6 }))
);

router.get(
  "/dashboard/expenses-by-category",
  requirePermission("accounting.query"),
  handle(async (req) => dashboard.getExpensesByCategory({ days: req.query.days ? Number(req.query.days) : 30 }))
);

router.get(
  "/dashboard/stock-by-warehouse",
  requirePermission("inventory.query"),
  handle(async () => dashboard.getStockByWarehouse())
);

router.get(
  "/dashboard/projects-by-status",
  requirePermission("projects.query"),
  handle(async () => dashboard.getProjectsByStatus())
);

router.get(
  "/dashboard/top-clients",
  requirePermission("sales.query"),
  handle(async (req) => dashboard.getTopClientsBySales({ limit: req.query.limit ? Number(req.query.limit) : 5 }))
);

router.get(
  "/dashboard/top-suppliers",
  requirePermission("purchases.query"),
  handle(async (req) => dashboard.getTopSuppliersByPurchases({ limit: req.query.limit ? Number(req.query.limit) : 5 }))
);

module.exports = router;

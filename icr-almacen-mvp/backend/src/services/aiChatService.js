const { AppError } = require("../errors");
const { can } = require("../auth");
const { isModuleEnabledForRole } = require("./moduleAccessService");
const inventory = require("./inventoryService");
const compras = require("./comprasService");
const proyectos = require("./proyectosService");
const ventas = require("./ventasService");
const gastos = require("./gastosService");
const dashboard = require("./dashboardService");
const payables = require("./payablesService");
const cotizaciones = require("./cotizacionesService");
const assets = require("./assetsService");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_TOOL_CALLS = 4;

// Catálogo de herramientas de solo lectura que el asistente puede invocar.
// Cada una reusa exactamente la misma función de consulta que ya expone su
// módulo por REST — el asistente nunca toca la base directo. `permission`
// se valida con el mismo mapa de permisos (auth.can) + el switch de
// módulos que ya protege esas rutas, así el asistente respeta el rol de
// quien pregunta: nunca ve (ni puede ofrecer) más de lo que el usuario
// vería navegando el panel.
const TOOLS = [
  {
    name: "get_stock_alerts",
    description: "Lista los productos con stock por debajo del punto de reorden (alertas de stock bajo).",
    permission: "inventory.alerts.get",
    parameters: { type: "object", properties: {} },
    handler: async () => inventory.getAlerts({}),
  },
  {
    name: "get_purchase_orders_pending",
    description: "Lista las órdenes de compra en estado BORRADOR o ENVIADA (pendientes de recibir).",
    permission: "purchases.query",
    parameters: { type: "object", properties: {} },
    handler: async () => compras.getOrdenesCompra({ estado: "ENVIADA", pageSize: 50 }),
  },
  {
    name: "get_replenishment_suggestions",
    description: "Sugerencias de reabastecimiento: productos por debajo del punto de reorden con cantidad sugerida.",
    permission: "purchases.replenishment.get",
    parameters: { type: "object", properties: {} },
    handler: async () => compras.getSugerenciasReabastecimiento(),
  },
  {
    name: "get_projects_profitability",
    description: "Reporte de rentabilidad por proyecto: costo real (materiales + mano de obra + gastos) vs. presupuesto, con margen.",
    permission: "projects.query",
    parameters: { type: "object", properties: {} },
    handler: async () => proyectos.getReporteRentabilidad({}),
  },
  {
    name: "get_sales_receivables",
    description: "Cuentas por cobrar: hitos de cobro de contratos de venta pendientes o vencidos.",
    permission: "sales.query",
    parameters: { type: "object", properties: {} },
    handler: async () => ventas.listCuentasPorCobrar({}),
  },
  {
    name: "get_payables_report",
    description: "Cuentas por pagar: facturas de proveedor pendientes, parciales o vencidas.",
    permission: "payables.query",
    parameters: { type: "object", properties: {} },
    handler: async () => payables.listCuentasPorPagar({}),
  },
  {
    name: "get_expenses_by_category",
    description: "Suma de gastos operativos agrupados por categoría en una ventana de días recientes.",
    permission: "accounting.query",
    parameters: { type: "object", properties: { dias: { type: "integer", description: "Ventana de días hacia atrás (por defecto 30)." } } },
    handler: async (args) => dashboard.getExpensesByCategory({ days: args?.dias ? Number(args.dias) : 30 }),
  },
  {
    name: "get_cashflow_summary",
    description: "Ingresos (cobros de Ventas) vs. Gastos operativos por mes, últimos N meses.",
    permission: "accounting.query",
    parameters: { type: "object", properties: { meses: { type: "integer", description: "Cantidad de meses hacia atrás (por defecto 6)." } } },
    handler: async (args) => dashboard.getCashflowSummary({ months: args?.meses ? Number(args.meses) : 6 }),
  },
  {
    name: "get_quotes",
    description: "Lista de cotizaciones de Ventas, opcionalmente filtradas por estado (BORRADOR, ENVIADA, ACEPTADA, RECHAZADA, CONVERTIDA).",
    permission: "quotes.query",
    parameters: { type: "object", properties: { estado: { type: "string", description: "Estado a filtrar (opcional)." } } },
    handler: async (args) => cotizaciones.listCotizaciones({ estado: args?.estado || null, pageSize: 50 }),
  },
  {
    name: "get_assets",
    description: "Lista de activos instalados en clientes, opcionalmente filtrados por estado (OPERATIVO, EN_MANTENIMIENTO, FUERA_DE_SERVICIO, RETIRADO).",
    permission: "assets.query",
    parameters: { type: "object", properties: { estado: { type: "string", description: "Estado a filtrar (opcional)." } } },
    handler: async (args) => assets.listActivos({ estado: args?.estado || null, pageSize: 50 }),
  },
  {
    name: "get_expenses",
    description: "Lista de gastos operativos recientes, opcionalmente filtrados por categoría.",
    permission: "expenses.query",
    parameters: { type: "object", properties: { categoria: { type: "string", description: "Categoría a filtrar (opcional)." } } },
    handler: async (args) => gastos.listGastos({ categoria: args?.categoria || null, pageSize: 30 }),
  },
];

// Herramientas visibles para un rol: exige el mismo permiso Y el mismo
// switch de módulos que protege la ruta REST equivalente — ADMIN pasa
// siempre por el wildcard '*' de auth.can().
function toolsForRole(rolCodigo) {
  return TOOLS.filter((t) => {
    if (!can(rolCodigo, t.permission)) return false;
    const modulo = t.permission.split(".")[0];
    if (rolCodigo !== "ADMIN" && !isModuleEnabledForRole(modulo, rolCodigo)) return false;
    return true;
  });
}

async function executeTool(name, args, rolCodigo) {
  const tool = toolsForRole(rolCodigo).find((t) => t.name === name);
  if (!tool) {
    throw new AppError("AI_TOOL_FORBIDDEN", `Tu rol no tiene acceso a la herramienta '${name}'`, 403);
  }
  return tool.handler(args || {});
}

function buildGeminiTools(rolCodigo) {
  const declarations = toolsForRole(rolCodigo).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  return declarations.length ? [{ functionDeclarations: declarations }] : undefined;
}

const SYSTEM_INSTRUCTION = {
  parts: [{
    text: "Eres el asistente de consulta del ERP de Inversiones ICR (energía solar/BESS: almacén, compras, proyectos, ventas, gastos, contabilidad, RR.HH., cuentas por pagar, cotizaciones y activos/mantenimiento). " +
      "Respondes en español, de forma breve y concreta, basándote SIEMPRE en los datos que te devuelven las herramientas disponibles — nunca inventes cifras. " +
      "Si una pregunta requiere datos que ninguna herramienta disponible puede traer (por ejemplo porque el rol del usuario no tiene acceso a ese módulo), dilo explícitamente en vez de adivinar. " +
      "No puedes modificar nada: solo consultas de lectura.",
  }],
};

async function callGeminiApi({ apiKey, contents, tools }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_instruction: SYSTEM_INSTRUCTION, contents, tools }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || `Gemini respondió ${res.status}`;
    throw new AppError("AI_UPSTREAM_ERROR", message, 502);
  }
  return body;
}

// Conversación con function-calling: si Gemini pide ejecutar una
// herramienta, la corremos nosotros (validando permiso + switch de
// módulos del rol) y le devolvemos el resultado como functionResponse,
// hasta MAX_TOOL_CALLS rondas o hasta que responda con texto final.
async function chat({ mensaje, historial, usuarioId, rolCodigo, canal }, deps = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError("AI_NOT_CONFIGURED", "El asistente de IA no está configurado (falta GEMINI_API_KEY)", 503);
  }
  if (!mensaje || typeof mensaje !== "string") {
    throw new AppError("SCHEMA_INVALID", "mensaje es obligatorio", 400);
  }
  const callApi = deps.callGeminiApi || callGeminiApi;

  const contents = [
    ...(Array.isArray(historial) ? historial : []),
    { role: "user", parts: [{ text: mensaje }] },
  ];
  const tools = buildGeminiTools(rolCodigo);
  const herramientasUsadas = [];

  for (let round = 0; round < MAX_TOOL_CALLS; round++) {
    const response = await callApi({ apiKey, contents, tools });
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCall = parts.find((p) => p.functionCall)?.functionCall;

    if (!functionCall) {
      const text = parts.map((p) => p.text || "").join("").trim();
      return {
        respuesta: text || "No pude generar una respuesta.",
        herramientas_usadas: herramientasUsadas,
      };
    }

    contents.push({ role: "model", parts: [{ functionCall }] });
    let resultado;
    try {
      resultado = await executeTool(functionCall.name, functionCall.args, rolCodigo);
      herramientasUsadas.push(functionCall.name);
    } catch (err) {
      resultado = { error: err.message || "No se pudo ejecutar la consulta" };
    }
    contents.push({
      role: "function",
      parts: [{ functionResponse: { name: functionCall.name, response: resultado } }],
    });
  }

  throw new AppError("AI_TOO_MANY_TOOL_CALLS", "El asistente no pudo completar la respuesta en el límite de consultas permitido", 502);
}

module.exports = { chat, executeTool, toolsForRole, TOOLS };

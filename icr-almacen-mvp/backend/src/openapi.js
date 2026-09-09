const fs = require("fs");
const path = require("path");

// Generado leyendo routes.js en el momento de la request — nunca puede
// quedar desactualizado con un endpoint real porque no hay una lista
// mantenida a mano por separado. A cambio, el detalle de cada request body
// es genérico (no hay anotaciones por endpoint en el código): para el
// contrato de campos exacto, esta respuesta remite a README.md y al propio
// código de rutas.
const TAG_BY_PREFIX = [
  [/^\/openapi\.json/, "Documentación"],
  [/^\/auth/, "Autenticación"],
  [/^\/calendar/, "Calendario"],
  [/^\/settings/, "Configuración"],
  [/^\/telegram/, "Telegram"],
  [/^\/inventory/, "Almacén"],
  [/^\/purchases/, "Compras"],
  [/^\/projects/, "Proyectos"],
  [/^\/accounting/, "Contabilidad"],
  [/^\/rrhh/, "RR.HH."],
  [/^\/sales/, "Ventas"],
  [/^\/expenses/, "Gastos"],
  [/^\/payables/, "Cuentas por pagar"],
  [/^\/quotes/, "Cotizaciones"],
  [/^\/(assets|maintenance)/, "Activos y Mantenimiento"],
  [/^\/crm/, "CRM"],
  [/^\/documents/, "Gestión documental"],
  [/^\/dashboard/, "Panel"],
  [/^\/(users|admin)/, "Administración"],
  [/^\/ai/, "Asistente IA"],
];

function tagFor(routePath) {
  for (const [re, tag] of TAG_BY_PREFIX) if (re.test(routePath)) return tag;
  return "Otros";
}

// Los únicos endpoints alcanzables sin Authorization: Bearer — login (para
// obtenerlo), settings (el login lo necesita antes de autenticarse) y el
// webhook de Telegram (se autentica con su propio secret_token, no un JWT).
const PUBLIC_ROUTES = new Set(["POST /auth/login", "GET /settings", "POST /telegram/webhook", "GET /openapi.json"]);

function extractRoutes() {
  const src = fs.readFileSync(path.join(__dirname, "routes.js"), "utf8");
  const callRe = /router\.(get|post|patch|delete|put)\(/g;
  let m;
  const results = [];
  while ((m = callRe.exec(src))) {
    let depth = 1;
    let i = callRe.lastIndex;
    while (depth > 0 && i < src.length) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    const block = src.slice(m.index, i);
    const pathMatch = block.match(/"([^"]+)"/);
    if (!pathMatch) continue;
    const permMatch = block.match(/requirePermission\(\s*"([^"]+)"\s*\)/);
    results.push({ method: m[1].toUpperCase(), routePath: pathMatch[1], permission: permMatch ? permMatch[1] : null });
  }
  return results;
}

function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function paramsFor(routePath) {
  return [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map(([, name]) => ({
    name, in: "path", required: true, schema: { type: "string" },
  }));
}

function buildOpenApiSpec() {
  const routes = extractRoutes();
  const paths = {};
  for (const r of routes) {
    const key = `${r.method} ${r.routePath}`;
    const isPublic = PUBLIC_ROUTES.has(key);
    const openApiPath = toOpenApiPath(r.routePath);
    paths[openApiPath] = paths[openApiPath] || {};

    const op = {
      tags: [tagFor(r.routePath)],
      summary: r.permission
        ? `Requiere el permiso "${r.permission}"`
        : (isPublic ? "Público (sin autenticación)" : "Requiere sesión autenticada, sin permiso específico"),
      parameters: paramsFor(r.routePath),
      responses: {
        200: { description: "Comando ejecutado correctamente", content: { "application/json": { schema: { $ref: "#/components/schemas/EnvelopeSuccess" } } } },
        400: { description: "Error de validación o de negocio", content: { "application/json": { schema: { $ref: "#/components/schemas/EnvelopeError" } } } },
        401: { description: "Falta autenticación, o el token es inválido/expiró/fue revocado" },
        403: { description: "El rol no tiene este permiso, o el módulo está desactivado para el rol" },
      },
    };
    if (!isPublic) op.security = [{ bearerAuth: [] }];
    const method = r.method.toLowerCase();
    if (["post", "patch", "put", "delete"].includes(method)) {
      op.requestBody = {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: true,
              description: "Cuerpo específico de este comando. Casi todos los comandos de escritura aceptan además un campo \"channel\" (web|telegram|api|n8n) que queda registrado en la auditoría. Ver README.md y backend/src/routes.js para el detalle exacto de campos.",
            },
          },
        },
      };
    }
    paths[openApiPath][method] = op;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Inversiones ICR — ERP API",
      version: "1.0.0",
      description:
        "API REST del ERP, pensada para integraciones (N8N y similares). Todo comando de escritura acepta un campo `channel` " +
        "(`web`|`telegram`|`api`|`n8n`) que queda registrado en la auditoría, así una acción disparada desde un workflow queda " +
        "trazada igual que una hecha a mano en el panel. Autenticación con un JWT de sesión (`POST /auth/login`, vence a las 12h) " +
        "o con un token de servicio de larga duración (Administración → Tokens de servicio, prefijo `icr_`) — ambos en el header " +
        "`Authorization: Bearer <token>`. Este documento se genera leyendo las rutas reales del backend en el momento de pedirlo, " +
        "así que nunca queda desactualizado respecto a qué endpoints existen y qué permiso exige cada uno.",
    },
    servers: [{ url: "/api" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http", scheme: "bearer",
          description: "JWT de sesión (12h) o token de servicio de larga duración con prefijo icr_ (ver Administración → Tokens de servicio).",
        },
      },
      schemas: {
        EnvelopeSuccess: {
          type: "object",
          properties: { status: { type: "string", example: "success" }, data: {}, error: { nullable: true, example: null } },
        },
        EnvelopeError: {
          type: "object",
          properties: {
            status: { type: "string", example: "error" },
            data: { nullable: true, example: null },
            error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } },
          },
        },
      },
    },
    paths,
  };
}

module.exports = { buildOpenApiSpec };

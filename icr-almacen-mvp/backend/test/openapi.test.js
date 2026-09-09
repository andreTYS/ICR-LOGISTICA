// openapi.js no toca la base de datos: lee routes.js y arma el spec en
// memoria, mismo enfoque sin DB que auth.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildOpenApiSpec } = require("../src/openapi");

test("buildOpenApiSpec arma un documento OpenAPI 3.0 válido en su forma", () => {
  const spec = buildOpenApiSpec();
  assert.equal(spec.openapi, "3.0.3");
  assert.ok(spec.info.title);
  assert.ok(spec.components.securitySchemes.bearerAuth);
  assert.ok(Object.keys(spec.paths).length > 50, "debería documentar la gran mayoría de endpoints reales");
});

test("buildOpenApiSpec documenta endpoints conocidos con método y permiso correctos", () => {
  const spec = buildOpenApiSpec();
  assert.ok(spec.paths["/inventory/receive"].post);
  assert.match(spec.paths["/inventory/receive"].post.summary, /inventory\.receive/);
  assert.ok(spec.paths["/calendar/events"].get);
  assert.match(spec.paths["/calendar/events"].get.summary, /calendar\.query/);
  assert.ok(spec.paths["/admin/api-tokens"].post);
  assert.ok(spec.paths["/admin/api-tokens/{id}/revoke"].post, "los parámetros de ruta :id deben convertirse a {id}");
});

test("los endpoints públicos no llevan requisito de seguridad, el resto sí", () => {
  const spec = buildOpenApiSpec();
  assert.equal(spec.paths["/auth/login"].post.security, undefined);
  assert.equal(spec.paths["/telegram/webhook"].post.security, undefined);
  assert.deepEqual(spec.paths["/inventory/receive"].post.security, [{ bearerAuth: [] }]);
});

test("todo comando de escritura documenta un requestBody genérico", () => {
  const spec = buildOpenApiSpec();
  assert.ok(spec.paths["/inventory/receive"].post.requestBody);
  assert.ok(!spec.paths["/inventory/stock"]?.get?.requestBody, "un GET no debería llevar requestBody");
});

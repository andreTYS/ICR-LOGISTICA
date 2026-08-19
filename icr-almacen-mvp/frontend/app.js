const API = "/api";

// -------- Estilos compartidos para filas/badges generados dinámicamente --------
const TD = "px-3 py-2.5 text-sm text-slate-700";
const TD_EMPTY = "px-3 py-6 text-center text-slate-400 italic text-sm";
const TR = "even:bg-slate-50/70";
const BADGE_TONES = {
  ok: "bg-emerald-50 text-emerald-700",
  low: "bg-rose-50 text-rose-700",
  pendiente: "bg-rose-50 text-rose-700",
  ingreso: "bg-emerald-50 text-emerald-700",
  salida: "bg-rose-50 text-rose-700",
  transferencia: "bg-cyan-50 text-accent-600",
  ajuste: "bg-amber-50 text-amber-700",
  devolucion: "bg-slate-100 text-slate-600",
};
function badge(text, tone) {
  const cls = BADGE_TONES[(tone || "").toLowerCase()] || "bg-slate-100 text-slate-600";
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cls}">${text}</span>`;
}

// -------- Sesión --------
function getToken() { return localStorage.getItem("icr_token"); }
function getUser() { try { return JSON.parse(localStorage.getItem("icr_user")); } catch { return null; } }
function setSession(token, user) {
  localStorage.setItem("icr_token", token);
  localStorage.setItem("icr_user", JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem("icr_token");
  localStorage.removeItem("icr_user");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const errEl = document.getElementById("login-error");
  const submitBtn = e.target.querySelector("button[type=submit]");
  errEl.classList.add("hidden");
  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
    });
    const json = await res.json();
    if (json.status !== "success") {
      errEl.textContent = json.error?.message || "No se pudo iniciar sesión";
      errEl.classList.remove("hidden");
      return;
    }
    setSession(json.data.token, json.data.user);
    enterApp();
  } catch (err) {
    errEl.textContent = "No se pudo conectar con el servidor";
    errEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  clearSession();
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
});

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function enterApp() {
  const user = getUser();
  document.getElementById("user-name").textContent = user?.nombre_completo || "Usuario";
  document.getElementById("user-role").textContent = user?.rol_codigo || "";
  document.getElementById("user-avatar").textContent = initials(user?.nombre_completo);
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  loadWarehouseOptions();
  loadSkuOptions();
  loadDashboard();
}

// Si ya hay una sesión guardada, entrar directo
if (getToken() && getUser()) {
  enterApp();
}

// -------- Navegación --------
const titles = {
  dashboard: ["Panel general", "Resumen del estado del almacén"],
  stock: ["Stock disponible", "Existencias por producto, almacén y ubicación"],
  receive: ["Ingreso de mercadería", "Registrar entrada de stock a un almacén"],
  remove: ["Salida / despacho", "Registrar salida de stock de un almacén"],
  transfer: ["Transferencia entre almacenes", "Mover stock entre almacenes de forma atómica"],
  products: ["Productos", "Catálogo de productos gestionados"],
  movements: ["Movimientos (ledger)", "Historial completo de movimientos de inventario"],
  alerts: ["Alertas de stock bajo", "Productos por debajo del punto de reorden"],
};

function goToView(view) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  document.getElementById("view-title").textContent = titles[view][0];
  document.getElementById("view-subtitle").textContent = titles[view][1];
  if (view === "dashboard") loadDashboard();
  if (view === "stock") loadStock();
  if (view === "products") loadProducts();
  if (view === "movements") loadMovements();
  if (view === "alerts") loadAlerts();
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.view));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.goto));
});

function toast(message, ok = true) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast ${ok ? "success" : "error"}`;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 4000);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    ...options,
  });
  if (res.status === 401) {
    clearSession();
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
    throw new Error("Sesión expirada");
  }
  const json = await res.json();
  return json;
}

// -------- Datos de apoyo (almacenes / SKUs) --------
async function loadWarehouseOptions() {
  const r = await api("/inventory/warehouses");
  const opts = (r.data || []).map((w) => `<option value="${w.codigo}">${w.codigo} — ${w.nombre}</option>`).join("");
  document.querySelectorAll("select.warehouse-select").forEach((sel) => {
    sel.innerHTML = `<option value="">Selecciona un almacén…</option>${opts}`;
  });
  const stockFilter = document.getElementById("stock-warehouse");
  if (stockFilter) stockFilter.innerHTML = `<option value="">Todos los almacenes</option>${opts}`;
}

async function loadSkuOptions() {
  const r = await api("/inventory/products?q=");
  const list = document.getElementById("sku-list");
  list.innerHTML = (r.data || []).map((p) => `<option value="${p.sku}">${p.nombre}</option>`).join("");
}

// -------- Dashboard --------
async function loadDashboard() {
  const [alertsR, movR, whR, productsR] = await Promise.all([
    api("/inventory/alerts"),
    api("/inventory/movements?limit=6"),
    api("/inventory/warehouses"),
    api("/inventory/products?q="),
  ]);

  document.getElementById("kpi-products").textContent = (productsR.data || []).length;
  document.getElementById("kpi-warehouses").textContent = (whR.data || []).length;

  const since = Date.now() - 24 * 3600 * 1000;
  const allMov = await api("/inventory/movements?limit=200");
  const recentCount = (allMov.data || []).filter((m) => new Date(m.created_at).getTime() >= since).length;
  document.getElementById("kpi-movements").textContent = recentCount;

  const alertsAllowed = alertsR.status === "success";
  const alerts = alertsR.data || [];
  const alertCount = alerts.filter((a) => a.estado !== "RESUELTA").length;
  document.getElementById("kpi-alerts").textContent = alertsAllowed ? alertCount : "—";
  document.getElementById("kpi-alerts-card").classList.toggle("kpi-card-alert", alertsAllowed && alertCount > 0);
  updateAlertsBadge(alertsAllowed ? alertCount : 0);

  const movBody = document.getElementById("dash-movements-body");
  const movRows = movR.data || [];
  movBody.innerHTML = movRows.length
    ? movRows.map((m) => `<tr class="${TR}">
        <td class="${TD}">${new Date(m.created_at).toLocaleString("es-PE")}</td>
        <td class="${TD}">${movTypeBadge(m.tipo_movimiento)}</td>
        <td class="${TD}">${m.sku}</td><td class="${TD}">${m.cantidad}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="${TD_EMPTY}">Sin movimientos todavía.</td></tr>`;

  const alertBody = document.getElementById("dash-alerts-body");
  if (!alertsAllowed) {
    alertBody.innerHTML = `<tr><td colspan="3" class="${TD_EMPTY}">Tu rol no tiene permiso para ver alertas.</td></tr>`;
  } else {
    const topAlerts = alerts.filter((a) => a.estado !== "RESUELTA").slice(0, 6);
    alertBody.innerHTML = topAlerts.length
      ? topAlerts.map((a) => `<tr class="${TR}">
          <td class="${TD}">${a.sku}</td><td class="${TD}">${a.producto_nombre}</td>
          <td class="${TD}">${badge(`${a.nivel_actual} / ${a.nivel_minimo}`, "low")}</td>
        </tr>`).join("")
      : `<tr><td colspan="3" class="${TD_EMPTY}">Sin alertas activas. 🎉</td></tr>`;
  }
}

function updateAlertsBadge(count) {
  const badge = document.getElementById("alerts-badge");
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function movTypeBadge(tipo) {
  return badge(tipo, tipo);
}

// -------- Stock --------
async function loadStock() {
  const body = document.getElementById("stock-body");
  body.innerHTML = `<tr><td colspan="8" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const sku = document.getElementById("stock-sku").value.trim();
  const warehouse = document.getElementById("stock-warehouse")?.value || "";
  const params = new URLSearchParams();
  if (sku) params.set("sku", sku);
  if (warehouse) params.set("warehouse_code", warehouse);
  const qs = params.toString();
  const r = await api(`/inventory/stock${qs ? `?${qs}` : ""}`);
  body.innerHTML = "";
  (r.data || []).forEach((row) => {
    const low = Number(row.stock_disponible) <= Number(row.punto_reorden);
    body.innerHTML += `<tr class="${TR}">
      <td class="${TD}">${row.sku}</td><td class="${TD}">${row.producto_nombre}</td>
      <td class="${TD}">${row.almacen_codigo}</td><td class="${TD}">${row.codigo_ubicacion || "—"}</td>
      <td class="${TD}">${row.stock_fisico}</td><td class="${TD}">${row.stock_reservado}</td>
      <td class="${TD}">${badge(row.stock_disponible, low ? "low" : "ok")}</td>
      <td class="${TD}">${row.punto_reorden}</td>
    </tr>`;
  });
  if ((r.data || []).length === 0) body.innerHTML = `<tr><td colspan="8" class="${TD_EMPTY}">Sin resultados.</td></tr>`;
}
document.getElementById("stock-sku").addEventListener("keydown", (e) => { if (e.key === "Enter") loadStock(); });

function setFormLoading(form, loading) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = loading;
  btn.classList.toggle("loading", loading);
}

// -------- Ingreso --------
document.getElementById("form-receive").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    product: { sku: f.get("sku") },
    quantity: Number(f.get("quantity")),
    warehouse_code: f.get("warehouse_code"),
    location_code: f.get("location_code") || null,
    document: f.get("tipo_documento")
      ? { tipo_documento: f.get("tipo_documento"), numero_documento: f.get("numero_documento") }
      : null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/inventory/receive", { method: "POST", body: JSON.stringify(payload) });
    renderResult("receive-result", r);
    if (r.status === "success") { toast("Ingreso registrado correctamente"); e.target.reset(); loadDashboard(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Salida --------
document.getElementById("form-remove").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    product: { sku: f.get("sku") },
    quantity: Number(f.get("quantity")),
    warehouse_code: f.get("warehouse_code"),
    location_code: f.get("location_code") || null,
    destination: {
      proyecto_codigo: f.get("proyecto_codigo") || null,
      cliente_ruc: f.get("cliente_ruc") || null,
    },
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/inventory/remove", { method: "POST", body: JSON.stringify(payload) });
    renderResult("remove-result", r);
    if (r.status === "success") { toast("Salida registrada correctamente"); e.target.reset(); loadDashboard(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Transferencia --------
document.getElementById("form-transfer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    product: { sku: f.get("sku") },
    quantity: Number(f.get("quantity")),
    from: { warehouse_code: f.get("from_warehouse_code"), location_code: f.get("from_location_code") || null },
    to: { warehouse_code: f.get("to_warehouse_code"), location_code: f.get("to_location_code") || null },
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/inventory/transfer", { method: "POST", body: JSON.stringify(payload) });
    renderResult("transfer-result", r);
    if (r.status === "success") { toast("Transferencia registrada correctamente"); e.target.reset(); loadDashboard(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Productos --------
document.getElementById("form-product").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = Object.fromEntries(f.entries());
  payload.stock_minimo = Number(payload.stock_minimo || 0);
  payload.punto_reorden = Number(payload.punto_reorden || 0);
  setFormLoading(e.target, true);
  try {
    const r = await api("/inventory/product", { method: "POST", body: JSON.stringify(payload) });
    if (r.status === "success") { toast("Producto registrado"); e.target.reset(); loadProducts(); loadSkuOptions(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadProducts() {
  const body = document.getElementById("products-body");
  body.innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const q = document.getElementById("product-q").value.trim();
  const r = await api(`/inventory/products?q=${encodeURIComponent(q)}`);
  body.innerHTML = "";
  (r.data || []).forEach((p) => {
    body.innerHTML += `<tr class="${TR}">
      <td class="${TD}">${p.sku}</td><td class="${TD}">${p.nombre}</td><td class="${TD}">${p.marca || "—"}</td>
      <td class="${TD}">${p.tipo_control}</td><td class="${TD}">${p.punto_reorden}</td>
    </tr>`;
  });
  if ((r.data || []).length === 0) body.innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Sin resultados.</td></tr>`;
}
document.getElementById("product-q").addEventListener("keydown", (e) => { if (e.key === "Enter") loadProducts(); });

// -------- Movimientos --------
async function loadMovements() {
  const body = document.getElementById("movements-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const sku = document.getElementById("mov-sku").value.trim();
  const r = await api(`/inventory/movements${sku ? `?sku=${encodeURIComponent(sku)}` : ""}`);
  body.innerHTML = "";
  (r.data || []).forEach((m) => {
    body.innerHTML += `<tr class="${TR}">
      <td class="${TD}">${new Date(m.created_at).toLocaleString("es-PE")}</td>
      <td class="${TD}">${movTypeBadge(m.tipo_movimiento)}</td><td class="${TD}">${m.sku}</td><td class="${TD}">${m.cantidad}</td>
      <td class="${TD}">${m.almacen_origen_codigo || "—"}</td><td class="${TD}">${m.almacen_destino_codigo || "—"}</td>
    </tr>`;
  });
  if ((r.data || []).length === 0) body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Sin movimientos.</td></tr>`;
}
document.getElementById("mov-sku").addEventListener("keydown", (e) => { if (e.key === "Enter") loadMovements(); });

// -------- Alertas --------
async function loadAlerts() {
  const body = document.getElementById("alerts-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/inventory/alerts");
  if (r.status !== "success") {
    body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">${r.error?.message || "Tu rol no tiene permiso para ver alertas."}</td></tr>`;
    return;
  }
  body.innerHTML = "";
  (r.data || []).forEach((a) => {
    body.innerHTML += `<tr class="${TR}">
      <td class="${TD}">${a.sku}</td><td class="${TD}">${a.producto_nombre}</td><td class="${TD}">${a.almacen_codigo}</td>
      <td class="${TD}">${a.nivel_actual}</td><td class="${TD}">${a.nivel_minimo}</td>
      <td class="${TD}">${badge(a.estado, a.estado === "PENDIENTE" ? "low" : "ok")}</td>
    </tr>`;
  });
  if ((r.data || []).length === 0) body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">No hay alertas activas.</td></tr>`;
  updateAlertsBadge((r.data || []).filter((a) => a.estado !== "RESUELTA").length);
}

function renderResult(elId, response) {
  const el = document.getElementById(elId);
  el.className = `result-box ${response.status === "success" ? "ok" : "err"}`;
  el.innerHTML = `<pre>${JSON.stringify(response, null, 2)}</pre>`;
}

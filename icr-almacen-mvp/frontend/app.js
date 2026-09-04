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

// -------- Estados vacíos con icono --------
const EMPTY_ICONS = {
  search: '<circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.6"/><path d="m17 17-3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  check: '<circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="m6.5 10 2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  inbox: '<path d="M3 10h4.5l1.5 2.5h2L12.5 10H17" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 10 4.8 4.6A1 1 0 0 1 5.7 4h8.6a1 1 0 0 1 .95.6L17 10v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  chart: '<path d="M4 16V9M9 16V4M14 16v-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  lock: '<rect x="4" y="9" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" stroke-width="1.6"/>',
};
function emptyState(message, icon) {
  return `<div class="flex flex-col items-center justify-center gap-2 py-8 text-slate-400">
    <svg class="w-7 h-7" viewBox="0 0 20 20" fill="none">${EMPTY_ICONS[icon] || EMPTY_ICONS.inbox}</svg>
    <span class="text-sm italic">${message}</span>
  </div>`;
}
function emptyRow(colspan, message, icon) {
  return `<tr><td colspan="${colspan}" class="px-3 py-2">${emptyState(message, icon)}</td></tr>`;
}

// -------- Paginación --------
function renderPager(containerId, { total, page, pageSize }, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!total) { el.innerHTML = ""; return; }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  el.innerHTML = `
    <div class="flex items-center justify-between mt-3 text-sm text-slate-500">
      <span>Mostrando ${from}–${to} de ${total}</span>
      <div class="flex items-center gap-2">
        <button class="btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1" id="${containerId}-prev" ${page <= 1 ? "disabled" : ""}>
          <svg class="w-3 h-3" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Anterior
        </button>
        <span class="px-1 text-xs">Página ${page} de ${totalPages}</span>
        <button class="btn-secondary px-3 py-1.5 text-xs inline-flex items-center gap-1" id="${containerId}-next" ${page >= totalPages ? "disabled" : ""}>
          Siguiente
          <svg class="w-3 h-3" viewBox="0 0 20 20" fill="none"><path d="M7 4l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>`;
  if (page > 1) document.getElementById(`${containerId}-prev`).addEventListener("click", () => onChange(page - 1));
  if (page < totalPages) document.getElementById(`${containerId}-next`).addEventListener("click", () => onChange(page + 1));
}

// -------- Exportar CSV --------
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  loadSupplierOptions();
  loadEmployeeOptions();
  loadTechnicianOptions();
  loadDashboard();
}

// Si ya hay una sesión guardada, entrar directo
if (getToken() && getUser()) {
  enterApp();
}

// -------- Logo configurable --------
// Pública (no requiere sesión): la pantalla de login también debe mostrarlo.
function applyLogo(url) {
  const html = url
    ? `<img src="${url}" alt="Logo" class="w-full h-full object-cover" />`
    : "IC";
  ["login-brand-mark", "sidebar-brand-mark", "settings-logo-preview"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}
fetch(`${API}/settings`).then((r) => r.json()).then((r) => applyLogo(r.data?.logo_url)).catch(() => {});

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
  purchases: ["Órdenes de compra", "Crear, enviar y recibir órdenes de compra"],
  "purchases-replenishment": ["Reabastecimiento", "Productos por debajo del punto de reorden, con cantidad sugerida"],
  "purchases-suppliers": ["Proveedores", "Catálogo de proveedores"],
  projects: ["Proyectos", "Obras con costeo real: materiales consumidos + mano de obra vs. presupuesto"],
  "projects-clients": ["Clientes", "Catálogo de clientes"],
  "projects-profitability": ["Rentabilidad", "Costo real (materiales + mano de obra) vs. presupuesto, por proyecto"],
  "accounting-entries": ["Asientos contables", "Asientos manuales y generados automáticamente por las reglas de imputación"],
  "accounting-accounts": ["Plan de cuentas", "Estructura de cuentas contables"],
  "accounting-rules": ["Reglas de imputación", "Mapeo de eventos de negocio a cuentas debe/haber"],
  "accounting-fiscal": ["Parámetros fiscales", "Tasas versionadas por vigencia (IGV, UIT, detracción)"],
  "rrhh-employees": ["Empleados", "Fichas de personal: cargo, tipo de contrato y costo/hora"],
  "rrhh-attendance": ["Asistencia", "Marcación de entrada y salida por empleado"],
  "sales-contracts": ["Contratos", "Contratos de venta con cronograma de cobro (hitos)"],
  "sales-receivables": ["Cuentas por cobrar", "Hitos de cobro pendientes y vencidos, por contrato"],
  expenses: ["Gastos", "Gastos operativos: combustible, viáticos, alquiler, servicios, reembolsos y más"],
  reservations: ["Reservas", "Stock apartado para proyectos o clientes"],
  adjustments: ["Ajustes de inventario", "Conteos físicos pendientes de aprobación de un supervisor"],
  audit: ["Auditoría", "Registro de todas las acciones ejecutadas sobre el inventario"],
  users: ["Usuarios", "Altas y roles de acceso al panel (solo administradores)"],
  settings: ["Configuración", "Personalización del panel (solo administradores)"],
};

// Grupos de módulos del menú lateral (Almacén, Compras, Administración, …).
// Clic en el encabezado expande/colapsa; el grupo que contiene la vista
// activa se expande solo y se resalta.
function toggleNavGroup(name) {
  document.querySelector(`.nav-group[data-group="${name}"]`)?.classList.toggle("expanded");
}

function goToView(view) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  document.getElementById("view-title").textContent = titles[view][0];
  document.getElementById("view-subtitle").textContent = titles[view][1];
  document.querySelectorAll(".nav-group").forEach((g) => {
    const hasActive = !!g.querySelector(".nav-item.active");
    g.classList.toggle("has-active", hasActive);
    if (hasActive) g.classList.add("expanded");
  });
  if (view === "dashboard") loadDashboard();
  if (view === "stock") loadStock();
  if (view === "products") loadProducts();
  if (view === "movements") loadMovements();
  if (view === "alerts") loadAlerts();
  if (view === "purchases") loadPurchaseOrders(1);
  if (view === "purchases-replenishment") loadReplenishmentSuggestions();
  if (view === "purchases-suppliers") loadSuppliers();
  if (view === "projects") loadProjects(1);
  if (view === "projects-clients") loadClients();
  if (view === "projects-profitability") loadProfitabilityReport();
  if (view === "accounting-entries") loadEntries(1);
  if (view === "accounting-accounts") loadAccounts();
  if (view === "accounting-rules") loadRules();
  if (view === "accounting-fiscal") loadFiscalParams();
  if (view === "rrhh-employees") loadEmployees();
  if (view === "rrhh-attendance") { loadEmployeeOptions(); loadAttendance(); }
  if (view === "sales-contracts") loadContracts(1);
  if (view === "sales-receivables") loadReceivables();
  if (view === "expenses") loadExpenses(1);
  if (view === "reservations") loadReservations();
  if (view === "adjustments") loadAdjustments();
  if (view === "audit") loadAuditLog();
  if (view === "users") loadUsers();
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.view));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.goto));
});

function toast(message, ok = true) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${ok ? "success" : "error"}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 200);
  }, 4000);
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

// Subida de archivos (multipart) — separado de api() porque no debe fijar
// Content-Type: application/json (el navegador arma el boundary solo).
async function uploadFile(path, formData) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  if (res.status === 401) {
    clearSession();
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
    throw new Error("Sesión expirada");
  }
  return res.json();
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
  const r = await api("/inventory/products?q=&page_size=500");
  const list = document.getElementById("sku-list");
  list.innerHTML = (r.data?.items || []).map((p) => `<option value="${p.sku}">${p.nombre}</option>`).join("");
}

async function loadSupplierOptions() {
  const r = await api("/purchases/suppliers");
  const list = document.getElementById("supplier-list");
  if (!list || r.status !== "success") return;
  list.innerHTML = (r.data || []).map((s) => `<option value="${s.ruc}">${s.ruc} — ${s.razon_social}</option>`).join("");
}

async function loadTechnicianOptions() {
  const r = await api("/projects-technicians");
  if (r.status !== "success") return;
  const opts = (r.data || [])
    .map((t) => `<option value="${t.usuario_id}" data-costo-hora="${t.costo_hora_sugerido ?? ""}">${t.nombre_completo} (${t.rol_codigo})</option>`)
    .join("");
  document.querySelectorAll("select.technician-select").forEach((sel) => {
    sel.innerHTML = `<option value="">Selecciona…</option>${opts}`;
  });
  // El "usuario a vincular" del alta de empleado usa la misma lista de
  // usuarios activos (no requiere el permiso users.manage, que es solo ADMIN).
  document.querySelectorAll("select.employee-user-select").forEach((sel) => {
    sel.innerHTML = `<option value="">— Sin cuenta de acceso —</option>${opts}`;
  });
}

// Al elegir un técnico en el formulario de mano de obra, sugiere su
// costo/hora desde RRHH (empleados.costo_hora) si tiene ficha vinculada;
// el usuario puede seguir editándolo a mano si hace falta.
document.querySelectorAll("select.technician-select").forEach((sel) => {
  sel.addEventListener("change", () => {
    const form = sel.closest("form");
    const costoInput = form?.querySelector('input[name="costo_hora"]');
    if (!costoInput) return;
    const costo = sel.selectedOptions[0]?.dataset.costoHora;
    if (costo) costoInput.value = costo;
  });
});

async function loadEmployeeOptions() {
  const r = await api("/rrhh/employees?activo=true&page_size=200");
  if (r.status !== "success") return;
  const opts = (r.data.items || []).map((e) => `<option value="${e.empleado_id}">${e.nombre_completo}</option>`).join("");
  document.querySelectorAll("select.attendance-employee-select").forEach((sel) => {
    const placeholder = sel.querySelector('option[value=""]')?.outerHTML || `<option value="">Selecciona…</option>`;
    sel.innerHTML = placeholder + opts;
  });
}

// -------- Dashboard --------
async function loadDashboard() {
  const [alertsR, movR, whR, productsR] = await Promise.all([
    api("/inventory/alerts"),
    api("/inventory/movements?page_size=6"),
    api("/inventory/warehouses"),
    api("/inventory/products?q="),
  ]);

  document.getElementById("kpi-products").textContent = productsR.data?.total ?? 0;
  document.getElementById("kpi-warehouses").textContent = (whR.data || []).length;

  const since = Date.now() - 24 * 3600 * 1000;
  const allMov = await api("/inventory/movements?page_size=200");
  const recentCount = (allMov.data?.items || []).filter((m) => new Date(m.created_at).getTime() >= since).length;
  document.getElementById("kpi-movements").textContent = recentCount;

  const alertsAllowed = alertsR.status === "success";
  const alerts = alertsR.data || [];
  const alertCount = alerts.filter((a) => a.estado !== "RESUELTA").length;
  document.getElementById("kpi-alerts").textContent = alertsAllowed ? alertCount : "—";
  document.getElementById("kpi-alerts-card").classList.toggle("kpi-card-alert", alertsAllowed && alertCount > 0);
  updateAlertsBadge(alertsAllowed ? alertCount : 0);

  const movBody = document.getElementById("dash-movements-body");
  const movRows = movR.data?.items || [];
  movBody.innerHTML = movRows.length
    ? movRows.map((m) => `<tr class="${TR}">
        <td class="${TD}">${new Date(m.created_at).toLocaleString("es-PE")}</td>
        <td class="${TD}">${movTypeBadge(m.tipo_movimiento)}</td>
        <td class="${TD}">${m.sku}</td><td class="${TD}">${m.cantidad}</td>
      </tr>`).join("")
    : emptyRow(4, "Sin movimientos todavía.", "inbox");

  const alertBody = document.getElementById("dash-alerts-body");
  if (!alertsAllowed) {
    alertBody.innerHTML = emptyRow(3, "Tu rol no tiene permiso para ver alertas.", "lock");
  } else {
    const topAlerts = alerts.filter((a) => a.estado !== "RESUELTA").slice(0, 6);
    alertBody.innerHTML = topAlerts.length
      ? topAlerts.map((a) => `<tr class="${TR}">
          <td class="${TD}">${a.sku}</td><td class="${TD}">${a.producto_nombre}</td>
          <td class="${TD}">${badge(`${a.nivel_actual} / ${a.nivel_minimo}`, "low")}</td>
        </tr>`).join("")
      : emptyRow(3, "Sin alertas activas.", "check");
  }

  renderActivityChart(allMov.data?.items || []);
  loadDashboardModuleSummary();
  loadCashflowChart();
  loadExpensesCategoryChart();
  loadWorstMarginChart();
}

// Resumen de los demás módulos del ERP en el Panel. Tolerante a permisos:
// un rol sin acceso a alguno de estos módulos simplemente ve "—" ahí,
// en vez de romper el resto del dashboard.
async function loadDashboardModuleSummary() {
  const [ocEnviada, ocParcial, proyectosActivos, asientosBorrador, cuentasPorCobrar] = await Promise.all([
    api("/purchases/orders?estado=ENVIADA&page_size=1"),
    api("/purchases/orders?estado=PARCIAL&page_size=1"),
    api("/projects?estado=ACTIVO&page_size=1"),
    api("/accounting/entries?estado=BORRADOR&page_size=1"),
    api("/sales-receivables"),
  ]);
  const purchasesPending = (ocEnviada.status === "success" ? ocEnviada.data.total : 0) + (ocParcial.status === "success" ? ocParcial.data.total : 0);
  document.getElementById("kpi-purchases-pending").textContent = (ocEnviada.status === "success") ? purchasesPending : "—";
  document.getElementById("kpi-projects-active").textContent = proyectosActivos.status === "success" ? proyectosActivos.data.total : "—";
  document.getElementById("kpi-accounting-draft").textContent = asientosBorrador.status === "success" ? asientosBorrador.data.total : "—";
  document.getElementById("kpi-sales-receivables").textContent = cuentasPorCobrar.status === "success" ? cuentasPorCobrar.data.items.length : "—";
}

// -------- Gráfico de actividad (Ingresos vs Salidas, últimos 7 días) --------
// Paleta validada para 2 series categóricas (CVD-safe, ver skill dataviz):
// azul #2a78d6 = Ingresos, naranja #eb6834 = Salidas.
function renderActivityChart(movements) {
  const el = document.getElementById("activity-chart");
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const counts = days.map((d) => {
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayMov = movements.filter((m) => {
      const t = new Date(m.created_at).getTime();
      return t >= d.getTime() && t < next.getTime();
    });
    return {
      label: d.toLocaleDateString("es-PE", { weekday: "short", day: "numeric" }),
      ingresos: dayMov.filter((m) => m.tipo_movimiento === "INGRESO").length,
      salidas: dayMov.filter((m) => m.tipo_movimiento === "SALIDA").length,
    };
  });

  const max = Math.max(1, ...counts.map((c) => Math.max(c.ingresos, c.salidas)));
  const W = 700, H = 150, padBottom = 22, padTop = 8;
  const groupW = W / counts.length;
  const barW = Math.min(22, groupW / 2 - 6);
  const scale = (v) => (v / max) * (H - padBottom - padTop);
  const roundedTopBar = (x, y, w, h, r) => {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  };

  let bars = "";
  counts.forEach((c, i) => {
    const gx = i * groupW + groupW / 2;
    const x1 = gx - barW - 2;
    const x2 = gx + 2;
    const hIn = scale(c.ingresos);
    const hOut = scale(c.salidas);
    const yIn = H - padBottom - hIn;
    const yOut = H - padBottom - hOut;
    bars += `<path class="chart-bar" fill="#2a78d6" d="${roundedTopBar(x1, yIn, barW, hIn, 3)}"
        onmouseenter="showChartTip(event,'Ingresos · ${c.label}: ${c.ingresos}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"></path>`;
    bars += `<path class="chart-bar" fill="#eb6834" d="${roundedTopBar(x2, yOut, barW, hOut, 3)}"
        onmouseenter="showChartTip(event,'Salidas · ${c.label}: ${c.salidas}')" onmousemove="moveChartTip(event)" onmouseleave="hideChartTip()"></path>`;
    bars += `<line x1="${i * groupW}" y1="${H - padBottom}" x2="${(i + 1) * groupW}" y2="${H - padBottom}" stroke="#e2e8f0" stroke-width="1"/>`;
    bars += `<text x="${gx}" y="${H - 5}" text-anchor="middle" font-size="10.5" fill="#94a3b8">${c.label}</text>`;
  });

  const hasData = movements.length > 0;
  el.innerHTML = hasData
    ? `<svg viewBox="0 0 ${W} ${H}" class="w-full" style="height:170px" role="img" aria-label="Ingresos y salidas de los últimos 7 días">${bars}</svg>
       <div id="chart-tip" class="chart-tip"></div>`
    : emptyState("Sin movimientos en los últimos días.", "chart");
}

// Tooltip genérico reusado por todos los gráficos de barras del Panel (cada
// uno renderiza su propio <div id="tip-..."> dentro de su contenedor, para
// que el posicionamiento absolute sea relativo al gráfico correcto).
function showChartTip(evt, text, tipId = "chart-tip") {
  const tip = document.getElementById(tipId);
  if (!tip) return;
  tip.textContent = text;
  tip.classList.add("visible");
  moveChartTip(evt, tipId);
}
function moveChartTip(evt, tipId = "chart-tip") {
  const tip = document.getElementById(tipId);
  const container = tip?.parentElement;
  if (!tip || !container) return;
  const rect = container.getBoundingClientRect();
  tip.style.left = `${evt.clientX - rect.left}px`;
  tip.style.top = `${evt.clientY - rect.top - 10}px`;
}
function hideChartTip(tipId = "chart-tip") {
  document.getElementById(tipId)?.classList.remove("visible");
}

// -------- Tablero: Ingresos vs. Gastos (últimos 6 meses) --------
// Misma paleta validada que el gráfico de actividad (azul = dinero que
// entra, naranja = dinero que sale) — ver skill dataviz.
async function loadCashflowChart() {
  const r = await api("/dashboard/cashflow?months=6");
  const el = document.getElementById("cashflow-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  renderCashflowChart(r.data || []);
}

function renderCashflowChart(rows) {
  const el = document.getElementById("cashflow-chart");
  const points = rows.map((row) => ({
    label: new Date(row.mes).toLocaleDateString("es-PE", { month: "short", year: "2-digit" }),
    ingresos: Number(row.ingresos), gastos: Number(row.gastos),
  }));
  const max = Math.max(1, ...points.map((p) => Math.max(p.ingresos, p.gastos)));
  const W = 700, H = 170, padBottom = 22, padTop = 8;
  const groupW = W / Math.max(1, points.length);
  const barW = Math.min(34, groupW / 2 - 8);
  const scale = (v) => (v / max) * (H - padBottom - padTop);
  const roundedTopBar = (x, y, w, h, r) => {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  };

  let bars = "";
  points.forEach((pt, i) => {
    const gx = i * groupW + groupW / 2;
    const x1 = gx - barW - 2, x2 = gx + 2;
    const hIn = scale(pt.ingresos), hOut = scale(pt.gastos);
    const yIn = H - padBottom - hIn, yOut = H - padBottom - hOut;
    bars += `<path class="chart-bar" fill="#2a78d6" d="${roundedTopBar(x1, yIn, barW, hIn, 3)}"
        onmouseenter="showChartTip(event,'Ingresos · ${pt.label}: PEN ${money(pt.ingresos)}','tip-cashflow')" onmousemove="moveChartTip(event,'tip-cashflow')" onmouseleave="hideChartTip('tip-cashflow')"></path>`;
    bars += `<path class="chart-bar" fill="#eb6834" d="${roundedTopBar(x2, yOut, barW, hOut, 3)}"
        onmouseenter="showChartTip(event,'Gastos · ${pt.label}: PEN ${money(pt.gastos)}','tip-cashflow')" onmousemove="moveChartTip(event,'tip-cashflow')" onmouseleave="hideChartTip('tip-cashflow')"></path>`;
    bars += `<line x1="${i * groupW}" y1="${H - padBottom}" x2="${(i + 1) * groupW}" y2="${H - padBottom}" stroke="#e2e8f0" stroke-width="1"/>`;
    bars += `<text x="${gx}" y="${H - 5}" text-anchor="middle" font-size="10.5" fill="#94a3b8">${pt.label}</text>`;
  });

  const hasData = points.some((p) => p.ingresos > 0 || p.gastos > 0);
  el.innerHTML = hasData
    ? `<svg viewBox="0 0 ${W} ${H}" class="w-full" style="height:190px" role="img" aria-label="Ingresos y gastos de los últimos 6 meses">${bars}</svg>
       <div id="tip-cashflow" class="chart-tip"></div>`
    : emptyState("Sin cobros ni gastos registrados en este período.", "chart");
}

// -------- Tablero: Gasto por categoría (últimos 30 días) --------
// Ranking por magnitud dentro de una sola categoría visual (no identidad):
// una barra de un solo tono, con la categoría como etiqueta directa — no
// hace falta paleta categórica ni leyenda.
const EXPENSE_CATEGORY_LABELS = {
  COMBUSTIBLE: "Combustible", VIATICOS: "Viáticos", ALQUILER: "Alquiler", SERVICIOS: "Servicios",
  SOFTWARE: "Software", MANTENIMIENTO: "Mantenimiento", HONORARIOS: "Honorarios", REEMBOLSO: "Reembolso", OTROS: "Otros",
};

async function loadExpensesCategoryChart() {
  const r = await api("/dashboard/expenses-by-category?days=30");
  const el = document.getElementById("expenses-category-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  const items = r.data || [];
  if (!items.length) { el.innerHTML = emptyState("Sin gastos en los últimos 30 días.", "chart"); return; }
  const max = Math.max(...items.map((i) => i.monto));
  el.innerHTML = items.map((i) => `
    <div class="mb-2.5">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="font-semibold text-navy-950">${EXPENSE_CATEGORY_LABELS[i.categoria] || i.categoria}</span>
        <span class="text-slate-500">PEN ${money(i.monto)}</span>
      </div>
      <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full rounded-full" style="width:${Math.max(3, (i.monto / max) * 100)}%; background:#1d3557"></div>
      </div>
    </div>`).join("");
}

// -------- Tablero: Proyectos con peor margen --------
// Reusa el mismo reporte de rentabilidad que la pestaña Proyectos →
// Rentabilidad (ya viene ordenado por margen ascendente); toma los 5
// primeros. Codificación divergente (rojo = margen negativo, verde =
// positivo) — mismo criterio de color que ya usa marginClass() en la tabla.
async function loadWorstMarginChart() {
  const r = await api("/projects-profitability-report");
  const el = document.getElementById("worst-margin-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  const items = (r.data?.items || []).filter((p) => p.margen != null).slice(0, 5);
  if (!items.length) { el.innerHTML = emptyState("Sin proyectos con presupuesto definido todavía.", "chart"); return; }
  const max = Math.max(1, ...items.map((p) => Math.abs(Number(p.margen))));
  el.innerHTML = items.map((p) => {
    const margen = Number(p.margen);
    const negative = margen < 0;
    return `
    <div class="mb-2.5">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="font-semibold text-navy-950">${p.codigo_proyecto} <span class="font-normal text-slate-400">— ${p.nombre}</span></span>
        <span class="${marginClass(margen)}">${p.moneda || "PEN"} ${money(margen)}</span>
      </div>
      <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full rounded-full" style="width:${Math.max(3, (Math.abs(margen) / max) * 100)}%; background:${negative ? "#e11d48" : "#059669"}"></div>
      </div>
    </div>`;
  }).join("");
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

const OC_STATUS_TONES = { BORRADOR: "devolucion", ENVIADA: "transferencia", PARCIAL: "ajuste", RECIBIDA: "ok", CANCELADA: "low" };
function ocStatusBadge(estado) {
  return badge(estado, OC_STATUS_TONES[estado] || "devolucion");
}

const PROJECT_STATUS_TONES = { ACTIVO: "ok", PAUSADO: "ajuste", FINALIZADO: "devolucion", CANCELADO: "low" };
function projectStatusBadge(estado) {
  return badge(estado, PROJECT_STATUS_TONES[estado] || "devolucion");
}
function money(n) {
  return Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ENTRY_STATUS_TONES = { BORRADOR: "devolucion", CONTABILIZADO: "ok", ANULADO: "low" };
function entryStatusBadge(estado) {
  return badge(estado, ENTRY_STATUS_TONES[estado] || "devolucion");
}

// -------- Stock --------
function stockQuery(pageSize) {
  const sku = document.getElementById("stock-sku").value.trim();
  const warehouse = document.getElementById("stock-warehouse")?.value || "";
  const params = new URLSearchParams();
  if (sku) params.set("sku", sku);
  if (warehouse) params.set("warehouse_code", warehouse);
  if (pageSize) params.set("page_size", pageSize);
  return params;
}

function stockRowHtml(row) {
  const low = Number(row.stock_disponible) <= Number(row.punto_reorden);
  return `<tr class="${TR} row-clickable" onclick="openKardex('${row.sku}')" title="Ver Kardex de ${row.sku}">
      <td class="${TD}">${row.sku}</td><td class="${TD}">${row.producto_nombre}</td>
      <td class="${TD}">${row.almacen_codigo}</td><td class="${TD}">${row.codigo_ubicacion || "—"}</td>
      <td class="${TD}">${row.stock_fisico}</td><td class="${TD}">${row.stock_reservado}</td>
      <td class="${TD}">${badge(row.stock_disponible, low ? "low" : "ok")}</td>
      <td class="${TD}">${row.punto_reorden}</td>
    </tr>`;
}

async function loadStock(page = 1) {
  const body = document.getElementById("stock-body");
  body.innerHTML = `<tr><td colspan="8" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const params = stockQuery();
  params.set("page", page);
  const r = await api(`/inventory/stock?${params.toString()}`);
  const items = r.data?.items || [];
  body.innerHTML = items.length ? items.map(stockRowHtml).join("") : emptyRow(8, "Sin resultados.", "search");
  renderPager("stock-pager", r.data || { total: 0 }, loadStock);
}
document.getElementById("stock-sku").addEventListener("keydown", (e) => { if (e.key === "Enter") loadStock(); });

async function exportStockCsv() {
  const params = stockQuery(2000);
  const r = await api(`/inventory/stock?${params.toString()}`);
  const items = r.data?.items || [];
  downloadCsv(
    "stock.csv",
    ["SKU", "Producto", "Almacén", "Ubicación", "Físico", "Reservado", "Disponible", "P. reorden"],
    items.map((row) => [row.sku, row.producto_nombre, row.almacen_codigo, row.codigo_ubicacion || "", row.stock_fisico, row.stock_reservado, row.stock_disponible, row.punto_reorden])
  );
}

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
  if (!confirm(`¿Confirmas la salida de ${payload.quantity} × ${payload.product.sku} desde ${payload.warehouse_code}?`)) return;
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
  if (!confirm(`¿Confirmas transferir ${payload.quantity} × ${payload.product.sku} de ${payload.from.warehouse_code} a ${payload.to.warehouse_code}?`)) return;
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

function productThumbHtml(p) {
  return p.imagen_url
    ? `<img src="${p.imagen_url}" class="w-9 h-9 rounded-lg object-cover border border-slate-200" alt="${p.sku}" />`
    : `<span class="w-9 h-9 rounded-lg bg-slate-100 text-slate-300 flex items-center justify-center border border-slate-200">
        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6"/><circle cx="7.5" cy="8.5" r="1.3" stroke="currentColor" stroke-width="1.4"/><path d="m5 14 3.5-3.5L11 13l2-2 2 2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </span>`;
}

async function loadProducts(page = 1) {
  const body = document.getElementById("products-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const q = document.getElementById("product-q").value.trim();
  const r = await api(`/inventory/products?q=${encodeURIComponent(q)}&page=${page}`);
  const items = r.data?.items || [];
  body.innerHTML = items.length
    ? items.map((p) => `<tr class="${TR} row-clickable" onclick="openKardex('${p.sku}')" title="Ver Kardex de ${p.sku}">
      <td class="${TD}">${productThumbHtml(p)}</td>
      <td class="${TD}">${p.sku}${p.es_kit ? ` ${badge("KIT", "transferencia")}` : ""}</td><td class="${TD}">${p.nombre}</td><td class="${TD}">${p.marca || "—"}</td>
      <td class="${TD}">${p.tipo_control}</td><td class="${TD}">${p.punto_reorden}</td>
      <td class="${TD}"><button class="btn-secondary px-3 py-1.5 text-xs" onclick="event.stopPropagation(); triggerPhotoUpload('${p.sku}')">Subir foto</button></td>
    </tr>`).join("")
    : emptyRow(7, "Sin resultados.", "search");
  renderPager("products-pager", r.data || { total: 0 }, loadProducts);
}

function triggerPhotoUpload(sku) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.onchange = async () => {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append("photo", input.files[0]);
    const r = await uploadFile(`/inventory/products/${encodeURIComponent(sku)}/photo`, fd);
    if (r.status === "success") { toast("Foto actualizada"); loadProducts(); }
    else toast(r.error.message, false);
  };
  input.click();
}
document.getElementById("product-q").addEventListener("keydown", (e) => { if (e.key === "Enter") loadProducts(); });

// -------- Movimientos --------
function movRowHtml(m) {
  return `<tr class="${TR}">
      <td class="${TD}">${new Date(m.created_at).toLocaleString("es-PE")}</td>
      <td class="${TD}">${movTypeBadge(m.tipo_movimiento)}</td><td class="${TD}">${m.sku}</td><td class="${TD}">${m.cantidad}</td>
      <td class="${TD}">${m.almacen_origen_codigo || "—"}</td><td class="${TD}">${m.almacen_destino_codigo || "—"}</td>
    </tr>`;
}

async function loadMovements(page = 1) {
  const body = document.getElementById("movements-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const sku = document.getElementById("mov-sku").value.trim();
  const params = new URLSearchParams({ page });
  if (sku) params.set("sku", sku);
  const r = await api(`/inventory/movements?${params.toString()}`);
  const items = r.data?.items || [];
  body.innerHTML = items.length ? items.map(movRowHtml).join("") : emptyRow(6, "Sin movimientos.", "inbox");
  renderPager("movements-pager", r.data || { total: 0 }, loadMovements);
}
document.getElementById("mov-sku").addEventListener("keydown", (e) => { if (e.key === "Enter") loadMovements(); });

async function exportMovementsCsv() {
  const sku = document.getElementById("mov-sku").value.trim();
  const params = new URLSearchParams({ page_size: 2000 });
  if (sku) params.set("sku", sku);
  const r = await api(`/inventory/movements?${params.toString()}`);
  const items = r.data?.items || [];
  downloadCsv(
    "movimientos.csv",
    ["Fecha", "Tipo", "SKU", "Cantidad", "Origen", "Destino"],
    items.map((m) => [new Date(m.created_at).toLocaleString("es-PE"), m.tipo_movimiento, m.sku, m.cantidad, m.almacen_origen_codigo || "", m.almacen_destino_codigo || ""])
  );
}

// -------- Alertas --------
async function loadAlerts() {
  const body = document.getElementById("alerts-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/inventory/alerts");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver alertas.", "lock");
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
  if ((r.data || []).length === 0) body.innerHTML = emptyRow(6, "No hay alertas activas.", "check");
  updateAlertsBadge((r.data || []).filter((a) => a.estado !== "RESUELTA").length);
}

function renderResult(elId, response) {
  const el = document.getElementById(elId);
  el.className = `result-box ${response.status === "success" ? "ok" : "err"}`;
  el.innerHTML = `<pre>${JSON.stringify(response, null, 2)}</pre>`;
}

// -------- Compras --------
let ocDraftItems = [];
let currentOcNumero = null;

function renderOcDraftItems() {
  const body = document.getElementById("oc-draft-items-body");
  body.innerHTML = ocDraftItems.length
    ? ocDraftItems.map((it, i) => `<tr class="${TR}">
        <td class="${TD}">${it.sku}</td><td class="${TD}">${it.quantity}</td>
        <td class="${TD}">${it.unit_cost ?? "—"}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="removeOcDraftItem(${i})">Quitar</button></td>
      </tr>`).join("")
    : emptyRow(4, "Agrega al menos una línea antes de crear la orden.", "inbox");
}

function addOcDraftItem() {
  const sku = document.getElementById("oc-item-sku").value.trim();
  const quantity = Number(document.getElementById("oc-item-qty").value);
  const costRaw = document.getElementById("oc-item-cost").value;
  if (!sku || !quantity || quantity <= 0) { toast("Ingresa un SKU y una cantidad válida", false); return; }
  ocDraftItems.push({ sku, quantity, unit_cost: costRaw ? Number(costRaw) : undefined });
  document.getElementById("oc-item-sku").value = "";
  document.getElementById("oc-item-qty").value = "";
  document.getElementById("oc-item-cost").value = "";
  renderOcDraftItems();
}
function removeOcDraftItem(i) {
  ocDraftItems.splice(i, 1);
  renderOcDraftItems();
}
renderOcDraftItems();

document.getElementById("form-oc-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocDraftItems.length === 0) { toast("Agrega al menos una línea a la orden", false); return; }
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    proveedor_ruc: f.get("proveedor_ruc"),
    warehouse_code: f.get("warehouse_code"),
    fecha_esperada: f.get("fecha_esperada") || null,
    observaciones: f.get("observaciones") || null,
    items: ocDraftItems,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/purchases/orders", { method: "POST", body: JSON.stringify(payload) });
    renderResult("oc-create-result", r);
    if (r.status === "success") {
      toast(`Orden ${r.data.numero} creada en BORRADOR`);
      e.target.reset();
      ocDraftItems = [];
      renderOcDraftItems();
      loadPurchaseOrders(1);
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadReplenishmentSuggestions() {
  const body = document.getElementById("replenishment-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/purchases/replenishment-suggestions");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver sugerencias.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((s) => `<tr class="${TR}">
        <td class="${TD}">${s.sku}</td><td class="${TD}">${s.producto_nombre}</td>
        <td class="${TD}">${s.almacen_codigo}</td><td class="${TD}">${badge(s.stock_disponible, "low")}</td>
        <td class="${TD}">${s.punto_reorden}</td><td class="${TD}">${s.cantidad_sugerida}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="prefillOcFromSuggestion('${s.sku}', ${s.cantidad_sugerida})">Agregar a la orden</button></td>
      </tr>`).join("")
    : emptyRow(7, "Todo el stock está por encima del punto de reorden.", "check");
}

function prefillOcFromSuggestion(sku, cantidad) {
  ocDraftItems.push({ sku, quantity: Number(cantidad) });
  renderOcDraftItems();
  goToView("purchases");
  document.getElementById("form-oc-create").scrollIntoView({ behavior: "smooth", block: "center" });
  toast(`${sku} agregado a la orden en construcción`);
}

async function loadPurchaseOrders(page) {
  const body = document.getElementById("purchases-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("oc-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/purchases/orders?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver órdenes de compra.", "lock");
    document.getElementById("purchases-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((oc) => `<tr class="${TR} cursor-pointer" onclick="openOcModal('${oc.numero}')">
        <td class="${TD} font-semibold text-navy-900">${oc.numero}</td>
        <td class="${TD}">${oc.proveedor_nombre}</td><td class="${TD}">${oc.almacen_codigo}</td>
        <td class="${TD}">${new Date(oc.created_at).toLocaleDateString("es-PE")}</td>
        <td class="${TD}">${ocStatusBadge(oc.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openOcModal('${oc.numero}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(6, "Sin órdenes de compra registradas.", "inbox");
  renderPager("purchases-pager", r.data, (p) => loadPurchaseOrders(p));
  updatePurchasesBadge(items.filter((oc) => oc.estado === "ENVIADA" || oc.estado === "PARCIAL").length);
}

function updatePurchasesBadge(count) {
  const el = document.getElementById("purchases-badge");
  if (count > 0) { el.textContent = count > 99 ? "99+" : count; el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}

async function openOcModal(numero) {
  currentOcNumero = numero;
  const modal = document.getElementById("oc-modal");
  document.getElementById("oc-modal-title").textContent = numero;
  document.getElementById("oc-modal-subtitle").textContent = "Cargando…";
  document.getElementById("oc-items-body").innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("oc-receptions-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("oc-receive-result").innerHTML = "";
  modal.classList.remove("hidden");

  const r = await api(`/purchases/orders/${encodeURIComponent(numero)}`);
  if (r.status !== "success") {
    document.getElementById("oc-modal-subtitle").textContent = r.error?.message || "No se pudo cargar la orden";
    return;
  }
  const oc = r.data;
  document.getElementById("oc-modal-subtitle").innerHTML = `${oc.proveedor_nombre} · ${oc.almacen_codigo} · ${ocStatusBadge(oc.estado)}`;

  const canReceive = oc.estado === "ENVIADA" || oc.estado === "PARCIAL";
  document.getElementById("oc-send-btn").classList.toggle("hidden", oc.estado !== "BORRADOR");
  document.getElementById("oc-cancel-btn").classList.toggle("hidden", oc.estado === "RECIBIDA" || oc.estado === "CANCELADA");
  document.getElementById("form-oc-receive").classList.toggle("hidden", !canReceive);

  const itemsBody = document.getElementById("oc-items-body");
  itemsBody.innerHTML = (oc.items || []).map((it) => `<tr class="${TR}">
      <td class="${TD}">${it.sku}</td><td class="${TD}">${it.producto_nombre}</td>
      <td class="${TD}">${it.cantidad_pedida}</td><td class="${TD}">${it.cantidad_recibida}</td>
      <td class="${TD}">${it.cantidad_pendiente}</td>
      <td class="${TD}">${canReceive && Number(it.cantidad_pendiente) > 0
        ? `<input type="number" min="0" max="${it.cantidad_pendiente}" step="0.01" class="field oc-receive-qty" data-sku="${it.sku}" placeholder="0" />`
        : "—"}</td>
    </tr>`).join("");

  const recBody = document.getElementById("oc-receptions-body");
  recBody.innerHTML = (oc.recepciones || []).length
    ? oc.recepciones.map((rec) => `<tr class="${TR}">
        <td class="${TD}">${new Date(rec.created_at).toLocaleString("es-PE")}</td>
        <td class="${TD}">${rec.numero_documento ? `${rec.tipo_documento} ${rec.numero_documento}` : "—"}</td>
        <td class="${TD}">${rec.usuario_nombre}</td>
        <td class="${TD}">${rec.items.map((i) => `${i.sku} ×${i.cantidad}`).join(", ")}</td>
      </tr>`).join("")
    : emptyRow(4, "Sin recepciones registradas todavía.", "inbox");
}

function closeOcModal() {
  document.getElementById("oc-modal").classList.add("hidden");
  currentOcNumero = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOcModal(); });

async function sendOcAction() {
  if (!currentOcNumero) return;
  if (!confirm(`¿Enviar la orden ${currentOcNumero} al proveedor?`)) return;
  const r = await api(`/purchases/orders/${encodeURIComponent(currentOcNumero)}/send`, { method: "POST" });
  if (r.status === "success") { toast("Orden enviada"); openOcModal(currentOcNumero); loadPurchaseOrders(1); }
  else toast(r.error.message, false);
}

async function cancelOcAction() {
  if (!currentOcNumero) return;
  if (!confirm(`¿Cancelar la orden ${currentOcNumero}? Esta acción no se puede deshacer.`)) return;
  const r = await api(`/purchases/orders/${encodeURIComponent(currentOcNumero)}/cancel`, { method: "POST" });
  if (r.status === "success") { toast("Orden cancelada"); openOcModal(currentOcNumero); loadPurchaseOrders(1); }
  else toast(r.error.message, false);
}

document.getElementById("form-oc-receive").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentOcNumero) return;
  const f = new FormData(e.target);
  const items = Array.from(document.querySelectorAll(".oc-receive-qty"))
    .map((input) => ({ sku: input.dataset.sku, quantity: Number(input.value) }))
    .filter((it) => it.quantity > 0);
  if (items.length === 0) { toast("Ingresa la cantidad a recibir en al menos una línea", false); return; }
  const numeroDocumento = f.get("numero_documento");
  const payload = {
    channel: "web",
    items,
    document: numeroDocumento ? { tipo_documento: f.get("tipo_documento"), numero_documento: numeroDocumento } : null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api(`/purchases/orders/${encodeURIComponent(currentOcNumero)}/receive`, { method: "POST", body: JSON.stringify(payload) });
    renderResult("oc-receive-result", r);
    if (r.status === "success") {
      toast(`Recepción registrada — orden ${r.data.orden_compra.estado}`);
      e.target.reset();
      openOcModal(currentOcNumero);
      loadPurchaseOrders(1);
      loadDashboard();
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Compras: proveedores --------
document.getElementById("form-supplier-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { channel: "web", ruc: f.get("ruc"), razon_social: f.get("razon_social"), contacto: f.get("contacto") || null };
  setFormLoading(e.target, true);
  try {
    const r = await api("/purchases/suppliers", { method: "POST", body: JSON.stringify(payload) });
    renderResult("supplier-create-result", r);
    if (r.status === "success") { toast(`Proveedor ${r.data.proveedor.razon_social} creado`); e.target.reset(); loadSuppliers(); loadSupplierOptions(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadSuppliers() {
  const body = document.getElementById("suppliers-body");
  body.innerHTML = `<tr><td colspan="3" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/purchases/suppliers");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(3, r.error?.message || "Tu rol no tiene permiso para ver proveedores.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((s) => `<tr class="${TR}"><td class="${TD}">${s.ruc}</td><td class="${TD}">${s.razon_social}</td><td class="${TD}">${s.contacto || "—"}</td></tr>`).join("")
    : emptyRow(3, "Sin proveedores registrados.", "inbox");
}

// -------- Proyectos --------
let currentProjectCodigo = null;

document.getElementById("form-project-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    codigo_proyecto: f.get("codigo_proyecto"),
    nombre: f.get("nombre"),
    cliente_ruc: f.get("cliente_ruc") || null,
    presupuesto: f.get("presupuesto") || null,
    fecha_inicio: f.get("fecha_inicio") || null,
    fecha_fin: f.get("fecha_fin") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/projects", { method: "POST", body: JSON.stringify(payload) });
    renderResult("project-create-result", r);
    if (r.status === "success") { toast(`Proyecto ${r.data.proyecto.codigo_proyecto} creado`); e.target.reset(); loadProjects(1); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadProjects(page) {
  const body = document.getElementById("projects-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("project-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/projects?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver proyectos.", "lock");
    document.getElementById("projects-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((p) => `<tr class="${TR} cursor-pointer" onclick="openProjectModal('${p.codigo_proyecto}')">
        <td class="${TD} font-semibold text-navy-900">${p.codigo_proyecto}</td>
        <td class="${TD}">${p.nombre}</td><td class="${TD}">${p.cliente_nombre || "—"}</td>
        <td class="${TD}">${p.presupuesto != null ? `${p.moneda || "PEN"} ${money(p.presupuesto)}` : "—"}</td>
        <td class="${TD}">${projectStatusBadge(p.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openProjectModal('${p.codigo_proyecto}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(6, "Sin proyectos registrados.", "inbox");
  renderPager("projects-pager", r.data, (p) => loadProjects(p));
}

function costeoCard(label, value, tone) {
  return `<div class="rounded-xl border border-slate-200 px-4 py-3">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">${label}</div>
    <div class="text-lg font-bold ${tone || "text-navy-950"}">${value}</div>
  </div>`;
}

async function openProjectModal(codigo) {
  currentProjectCodigo = codigo;
  const modal = document.getElementById("proj-modal");
  document.getElementById("proj-modal-title").textContent = codigo;
  document.getElementById("proj-modal-subtitle").textContent = "Cargando…";
  document.getElementById("proj-costeo-cards").innerHTML = "";
  document.getElementById("proj-materials-body").innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("proj-labor-body").innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("proj-expenses-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("proj-expenses-hint").textContent = codigo;
  document.getElementById("project-labor-result").innerHTML = "";
  modal.classList.remove("hidden");

  const r = await api(`/projects/${encodeURIComponent(codigo)}`);
  if (r.status !== "success") {
    document.getElementById("proj-modal-subtitle").textContent = r.error?.message || "No se pudo cargar el proyecto";
    return;
  }
  const p = r.data;
  document.getElementById("proj-modal-subtitle").innerHTML = `${p.nombre} ${p.cliente_nombre ? `· ${p.cliente_nombre}` : ""} · ${projectStatusBadge(p.estado)}`;

  const isTerminal = p.estado === "FINALIZADO" || p.estado === "CANCELADO";
  document.getElementById("proj-status-actions").querySelectorAll("button[onclick^='setProjectStatus']").forEach((btn) => {
    const target = btn.getAttribute("onclick").match(/'([A-Z]+)'/)[1];
    btn.classList.toggle("hidden", target === p.estado || isTerminal);
  });
  document.getElementById("form-project-labor").classList.toggle("hidden", p.estado === "CANCELADO");

  const c = p.costeo;
  document.getElementById("proj-costeo-cards").innerHTML = [
    costeoCard("Materiales", `${p.moneda || "PEN"} ${money(c.costo_materiales)}`),
    costeoCard("Mano de obra", `${p.moneda || "PEN"} ${money(c.costo_mano_obra)}`),
    costeoCard("Gastos", `${p.moneda || "PEN"} ${money(c.costo_gastos)}`),
    costeoCard("Costo total", `${p.moneda || "PEN"} ${money(c.costo_total)}`, "text-navy-950"),
    c.presupuesto != null
      ? costeoCard("Margen vs. presupuesto", `${p.moneda || "PEN"} ${money(c.margen)}`, c.margen >= 0 ? "text-emerald-600" : "text-rose-600")
      : costeoCard("Presupuesto", "Sin definir", "text-slate-400"),
  ].join("");

  const matBody = document.getElementById("proj-materials-body");
  matBody.innerHTML = (p.materiales || []).length
    ? p.materiales.map((m) => `<tr class="${TR}">
        <td class="${TD}">${m.sku}</td><td class="${TD}">${m.producto_nombre}</td>
        <td class="${TD}">${m.cantidad_total}</td><td class="${TD}">${money(m.costo_unitario)}</td><td class="${TD}">${money(m.subtotal)}</td>
      </tr>`).join("")
    : emptyRow(5, "Sin materiales consumidos todavía.", "inbox");

  const laborBody = document.getElementById("proj-labor-body");
  laborBody.innerHTML = (p.mano_obra || []).length
    ? p.mano_obra.map((m) => `<tr class="${TR}">
        <td class="${TD}">${new Date(m.fecha).toLocaleDateString("es-PE")}</td><td class="${TD}">${m.tecnico_nombre}</td>
        <td class="${TD}">${m.horas}</td><td class="${TD}">${money(m.costo_hora)}</td>
        <td class="${TD}">${money(m.horas * m.costo_hora)}</td><td class="${TD}">${m.descripcion || "—"}</td>
      </tr>`).join("")
    : emptyRow(6, "Sin horas registradas todavía.", "inbox");

  const expensesBody = document.getElementById("proj-expenses-body");
  expensesBody.innerHTML = (p.gastos || []).length
    ? p.gastos.map((g) => `<tr class="${TR}">
        <td class="${TD}">${new Date(g.fecha).toLocaleDateString("es-PE")}</td><td class="${TD}">${g.categoria}</td>
        <td class="${TD}">${g.descripcion}</td><td class="${TD}">${money(g.monto)}</td>
      </tr>`).join("")
    : emptyRow(4, "Sin gastos registrados todavía.", "inbox");
}

function closeProjectModal() {
  document.getElementById("proj-modal").classList.add("hidden");
  currentProjectCodigo = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProjectModal(); });

async function setProjectStatus(estado) {
  if (!currentProjectCodigo) return;
  const labels = { ACTIVO: "reactivar", PAUSADO: "pausar", FINALIZADO: "finalizar", CANCELADO: "cancelar" };
  if (!confirm(`¿Confirmas ${labels[estado] || estado.toLowerCase()} el proyecto ${currentProjectCodigo}?`)) return;
  const r = await api(`/projects/${encodeURIComponent(currentProjectCodigo)}/status`, { method: "POST", body: JSON.stringify({ estado }) });
  if (r.status === "success") { toast(`Proyecto ${estado.toLowerCase()}`); openProjectModal(currentProjectCodigo); loadProjects(1); }
  else toast(r.error.message, false);
}

document.getElementById("form-project-labor").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentProjectCodigo) return;
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    tecnico_id: f.get("tecnico_id"),
    fecha: f.get("fecha") || null,
    horas: Number(f.get("horas")),
    costo_hora: Number(f.get("costo_hora")),
    descripcion: f.get("descripcion") || null,
  };
  if (!payload.tecnico_id) { toast("Selecciona un técnico", false); return; }
  setFormLoading(e.target, true);
  try {
    const r = await api(`/projects/${encodeURIComponent(currentProjectCodigo)}/labor`, { method: "POST", body: JSON.stringify(payload) });
    renderResult("project-labor-result", r);
    if (r.status === "success") { toast("Horas registradas"); e.target.reset(); openProjectModal(currentProjectCodigo); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Proyectos: clientes --------
document.getElementById("form-client-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { channel: "web", ruc: f.get("ruc"), razon_social: f.get("razon_social"), contacto: f.get("contacto") || null };
  setFormLoading(e.target, true);
  try {
    const r = await api("/projects-clients", { method: "POST", body: JSON.stringify(payload) });
    renderResult("client-create-result", r);
    if (r.status === "success") { toast(`Cliente ${r.data.cliente.razon_social} creado`); e.target.reset(); loadClients(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadClients() {
  const body = document.getElementById("clients-body");
  body.innerHTML = `<tr><td colspan="3" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/projects-clients");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(3, r.error?.message || "Tu rol no tiene permiso para ver clientes.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((c) => `<tr class="${TR}"><td class="${TD}">${c.ruc}</td><td class="${TD}">${c.razon_social}</td><td class="${TD}">${c.contacto || "—"}</td></tr>`).join("")
    : emptyRow(3, "Sin clientes registrados.", "inbox");
}

// -------- Proyectos: rentabilidad --------
function marginClass(n) {
  return Number(n) < 0 ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold";
}

async function fetchProfitabilityReport() {
  const estado = document.getElementById("profitability-filter-estado").value;
  const params = estado ? `?estado=${encodeURIComponent(estado)}` : "";
  return api(`/projects-profitability-report${params}`);
}

async function loadProfitabilityReport() {
  const body = document.getElementById("profitability-body");
  body.innerHTML = `<tr><td colspan="9" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("profitability-cards").innerHTML = "";
  const r = await fetchProfitabilityReport();
  if (r.status !== "success") {
    body.innerHTML = emptyRow(9, r.error?.message || "Tu rol no tiene permiso para ver el reporte de rentabilidad.", "lock");
    return;
  }
  const { items, totales } = r.data;

  document.getElementById("profitability-cards").innerHTML = [
    costeoCard("Presupuesto total (proyectos con presupuesto)", money(totales.presupuesto)),
    costeoCard("Costo real total", money(totales.costo_total)),
    costeoCard("Margen agregado", money(totales.margen), marginClass(totales.margen)),
  ].join("");

  body.innerHTML = items.length
    ? items.map((p) => `<tr class="${TR}">
        <td class="${TD} font-semibold text-navy-900">${p.codigo_proyecto}</td><td class="${TD}">${p.nombre}</td>
        <td class="${TD}">${p.cliente_nombre || "—"}</td>
        <td class="${TD}">${p.presupuesto != null ? money(p.presupuesto) : "—"}</td>
        <td class="${TD}">${money(p.costo_materiales)}</td><td class="${TD}">${money(p.costo_mano_obra)}</td>
        <td class="${TD}">${money(p.costo_total)}</td>
        <td class="${TD} ${p.margen != null ? marginClass(p.margen) : ""}">${p.margen != null ? money(p.margen) : "—"}</td>
        <td class="${TD} ${p.margen_pct != null ? marginClass(p.margen_pct) : ""}">${p.margen_pct != null ? `${p.margen_pct}%` : "—"}</td>
      </tr>`).join("")
    : emptyRow(9, "Sin proyectos para este filtro.", "inbox");
}

async function exportProfitabilityCsv() {
  const r = await fetchProfitabilityReport();
  const items = r.data?.items || [];
  downloadCsv(
    "rentabilidad-proyectos.csv",
    ["Código", "Nombre", "Cliente", "Presupuesto", "Materiales", "Mano de obra", "Costo total", "Margen", "Margen %"],
    items.map((p) => [p.codigo_proyecto, p.nombre, p.cliente_nombre || "", p.presupuesto ?? "", p.costo_materiales, p.costo_mano_obra, p.costo_total, p.margen ?? "", p.margen_pct ?? ""])
  );
}

// -------- Contabilidad: plan de cuentas --------
document.getElementById("form-account-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web", codigo: f.get("codigo"), nombre: f.get("nombre"), tipo: f.get("tipo"),
    cuenta_padre_codigo: f.get("cuenta_padre_codigo") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/accounting/accounts", { method: "POST", body: JSON.stringify(payload) });
    renderResult("account-create-result", r);
    if (r.status === "success") { toast(`Cuenta ${r.data.cuenta.codigo} creada`); e.target.reset(); loadAccounts(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadAccounts() {
  const body = document.getElementById("accounts-body");
  body.innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/accounting/accounts");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(4, r.error?.message || "Tu rol no tiene permiso para ver el plan de cuentas.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((c) => `<tr class="${TR}">
        <td class="${TD} font-semibold text-navy-900">${c.codigo}</td><td class="${TD}">${c.nombre}</td>
        <td class="${TD}">${c.tipo}</td><td class="${TD}">${c.cuenta_padre_codigo ? `${c.cuenta_padre_codigo} — ${c.cuenta_padre_nombre}` : "—"}</td>
      </tr>`).join("")
    : emptyRow(4, "Sin cuentas registradas todavía.", "inbox");
}

// -------- Contabilidad: reglas de imputación --------
document.getElementById("form-rule-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web", evento: f.get("evento"), descripcion: f.get("descripcion") || null,
    cuenta_debe_codigo: f.get("cuenta_debe_codigo"), cuenta_haber_codigo: f.get("cuenta_haber_codigo"),
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/accounting/rules", { method: "POST", body: JSON.stringify(payload) });
    renderResult("rule-create-result", r);
    if (r.status === "success") { toast(`Regla para '${r.data.regla.evento}' guardada`); e.target.reset(); loadRules(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadRules() {
  const body = document.getElementById("rules-body");
  body.innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/accounting/rules");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(5, r.error?.message || "Tu rol no tiene permiso para ver las reglas.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((rule) => `<tr class="${TR}">
        <td class="${TD} font-semibold text-navy-900">${rule.evento}</td>
        <td class="${TD}">${rule.cuenta_debe_codigo} — ${rule.cuenta_debe_nombre}</td>
        <td class="${TD}">${rule.cuenta_haber_codigo} — ${rule.cuenta_haber_nombre}</td>
        <td class="${TD}">${badge(rule.activo ? "ACTIVA" : "INACTIVA", rule.activo ? "ok" : "devolucion")}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="toggleRuleAction('${rule.evento}', ${!rule.activo})">${rule.activo ? "Desactivar" : "Activar"}</button></td>
      </tr>`).join("")
    : emptyRow(5, "Sin reglas de imputación registradas.", "inbox");
}

async function toggleRuleAction(evento, nuevoActivo) {
  const r = await api(`/accounting/rules/${encodeURIComponent(evento)}/toggle`, { method: "POST", body: JSON.stringify({ activo: nuevoActivo }) });
  if (r.status === "success") { toast(`Regla '${evento}' ${nuevoActivo ? "activada" : "desactivada"}`); loadRules(); }
  else toast(r.error.message, false);
}

// -------- Contabilidad: parámetros fiscales --------
document.getElementById("form-fiscal-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web", tipo: f.get("tipo"), valor: f.get("valor"),
    vigente_desde: f.get("vigente_desde"), vigente_hasta: f.get("vigente_hasta") || null,
    descripcion: f.get("descripcion") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/accounting/fiscal-params", { method: "POST", body: JSON.stringify(payload) });
    renderResult("fiscal-create-result", r);
    if (r.status === "success") { toast(`Parámetro ${r.data.parametro.tipo} guardado`); e.target.reset(); loadFiscalParams(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadFiscalParams() {
  const body = document.getElementById("fiscal-params-body");
  body.innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/accounting/fiscal-params");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(5, r.error?.message || "Tu rol no tiene permiso para ver los parámetros fiscales.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((p) => `<tr class="${TR}">
        <td class="${TD} font-semibold text-navy-900">${p.tipo}</td><td class="${TD}">${money(p.valor)}</td>
        <td class="${TD}">${new Date(p.vigente_desde).toLocaleDateString("es-PE")}</td>
        <td class="${TD}">${p.vigente_hasta ? new Date(p.vigente_hasta).toLocaleDateString("es-PE") : "Vigente"}</td>
        <td class="${TD}">${p.descripcion || "—"}</td>
      </tr>`).join("")
    : emptyRow(5, "Sin parámetros fiscales registrados.", "inbox");
}

// -------- Contabilidad: asientos --------
let entryDraftLines = [];
let currentEntryNumero = null;

function renderEntryDraftLines() {
  const body = document.getElementById("entry-draft-lines-body");
  body.innerHTML = entryDraftLines.length
    ? entryDraftLines.map((l, i) => `<tr class="${TR}">
        <td class="${TD}">${l.cuenta_codigo}</td><td class="${TD}">${l.debe || "—"}</td><td class="${TD}">${l.haber || "—"}</td>
        <td class="${TD}">${l.proyecto_codigo || "—"}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="removeEntryDraftLine(${i})">Quitar</button></td>
      </tr>`).join("")
    : emptyRow(5, "Agrega al menos 2 líneas (debe y haber) antes de crear el asiento.", "inbox");
  const totalDebe = entryDraftLines.reduce((s, l) => s + Number(l.debe || 0), 0);
  const totalHaber = entryDraftLines.reduce((s, l) => s + Number(l.haber || 0), 0);
  const balanced = Math.abs(totalDebe - totalHaber) < 0.01;
  document.getElementById("entry-draft-balance").innerHTML =
    `Debe: ${money(totalDebe)} · Haber: ${money(totalHaber)} · ${balanced ? '<span class="text-emerald-600 font-semibold">Cuadra</span>' : '<span class="text-rose-600 font-semibold">No cuadra</span>'}`;
}

function addEntryDraftLine() {
  const cuenta = document.getElementById("entry-line-cuenta").value.trim();
  const debe = Number(document.getElementById("entry-line-debe").value || 0);
  const haber = Number(document.getElementById("entry-line-haber").value || 0);
  const proyecto = document.getElementById("entry-line-proyecto").value.trim();
  if (!cuenta || (debe <= 0 && haber <= 0) || (debe > 0 && haber > 0)) {
    toast("Ingresa una cuenta y un monto en debe O en haber (no ambos)", false);
    return;
  }
  entryDraftLines.push({ cuenta_codigo: cuenta, debe: debe || undefined, haber: haber || undefined, proyecto_codigo: proyecto || undefined });
  document.getElementById("entry-line-cuenta").value = "";
  document.getElementById("entry-line-debe").value = "";
  document.getElementById("entry-line-haber").value = "";
  document.getElementById("entry-line-proyecto").value = "";
  renderEntryDraftLines();
}
function removeEntryDraftLine(i) {
  entryDraftLines.splice(i, 1);
  renderEntryDraftLines();
}
renderEntryDraftLines();

document.getElementById("form-entry-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (entryDraftLines.length < 2) { toast("Agrega al menos 2 líneas al asiento", false); return; }
  const f = new FormData(e.target);
  const payload = { channel: "web", glosa: f.get("glosa"), fecha: f.get("fecha") || null, lineas: entryDraftLines };
  setFormLoading(e.target, true);
  try {
    const r = await api("/accounting/entries", { method: "POST", body: JSON.stringify(payload) });
    renderResult("entry-create-result", r);
    if (r.status === "success") {
      toast(`Asiento ${r.data.numero} creado en BORRADOR`);
      e.target.reset();
      entryDraftLines = [];
      renderEntryDraftLines();
      loadEntries(1);
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadEntries(page) {
  const body = document.getElementById("entries-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("entry-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/accounting/entries?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver asientos.", "lock");
    document.getElementById("entries-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((a) => `<tr class="${TR} cursor-pointer" onclick="openEntryModal('${a.numero}')">
        <td class="${TD} font-semibold text-navy-900">${a.numero}</td>
        <td class="${TD}">${new Date(a.fecha).toLocaleDateString("es-PE")}</td><td class="${TD}">${a.glosa}</td>
        <td class="${TD}">${a.origen_evento || "Manual"}</td><td class="${TD}">${money(a.total)}</td>
        <td class="${TD}">${entryStatusBadge(a.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openEntryModal('${a.numero}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(7, "Sin asientos registrados.", "inbox");
  renderPager("entries-pager", r.data, (p) => loadEntries(p));
}

async function openEntryModal(numero) {
  currentEntryNumero = numero;
  const modal = document.getElementById("entry-modal");
  document.getElementById("entry-modal-title").textContent = numero;
  document.getElementById("entry-modal-subtitle").textContent = "Cargando…";
  document.getElementById("entry-lines-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  modal.classList.remove("hidden");

  const r = await api(`/accounting/entries/${encodeURIComponent(numero)}`);
  if (r.status !== "success") {
    document.getElementById("entry-modal-subtitle").textContent = r.error?.message || "No se pudo cargar el asiento";
    return;
  }
  const a = r.data;
  document.getElementById("entry-modal-subtitle").innerHTML = `${a.glosa} · ${new Date(a.fecha).toLocaleDateString("es-PE")} · ${entryStatusBadge(a.estado)}`;
  document.getElementById("entry-post-btn").classList.toggle("hidden", a.estado !== "BORRADOR");
  document.getElementById("entry-void-btn").classList.toggle("hidden", a.estado === "ANULADO");

  document.getElementById("entry-lines-body").innerHTML = (a.lineas || []).map((l) => `<tr class="${TR}">
      <td class="${TD}">${l.cuenta_codigo} — ${l.cuenta_nombre}</td>
      <td class="${TD}">${Number(l.debe) > 0 ? money(l.debe) : "—"}</td>
      <td class="${TD}">${Number(l.haber) > 0 ? money(l.haber) : "—"}</td>
      <td class="${TD}">${l.codigo_proyecto || "—"}</td>
    </tr>`).join("");
}

function closeEntryModal() {
  document.getElementById("entry-modal").classList.add("hidden");
  currentEntryNumero = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEntryModal(); });

async function postEntryAction() {
  if (!currentEntryNumero) return;
  if (!confirm(`¿Contabilizar el asiento ${currentEntryNumero}? Ya no se podrá editar.`)) return;
  const r = await api(`/accounting/entries/${encodeURIComponent(currentEntryNumero)}/post`, { method: "POST" });
  if (r.status === "success") { toast("Asiento contabilizado"); openEntryModal(currentEntryNumero); loadEntries(1); }
  else toast(r.error.message, false);
}

async function voidEntryAction() {
  if (!currentEntryNumero) return;
  if (!confirm(`¿Anular el asiento ${currentEntryNumero}?`)) return;
  const r = await api(`/accounting/entries/${encodeURIComponent(currentEntryNumero)}/void`, { method: "POST" });
  if (r.status === "success") { toast("Asiento anulado"); openEntryModal(currentEntryNumero); loadEntries(1); }
  else toast(r.error.message, false);
}

// -------- RRHH: empleados --------
document.getElementById("form-employee-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    nombre_completo: f.get("nombre_completo"),
    dni: f.get("dni") || null,
    cargo: f.get("cargo") || null,
    tipo_contrato: f.get("tipo_contrato") || null,
    fecha_ingreso: f.get("fecha_ingreso") || null,
    costo_hora: f.get("costo_hora") || null,
    usuario_vinculado_id: f.get("usuario_vinculado_id") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/rrhh/employees", { method: "POST", body: JSON.stringify(payload) });
    renderResult("employee-create-result", r);
    if (r.status === "success") {
      toast(`Empleado ${r.data.empleado.nombre_completo} creado`);
      e.target.reset();
      loadEmployees();
      loadEmployeeOptions();
      loadTechnicianOptions();
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadEmployees() {
  const body = document.getElementById("employees-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/rrhh/employees?page_size=200");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver empleados.", "lock");
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((emp) => `<tr class="${TR}">
        <td class="${TD}">${emp.nombre_completo}</td><td class="${TD}">${emp.cargo || "—"}</td>
        <td class="${TD}">${emp.tipo_contrato || "—"}</td><td class="${TD}">${emp.costo_hora != null ? money(emp.costo_hora) : "—"}</td>
        <td class="${TD}">${emp.usuario_email || "—"}</td>
        <td class="${TD}">
          <button class="${emp.activo ? "btn-danger" : "btn-secondary"} px-3 py-1.5 text-xs" onclick="toggleEmployeeActive('${emp.empleado_id}', ${!emp.activo})">
            ${emp.activo ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>`).join("")
    : emptyRow(6, "Sin empleados registrados.", "inbox");
}

async function toggleEmployeeActive(empleadoId, nextActive) {
  const r = await api(`/rrhh/employees/${empleadoId}`, { method: "PUT", body: JSON.stringify({ channel: "web", activo: nextActive }) });
  if (r.status === "success") { toast(`Empleado ${nextActive ? "activado" : "desactivado"}`); loadEmployees(); loadEmployeeOptions(); loadTechnicianOptions(); }
  else toast(r.error.message, false);
}

// -------- RRHH: asistencia --------
function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle("loading", loading);
}

document.getElementById("btn-check-in").addEventListener("click", async (e) => {
  const btn = e.currentTarget; // capturado antes del await: currentTarget se anula una vez despachado el evento
  const form = document.getElementById("form-attendance-mark");
  const empleadoId = new FormData(form).get("empleado_id");
  if (!empleadoId) { toast("Selecciona un empleado", false); return; }
  setButtonLoading(btn, true);
  try {
    const r = await api("/rrhh/attendance/check-in", { method: "POST", body: JSON.stringify({ channel: "web", empleado_id: empleadoId }) });
    renderResult("attendance-mark-result", r);
    if (r.status === "success") { toast("Entrada registrada"); loadAttendance(); }
    else toast(r.error.message, false);
  } finally {
    setButtonLoading(btn, false);
  }
});

document.getElementById("btn-check-out").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const form = document.getElementById("form-attendance-mark");
  const empleadoId = new FormData(form).get("empleado_id");
  if (!empleadoId) { toast("Selecciona un empleado", false); return; }
  setButtonLoading(btn, true);
  try {
    const r = await api("/rrhh/attendance/check-out", { method: "POST", body: JSON.stringify({ channel: "web", empleado_id: empleadoId }) });
    renderResult("attendance-mark-result", r);
    if (r.status === "success") { toast(`Salida registrada — ${r.data.asistencia.horas_trabajadas}h trabajadas`); loadAttendance(); }
    else toast(r.error.message, false);
  } finally {
    setButtonLoading(btn, false);
  }
});

async function loadAttendance(page) {
  const body = document.getElementById("attendance-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const empleadoId = document.getElementById("attendance-filter-empleado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 30 });
  if (empleadoId) params.set("empleado_id", empleadoId);
  const r = await api(`/rrhh/attendance?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver asistencia.", "lock");
    document.getElementById("attendance-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((a) => `<tr class="${TR}">
        <td class="${TD}">${new Date(a.fecha).toLocaleDateString("es-PE")}</td><td class="${TD}">${a.empleado_nombre}</td>
        <td class="${TD}">${a.hora_entrada ? new Date(a.hora_entrada).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
        <td class="${TD}">${a.hora_salida ? new Date(a.hora_salida).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
        <td class="${TD}">${a.horas_trabajadas != null ? a.horas_trabajadas : "—"}</td>
        <td class="${TD} text-xs text-slate-500">${a.observaciones || "—"}</td>
      </tr>`).join("")
    : emptyRow(6, "Sin registros de asistencia.", "inbox");
  renderPager("attendance-pager", r.data, (p) => loadAttendance(p));
}

// -------- Ventas: contratos --------
let hitoDraftLines = [];
let currentContractCodigo = null;
let currentPayHitoId = null;

function renderHitoDraftLines() {
  const body = document.getElementById("hito-draft-lines-body");
  body.innerHTML = hitoDraftLines.length
    ? hitoDraftLines.map((h, i) => `<tr class="${TR}">
        <td class="${TD}">${h.descripcion}</td><td class="${TD}">${money(h.monto)}</td>
        <td class="${TD}">${h.fecha_esperada || "—"}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="removeHitoDraftLine(${i})">Quitar</button></td>
      </tr>`).join("")
    : emptyRow(4, "Opcional: agrega un cronograma de hitos de cobro (puedes agregarlos después también).", "inbox");
}

function addHitoDraftLine() {
  const descripcion = document.getElementById("hito-line-descripcion").value.trim();
  const monto = Number(document.getElementById("hito-line-monto").value || 0);
  const fecha = document.getElementById("hito-line-fecha").value;
  if (!descripcion || monto <= 0) { toast("Ingresa descripción y monto (>0) del hito", false); return; }
  hitoDraftLines.push({ descripcion, monto, fecha_esperada: fecha || undefined });
  document.getElementById("hito-line-descripcion").value = "";
  document.getElementById("hito-line-monto").value = "";
  document.getElementById("hito-line-fecha").value = "";
  renderHitoDraftLines();
}
function removeHitoDraftLine(i) {
  hitoDraftLines.splice(i, 1);
  renderHitoDraftLines();
}
renderHitoDraftLines();

document.getElementById("form-contract-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    codigo_contrato: f.get("codigo_contrato"),
    cliente_ruc: f.get("cliente_ruc"),
    proyecto_codigo: f.get("proyecto_codigo") || null,
    monto_total: Number(f.get("monto_total")),
    fecha_firma: f.get("fecha_firma") || null,
    hitos: hitoDraftLines,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/sales/contracts", { method: "POST", body: JSON.stringify(payload) });
    renderResult("contract-create-result", r);
    if (r.status === "success") {
      toast(`Contrato ${r.data.contrato.codigo_contrato} creado`);
      e.target.reset();
      hitoDraftLines = [];
      renderHitoDraftLines();
      loadContracts(1);
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

const CONTRACT_STATUS_TONES = { BORRADOR: "pendiente", VIGENTE: "ok", FINALIZADO: "devolucion", CANCELADO: "low" };
function contractStatusBadge(estado) {
  return badge(estado, CONTRACT_STATUS_TONES[estado] || "devolucion");
}
const MILESTONE_STATUS_TONES = { PENDIENTE: "pendiente", PAGADO: "ok", VENCIDO: "low", ANULADO: "devolucion" };
function milestoneStatusBadge(estado) {
  return badge(estado, MILESTONE_STATUS_TONES[estado] || "devolucion");
}

async function loadContracts(page) {
  const body = document.getElementById("contracts-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("contract-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/sales/contracts?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver contratos.", "lock");
    document.getElementById("contracts-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((c) => `<tr class="${TR} cursor-pointer" onclick="openContractModal('${c.codigo_contrato}')">
        <td class="${TD} font-semibold text-navy-900">${c.codigo_contrato}</td><td class="${TD}">${c.cliente_nombre || "—"}</td>
        <td class="${TD}">${c.codigo_proyecto || "—"}</td><td class="${TD}">${c.moneda || "PEN"} ${money(c.monto_total)}</td>
        <td class="${TD}">${c.moneda || "PEN"} ${money(c.monto_cobrado)}</td><td class="${TD}">${contractStatusBadge(c.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openContractModal('${c.codigo_contrato}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(7, "Sin contratos registrados.", "inbox");
  renderPager("contracts-pager", r.data, (p) => loadContracts(p));
}

async function openContractModal(codigo) {
  currentContractCodigo = codigo;
  currentPayHitoId = null;
  const modal = document.getElementById("contract-modal");
  document.getElementById("contract-modal-title").textContent = codigo;
  document.getElementById("contract-modal-subtitle").textContent = "Cargando…";
  document.getElementById("contract-summary-cards").innerHTML = "";
  document.getElementById("contract-milestones-body").innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("milestone-add-result").innerHTML = "";
  closeMilestonePayForm();
  modal.classList.remove("hidden");

  const r = await api(`/sales/contracts/${encodeURIComponent(codigo)}`);
  if (r.status !== "success") {
    document.getElementById("contract-modal-subtitle").textContent = r.error?.message || "No se pudo cargar el contrato";
    return;
  }
  const c = r.data;
  document.getElementById("contract-modal-subtitle").innerHTML = `${c.cliente_nombre || "—"} ${c.codigo_proyecto ? `· Proyecto ${c.codigo_proyecto}` : ""} · ${contractStatusBadge(c.estado)}`;

  const isTerminal = c.estado === "FINALIZADO" || c.estado === "CANCELADO";
  document.getElementById("contract-status-actions").querySelectorAll("button[onclick^='setContractStatus']").forEach((btn) => {
    const target = btn.getAttribute("onclick").match(/'([A-Z]+)'/)[1];
    btn.classList.toggle("hidden", target === c.estado || isTerminal);
  });
  document.getElementById("form-milestone-add").classList.toggle("hidden", isTerminal);

  document.getElementById("contract-summary-cards").innerHTML = [
    costeoCard("Monto total", `${c.moneda || "PEN"} ${money(c.monto_total)}`),
    costeoCard("Cobrado", `${c.moneda || "PEN"} ${money(c.monto_cobrado)}`, "text-emerald-600"),
    costeoCard("Saldo pendiente", `${c.moneda || "PEN"} ${money(c.saldo_pendiente)}`, c.saldo_pendiente > 0 ? "text-rose-600" : "text-navy-950"),
  ].join("");

  const body = document.getElementById("contract-milestones-body");
  body.innerHTML = (c.hitos || []).length
    ? c.hitos.map((h) => {
        const comprobantesTxt = (h.comprobantes || []).map((cp) => `${cp.tipo} ${cp.serie_numero}`).join(", ");
        const payable = h.estado === "PENDIENTE" || h.estado === "VENCIDO";
        return `<tr class="${TR}">
          <td class="${TD}">${h.descripcion}</td><td class="${TD}">${money(h.monto)}</td>
          <td class="${TD}">${h.fecha_esperada ? new Date(h.fecha_esperada).toLocaleDateString("es-PE") : "—"}</td>
          <td class="${TD}">${milestoneStatusBadge(h.estado)}</td>
          <td class="${TD} text-xs text-slate-500">${comprobantesTxt || "—"}</td>
          <td class="${TD}">${payable ? `<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="openMilestonePayForm('${h.hito_id}', ${h.monto})">Registrar pago</button>` : "—"}</td>
        </tr>`;
      }).join("")
    : emptyRow(6, "Sin hitos registrados todavía.", "inbox");
}

function closeContractModal() {
  document.getElementById("contract-modal").classList.add("hidden");
  currentContractCodigo = null;
  currentPayHitoId = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeContractModal(); });

async function setContractStatus(estado) {
  if (!currentContractCodigo) return;
  const labels = { VIGENTE: "reactivar", FINALIZADO: "finalizar", CANCELADO: "cancelar" };
  if (!confirm(`¿Confirmas ${labels[estado] || estado.toLowerCase()} el contrato ${currentContractCodigo}?`)) return;
  const r = await api(`/sales/contracts/${encodeURIComponent(currentContractCodigo)}/status`, { method: "POST", body: JSON.stringify({ channel: "web", estado }) });
  if (r.status === "success") { toast(`Contrato ${estado.toLowerCase()}`); openContractModal(currentContractCodigo); loadContracts(1); }
  else toast(r.error.message, false);
}

function openMilestonePayForm(hitoId, montoSugerido) {
  currentPayHitoId = hitoId;
  const form = document.getElementById("form-milestone-pay");
  form.classList.remove("hidden");
  form.querySelector('input[name="monto_pagado"]').value = montoSugerido;
  document.getElementById("milestone-pay-result").innerHTML = "";
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeMilestonePayForm() {
  currentPayHitoId = null;
  const form = document.getElementById("form-milestone-pay");
  form.classList.add("hidden");
  form.reset();
}

document.getElementById("form-milestone-pay").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentContractCodigo || !currentPayHitoId) return;
  const f = new FormData(e.target);
  const tipo = f.get("comprobante_tipo");
  const payload = {
    channel: "web",
    monto_pagado: f.get("monto_pagado") ? Number(f.get("monto_pagado")) : null,
    fecha_pago: f.get("fecha_pago") || null,
    comprobante: tipo ? { tipo, serie_numero: f.get("comprobante_serie_numero"), fecha_emision: null } : null,
  };
  if (payload.comprobante && !payload.comprobante.serie_numero) { toast("Ingresa la serie-número del comprobante", false); return; }
  setFormLoading(e.target, true);
  try {
    const r = await api(`/sales/contracts/${encodeURIComponent(currentContractCodigo)}/milestones/${encodeURIComponent(currentPayHitoId)}/pay`, { method: "POST", body: JSON.stringify(payload) });
    renderResult("milestone-pay-result", r);
    if (r.status === "success") {
      toast("Pago registrado");
      closeMilestonePayForm();
      openContractModal(currentContractCodigo);
      loadContracts(1);
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

document.getElementById("form-milestone-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentContractCodigo) return;
  const f = new FormData(e.target);
  const payload = { channel: "web", descripcion: f.get("descripcion"), monto: Number(f.get("monto")), fecha_esperada: f.get("fecha_esperada") || null };
  setFormLoading(e.target, true);
  try {
    const r = await api(`/sales/contracts/${encodeURIComponent(currentContractCodigo)}/milestones`, { method: "POST", body: JSON.stringify(payload) });
    renderResult("milestone-add-result", r);
    if (r.status === "success") { toast("Hito agregado"); e.target.reset(); openContractModal(currentContractCodigo); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Ventas: cuentas por cobrar --------
async function fetchReceivables() {
  const estado = document.getElementById("receivables-filter-estado").value;
  const params = estado ? `?estado=${encodeURIComponent(estado)}` : "";
  return api(`/sales-receivables${params}`);
}

async function loadReceivables() {
  const body = document.getElementById("receivables-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("receivables-cards").innerHTML = "";
  const r = await fetchReceivables();
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver cuentas por cobrar.", "lock");
    return;
  }
  const { items, totales } = r.data;
  document.getElementById("receivables-cards").innerHTML = [
    costeoCard("Pendiente", `PEN ${money(totales.pendiente)}`, "text-amber-600"),
    costeoCard("Vencido", `PEN ${money(totales.vencido)}`, totales.vencido > 0 ? "text-rose-600" : "text-navy-950"),
  ].join("");
  body.innerHTML = items.length
    ? items.map((h) => `<tr class="${TR} cursor-pointer" onclick="openContractModal('${h.codigo_contrato}')">
        <td class="${TD} font-semibold text-navy-900">${h.codigo_contrato}</td><td class="${TD}">${h.cliente_nombre || "—"}</td>
        <td class="${TD}">${h.descripcion}</td><td class="${TD}">${money(h.monto)}</td>
        <td class="${TD}">${h.fecha_esperada ? new Date(h.fecha_esperada).toLocaleDateString("es-PE") : "—"}</td>
        <td class="${TD}">${milestoneStatusBadge(h.estado)}</td>
      </tr>`).join("")
    : emptyRow(6, "Sin cuentas por cobrar pendientes o vencidas.", "check");
}

async function exportReceivablesCsv() {
  const r = await fetchReceivables();
  const items = r.data?.items || [];
  downloadCsv(
    "cuentas-por-cobrar.csv",
    ["Contrato", "Cliente", "Hito", "Monto", "Fecha esperada", "Estado"],
    items.map((h) => [h.codigo_contrato, h.cliente_nombre || "", h.descripcion, h.monto, h.fecha_esperada || "", h.estado])
  );
}

// -------- Gastos --------
const EXPENSE_CATEGORY_TONES = { COMBUSTIBLE: "transferencia", VIATICOS: "transferencia", ALQUILER: "ajuste", SERVICIOS: "ajuste", SOFTWARE: "transferencia", MANTENIMIENTO: "ajuste", HONORARIOS: "devolucion", REEMBOLSO: "pendiente", OTROS: "devolucion" };
function expenseCategoryBadge(categoria) {
  return badge(EXPENSE_CATEGORY_LABELS[categoria] || categoria, EXPENSE_CATEGORY_TONES[categoria] || "devolucion");
}

document.getElementById("form-expense-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const tipo = f.get("comprobante_tipo");
  const payload = {
    channel: "web",
    categoria: f.get("categoria"),
    descripcion: f.get("descripcion"),
    monto: Number(f.get("monto")),
    fecha: f.get("fecha") || null,
    proyecto_codigo: f.get("proyecto_codigo") || null,
    empleado_id: f.get("empleado_id") || null,
    comprobante: tipo ? { tipo, serie_numero: f.get("comprobante_serie_numero") } : null,
  };
  if (payload.comprobante && !payload.comprobante.serie_numero) { toast("Ingresa la serie-número del comprobante", false); return; }
  setFormLoading(e.target, true);
  try {
    const r = await api("/expenses", { method: "POST", body: JSON.stringify(payload) });
    renderResult("expense-create-result", r);
    if (r.status === "success") {
      toast(`Gasto de ${money(r.data.gasto.monto)} registrado`);
      e.target.reset();
      loadExpenses(1);
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadExpenses(page) {
  const body = document.getElementById("expenses-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const categoria = document.getElementById("expense-filter-categoria").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 30 });
  if (categoria) params.set("categoria", categoria);
  const r = await api(`/expenses?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver gastos.", "lock");
    document.getElementById("expenses-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((g) => `<tr class="${TR}">
        <td class="${TD}">${new Date(g.fecha).toLocaleDateString("es-PE")}</td><td class="${TD}">${expenseCategoryBadge(g.categoria)}</td>
        <td class="${TD}">${g.descripcion}</td><td class="${TD}">${money(g.monto)}</td>
        <td class="${TD}">${g.codigo_proyecto || "—"}</td><td class="${TD}">${g.empleado_nombre || "—"}</td>
        <td class="${TD} text-xs text-slate-500">${g.comprobante_tipo ? `${g.comprobante_tipo} ${g.comprobante_serie_numero}` : "—"}</td>
      </tr>`).join("")
    : emptyRow(7, "Sin gastos registrados todavía.", "inbox");
  renderPager("expenses-pager", r.data, (p) => loadExpenses(p));
}

// -------- Reservas --------
document.getElementById("form-reserve").addEventListener("submit", async (e) => {
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
    const r = await api("/inventory/reserve", { method: "POST", body: JSON.stringify(payload) });
    renderResult("reserve-result", r);
    if (r.status === "success") { toast("Stock reservado correctamente"); e.target.reset(); loadReservations(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadReservations() {
  const body = document.getElementById("reservations-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/inventory/reservations");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver reservas.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((res) => `<tr class="${TR}">
        <td class="${TD}">${new Date(res.fecha_reserva).toLocaleString("es-PE")}</td>
        <td class="${TD}">${res.sku}</td><td class="${TD}">${res.almacen_codigo}</td>
        <td class="${TD}">${res.cantidad}</td><td class="${TD}">${res.solicitante}</td>
        <td class="${TD}">${badge(res.estado, res.estado === "ACTIVA" ? "ok" : "devolucion")}</td>
        <td class="${TD}">${res.estado === "ACTIVA" ? `<button class="btn-danger px-3 py-1.5 text-xs" onclick="releaseReservationAction('${res.reserva_id}')">Liberar</button>` : ""}</td>
      </tr>`).join("")
    : emptyRow(7, "Sin reservas registradas.", "inbox");
}

async function releaseReservationAction(reservaId) {
  if (!confirm("¿Liberar esta reserva? El stock reservado vuelve a estar disponible.")) return;
  const r = await api("/inventory/release_reservation", { method: "POST", body: JSON.stringify({ reserva_id: reservaId }) });
  if (r.status === "success") { toast("Reserva liberada"); loadReservations(); }
  else toast(r.error.message, false);
}

// -------- Ajustes --------
document.getElementById("form-adjust").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    product: { sku: f.get("sku") },
    warehouse_code: f.get("warehouse_code"),
    location_code: f.get("location_code") || null,
    cantidad_fisica: Number(f.get("cantidad_fisica")),
    motivo: f.get("motivo") || null,
  };
  if (!confirm(`¿Solicitar ajuste de ${payload.product.sku} en ${payload.warehouse_code} a ${payload.cantidad_fisica} unidades? Un supervisor deberá aprobarlo.`)) return;
  setFormLoading(e.target, true);
  try {
    const r = await api("/inventory/adjust", { method: "POST", body: JSON.stringify(payload) });
    renderResult("adjust-result", r);
    if (r.status === "success") { toast("Ajuste solicitado, pendiente de aprobación"); e.target.reset(); loadAdjustments(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadAdjustments() {
  const body = document.getElementById("adjustments-body");
  body.innerHTML = `<tr><td colspan="9" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/inventory/adjustments");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(9, r.error?.message || "Tu rol no tiene permiso para ver ajustes.", "lock");
    updateAdjustmentsBadge(0);
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((a) => `<tr class="${TR}">
        <td class="${TD}">${new Date(a.created_at).toLocaleString("es-PE")}</td>
        <td class="${TD}">${a.sku}</td><td class="${TD}">${a.almacen_codigo}</td>
        <td class="${TD}">${a.cantidad_sistema}</td><td class="${TD}">${a.cantidad_fisica}</td>
        <td class="${TD}">${a.diferencia}</td><td class="${TD}">${a.solicitante}</td>
        <td class="${TD}">${badge(a.estado, a.estado === "PENDIENTE" ? "low" : a.estado === "APROBADO" ? "ok" : "devolucion")}</td>
        <td class="${TD}">${a.estado === "PENDIENTE" ? `
          <div class="flex gap-1.5">
            <button class="btn-secondary px-3 py-1.5 text-xs" onclick="decideAdjustmentAction('${a.ajuste_id}','APROBADO')">Aprobar</button>
            <button class="btn-danger px-3 py-1.5 text-xs" onclick="decideAdjustmentAction('${a.ajuste_id}','RECHAZADO')">Rechazar</button>
          </div>` : ""}</td>
      </tr>`).join("")
    : emptyRow(9, "Sin ajustes registrados.", "inbox");
  updateAdjustmentsBadge(items.filter((a) => a.estado === "PENDIENTE").length);
}

function updateAdjustmentsBadge(count) {
  const el = document.getElementById("adjustments-badge");
  if (count > 0) { el.textContent = count > 99 ? "99+" : count; el.classList.remove("hidden"); }
  else el.classList.add("hidden");
}

async function decideAdjustmentAction(ajusteId, decision) {
  const label = decision === "APROBADO" ? "aprobar" : "rechazar";
  if (!confirm(`¿Confirmas ${label} este ajuste?`)) return;
  const r = await api(`/inventory/adjust/${ajusteId}/decide`, { method: "POST", body: JSON.stringify({ decision }) });
  if (r.status === "success") { toast(`Ajuste ${decision === "APROBADO" ? "aprobado" : "rechazado"}`); loadAdjustments(); loadDashboard(); }
  else toast(r.error.message, false);
}

// -------- Auditoría --------
async function loadAuditLog() {
  const body = document.getElementById("audit-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const accion = document.getElementById("audit-accion").value.trim();
  const params = new URLSearchParams({ limit: 100 });
  if (accion) params.set("accion", accion);
  const r = await api(`/inventory/audit?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver la auditoría.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((a) => `<tr class="${TR}">
        <td class="${TD}">${new Date(a.created_at).toLocaleString("es-PE")}</td>
        <td class="${TD}">${a.usuario_nombre || "—"}</td><td class="${TD}">${a.canal}</td>
        <td class="${TD} font-mono text-xs">${a.accion}</td>
        <td class="${TD}">${badge(a.resultado, a.resultado === "success" ? "ok" : "low")}</td>
        <td class="${TD} text-xs text-slate-500">${a.error || "—"}</td>
      </tr>`).join("")
    : emptyRow(6, "Sin registros.", "inbox");
}
document.getElementById("audit-accion").addEventListener("keydown", (e) => { if (e.key === "Enter") loadAuditLog(); });

// -------- Usuarios --------
document.getElementById("form-user").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = Object.fromEntries(f.entries());
  setFormLoading(e.target, true);
  try {
    const r = await api("/users", { method: "POST", body: JSON.stringify(payload) });
    if (r.status === "success") { toast("Usuario creado"); e.target.reset(); loadUsers(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadUsers() {
  const body = document.getElementById("users-body");
  body.innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/users");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(5, r.error?.message || "Tu rol no tiene permiso para gestionar usuarios.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((u) => `<tr class="${TR}">
        <td class="${TD}">${u.nombre_completo}</td><td class="${TD}">${u.email}</td>
        <td class="${TD}">${u.rol_codigo}</td>
        <td class="${TD}">${badge(u.activo ? "ACTIVO" : "INACTIVO", u.activo ? "ok" : "devolucion")}</td>
        <td class="${TD}">
          <button class="${u.activo ? "btn-danger" : "btn-secondary"} px-3 py-1.5 text-xs" onclick="toggleUserActive('${u.usuario_id}', ${!u.activo})">
            ${u.activo ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>`).join("")
    : emptyRow(5, "Sin usuarios.", "inbox");
}

async function toggleUserActive(usuarioId, nextActive) {
  if (!confirm(`¿${nextActive ? "Activar" : "Desactivar"} este usuario?`)) return;
  const r = await api(`/users/${usuarioId}`, { method: "PATCH", body: JSON.stringify({ activo: nextActive }) });
  if (r.status === "success") { toast(`Usuario ${nextActive ? "activado" : "desactivado"}`); loadUsers(); }
  else toast(r.error.message, false);
}

// -------- Configuración: logo --------
document.getElementById("form-logo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  setFormLoading(e.target, true);
  try {
    const r = await uploadFile("/settings/logo", fd);
    if (r.status === "success") { toast("Logo actualizado"); applyLogo(r.data.logo_url); e.target.reset(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Kardex por producto (stock + historial, al hacer clic en un SKU) --------
let currentKardexSku = null;

async function openKardex(sku) {
  currentKardexSku = sku;
  const modal = document.getElementById("kardex-modal");
  document.getElementById("kardex-title").textContent = sku;
  document.getElementById("kardex-subtitle").textContent = "Cargando…";
  document.getElementById("kardex-photo").innerHTML = "";
  document.getElementById("kardex-stock-body").innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("kardex-movements-body").innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("kardex-kit-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  modal.classList.remove("hidden");

  const [stockR, movR, prodR] = await Promise.all([
    api(`/inventory/stock?sku=${encodeURIComponent(sku)}&page_size=100`),
    api(`/inventory/movements?sku=${encodeURIComponent(sku)}&page_size=100`),
    api(`/inventory/products?q=${encodeURIComponent(sku)}&page_size=20`),
  ]);

  const stockItems = stockR.data?.items || [];
  const product = (prodR.data?.items || []).find((p) => p.sku === sku);
  const productName = product?.nombre || stockItems[0]?.producto_nombre || movR.data?.items?.[0]?.producto_nombre || "";
  document.getElementById("kardex-subtitle").textContent = productName || "Sin datos de producto";
  document.getElementById("kardex-photo").innerHTML = product?.imagen_url
    ? `<img src="${product.imagen_url}" class="w-full h-full object-cover" alt="${sku}" />`
    : `<svg class="w-5 h-5 text-slate-300" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6"/><circle cx="7.5" cy="8.5" r="1.3" stroke="currentColor" stroke-width="1.4"/><path d="m5 14 3.5-3.5L11 13l2-2 2 2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

  loadKitItems(sku);

  const stockBody = document.getElementById("kardex-stock-body");
  stockBody.innerHTML = stockItems.length
    ? stockItems.map((row) => {
        const low = Number(row.stock_disponible) <= Number(row.punto_reorden);
        return `<tr class="${TR}">
          <td class="${TD}">${row.almacen_codigo}</td><td class="${TD}">${row.codigo_ubicacion || "—"}</td>
          <td class="${TD}">${row.stock_fisico}</td><td class="${TD}">${row.stock_reservado}</td>
          <td class="${TD}">${badge(row.stock_disponible, low ? "low" : "ok")}</td>
        </tr>`;
      }).join("")
    : emptyRow(5, "Sin stock registrado para este producto.", "inbox");

  const movBody = document.getElementById("kardex-movements-body");
  const movItems = movR.data?.items || [];
  movBody.innerHTML = movItems.length
    ? movItems.map((m) => `<tr class="${TR}">
        <td class="${TD}">${new Date(m.created_at).toLocaleString("es-PE")}</td>
        <td class="${TD}">${movTypeBadge(m.tipo_movimiento)}</td><td class="${TD}">${m.cantidad}</td>
        <td class="${TD}">${m.almacen_origen_codigo || "—"}</td><td class="${TD}">${m.almacen_destino_codigo || "—"}</td>
      </tr>`).join("")
    : emptyRow(5, "Sin movimientos registrados.", "inbox");
}

function closeKardex() {
  document.getElementById("kardex-modal").classList.add("hidden");
  currentKardexSku = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeKardex(); });

function triggerKardexPhotoUpload() {
  if (!currentKardexSku) return;
  const sku = currentKardexSku;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.onchange = async () => {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append("photo", input.files[0]);
    const r = await uploadFile(`/inventory/products/${encodeURIComponent(sku)}/photo`, fd);
    if (r.status === "success") {
      toast("Foto actualizada");
      document.getElementById("kardex-photo").innerHTML = `<img src="${r.data.imagen_url}" class="w-full h-full object-cover" alt="${sku}" />`;
    } else toast(r.error.message, false);
  };
  input.click();
}

// -------- Kit / lista de materiales --------
async function loadKitItems(sku) {
  const body = document.getElementById("kardex-kit-body");
  const r = await api(`/inventory/kits/${encodeURIComponent(sku)}/items`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(4, r.error?.message || "Tu rol no tiene permiso para ver el kit.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((it) => `<tr class="${TR}">
        <td class="${TD}">${it.sku}</td><td class="${TD}">${it.nombre}</td><td class="${TD}">${it.cantidad}</td>
        <td class="${TD}"><button class="btn-danger px-2.5 py-1 text-xs" onclick="removeKitItemAction('${sku}','${it.sku}')">Quitar</button></td>
      </tr>`).join("")
    : emptyRow(4, "Este producto todavía no es un kit.", "inbox");
}

document.getElementById("form-kit-item").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentKardexSku) return;
  const f = new FormData(e.target);
  const payload = { sku: f.get("sku"), quantity: Number(f.get("quantity")) };
  setFormLoading(e.target, true);
  try {
    const r = await api(`/inventory/kits/${encodeURIComponent(currentKardexSku)}/items`, { method: "POST", body: JSON.stringify(payload) });
    if (r.status === "success") { toast("Item agregado al kit"); e.target.reset(); loadKitItems(currentKardexSku); loadProducts(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function removeKitItemAction(kitSku, itemSku) {
  if (!confirm(`¿Quitar ${itemSku} del kit ${kitSku}?`)) return;
  const r = await api(`/inventory/kits/${encodeURIComponent(kitSku)}/items/${encodeURIComponent(itemSku)}`, { method: "DELETE" });
  if (r.status === "success") { toast("Item quitado del kit"); loadKitItems(kitSku); loadProducts(); }
  else toast(r.error.message, false);
}

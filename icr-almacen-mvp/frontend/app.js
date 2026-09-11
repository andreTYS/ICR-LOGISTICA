const API = "/api";

// Estado de la personalización de íconos del menú — declarado acá arriba
// (no junto a sus funciones más abajo) porque enterApp() puede dispararse
// de forma síncrona al cargar la página (sesión ya guardada) antes de que
// el resto del archivo termine de ejecutarse, y una referencia a un
// const/let todavía no inicializado revienta con un TDZ error.
let iconEditMode = false;
let pendingIconKey = null;
let navIconOverridesMap = {};
const navIconDefaults = {};

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
  document.getElementById("ai-chat-widget").classList.add("hidden");
  document.getElementById("ai-chat-panel").classList.add("hidden");
  aiChatHistory = [];
  document.getElementById("ai-chat-messages").innerHTML = "";
  document.getElementById("help-widget").classList.add("hidden");
  document.getElementById("help-panel").classList.add("hidden");
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
  document.getElementById("ai-chat-widget").classList.remove("hidden");
  document.getElementById("help-widget").classList.remove("hidden");
  initNavTooltips();
  restoreSidebarCollapsed();
  loadNavIconOverrides();
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
  calendar: ["Calendario", "Agenda unificada de fechas pendientes de todos los módulos"],
  stock: ["Stock disponible", "Existencias por producto, almacén y ubicación"],
  receive: ["Ingreso de mercadería", "Registrar entrada de stock a un almacén"],
  remove: ["Salida / despacho", "Registrar salida de stock de un almacén"],
  transfer: ["Transferencia entre almacenes", "Mover stock entre almacenes de forma atómica"],
  products: ["Productos", "Catálogo de productos gestionados"],
  movements: ["Movimientos (ledger)", "Historial completo de movimientos de inventario"],
  alerts: ["Alertas de stock bajo", "Productos por debajo del punto de reorden"],
  warehouses: ["Almacenes y ubicaciones", "Crear y administrar almacenes y sus ubicaciones internas"],
  purchases: ["Órdenes de compra", "Crear, enviar y recibir órdenes de compra"],
  "purchases-replenishment": ["Reabastecimiento", "Productos por debajo del punto de reorden, con cantidad sugerida"],
  "purchases-suppliers": ["Proveedores", "Catálogo de proveedores"],
  payables: ["Cuentas por pagar", "Facturas de proveedor y sus pagos, parciales o totales"],
  projects: ["Proyectos", "Obras con costeo real: materiales consumidos + mano de obra vs. presupuesto"],
  "projects-clients": ["Clientes", "Catálogo de clientes"],
  "projects-profitability": ["Rentabilidad", "Costo real (materiales + mano de obra) vs. presupuesto, por proyecto"],
  "accounting-entries": ["Asientos contables", "Asientos manuales y generados automáticamente por las reglas de imputación"],
  "accounting-accounts": ["Plan de cuentas", "Estructura de cuentas contables"],
  "accounting-rules": ["Reglas de imputación", "Mapeo de eventos de negocio a cuentas debe/haber"],
  "accounting-fiscal": ["Parámetros fiscales", "Tasas versionadas por vigencia (IGV, UIT, detracción)"],
  "accounting-reports": ["Reportes financieros", "Estado de Resultados y Balance General a partir de los asientos contabilizados"],
  "rrhh-employees": ["Empleados", "Fichas de personal: cargo, tipo de contrato y costo/hora"],
  "rrhh-attendance": ["Asistencia", "Marcación de entrada y salida por empleado"],
  crm: ["CRM / Leads", "Pipeline comercial: contactos y oportunidades antes de la primera cotización"],
  chatbot: ["Chatbot", "Bandeja de conversaciones del chatbot externo (web/tienda), conectado vía N8N"],
  quotes: ["Cotizaciones", "Cotizar antes del contrato; una cotización aceptada se convierte en contrato con un clic"],
  "sales-contracts": ["Contratos", "Contratos de venta con cronograma de cobro (hitos)"],
  "sales-receivables": ["Cuentas por cobrar", "Hitos de cobro pendientes y vencidos, por contrato"],
  expenses: ["Gastos", "Gastos operativos: combustible, viáticos, alquiler, servicios, reembolsos y más"],
  assets: ["Activos instalados", "Equipos instalados en clientes, con garantía y ciclo de mantenimiento"],
  maintenance: ["Mantenimientos", "Mantenimientos preventivos y correctivos, de todos los activos"],
  warranties: ["Garantías por vencer", "Activos con garantía vencida o próxima a vencer"],
  reservations: ["Reservas", "Stock apartado para proyectos o clientes"],
  adjustments: ["Ajustes de inventario", "Conteos físicos pendientes de aprobación de un supervisor"],
  audit: ["Auditoría", "Registro de todas las acciones ejecutadas sobre el inventario"],
  users: ["Usuarios", "Altas y roles de acceso al panel (solo administradores)"],
  "module-access": ["Módulos", "Activar o desactivar módulos completos por rol (solo administradores)"],
  "role-permissions": ["Roles y permisos", "Mapa de permisos por rol, de solo lectura (solo administradores)"],
  integrations: ["Integraciones", "Estado de las integraciones opcionales: asistente de IA y bot de Telegram (solo administradores)"],
  "api-tokens": ["Tokens de servicio", "Tokens de larga duración para integraciones como N8N (solo administradores)"],
  "n8n-webhooks": ["Automatizaciones N8N", "Webhooks salientes: el ERP avisa a N8N apenas ocurre un evento (solo administradores)"],
  settings: ["Configuración", "Personalización del panel (solo administradores)"],
};

// Grupos de módulos del menú lateral (Almacén, Compras, Administración, …).
// Clic en el encabezado expande/colapsa; el grupo que contiene la vista
// activa se expande solo y se resalta.
function toggleNavGroup(name) {
  document.querySelector(`.nav-group[data-group="${name}"]`)?.classList.toggle("expanded");
}

// -------- Modo compacto del menú (solo íconos, tipo app) --------
// El título nativo del navegador hace de tooltip en modo compacto (y no
// estorba en modo expandido, donde igual se ve la etiqueta de texto).
function initNavTooltips() {
  document.querySelectorAll(".nav-item, .nav-group-header").forEach((el) => {
    if (el.title) return;
    const label = el.querySelector("span:not(.nav-badge):not(.nav-group-chevron)");
    if (label) el.title = label.textContent.trim();
  });
}

function applySidebarCollapsed(collapsed) {
  document.querySelector(".sidebar")?.classList.toggle("collapsed", collapsed);
  const btn = document.getElementById("sidebar-collapse-toggle");
  if (btn) btn.title = collapsed ? "Expandir menú" : "Modo compacto";
}

function toggleSidebarCollapsed() {
  const collapsed = !document.querySelector(".sidebar")?.classList.contains("collapsed");
  applySidebarCollapsed(collapsed);
  try { localStorage.setItem("icr_sidebar_collapsed", collapsed ? "1" : "0"); } catch {}
}

function restoreSidebarCollapsed() {
  let collapsed = false;
  try { collapsed = localStorage.getItem("icr_sidebar_collapsed") === "1"; } catch {}
  applySidebarCollapsed(collapsed);
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
  currentHelpView = view;
  if (!document.getElementById("help-panel").classList.contains("hidden")) renderHelpPanel(view);
  if (view === "dashboard") loadDashboard();
  if (view === "calendar") loadCalendar();
  if (view === "stock") loadStock();
  if (view === "products") loadProducts();
  if (view === "movements") loadMovements();
  if (view === "alerts") loadAlerts();
  if (view === "warehouses") loadWarehousesManaged();
  if (view === "purchases") loadPurchaseOrders(1);
  if (view === "purchases-replenishment") loadReplenishmentSuggestions();
  if (view === "purchases-suppliers") loadSuppliers();
  if (view === "payables") loadFacturas(1);
  if (view === "projects") loadProjects(1);
  if (view === "projects-clients") loadClients();
  if (view === "projects-profitability") loadProfitabilityReport();
  if (view === "accounting-entries") loadEntries(1);
  if (view === "accounting-accounts") loadAccounts();
  if (view === "accounting-rules") loadRules();
  if (view === "accounting-fiscal") loadFiscalParams();
  if (view === "accounting-reports") { loadIncomeStatement(); loadBalanceSheet(); }
  if (view === "rrhh-employees") loadEmployees();
  if (view === "rrhh-attendance") { loadEmployeeOptions(); loadAttendance(); }
  if (view === "crm") loadLeads(1);
  if (view === "chatbot") { currentChatbotCodigo = null; loadChatbotConversations(); document.getElementById("chatbot-thread-panel").innerHTML = `<div class="text-sm text-slate-400 italic text-center py-16">Seleccioná una conversación de la izquierda para ver el hilo.</div>`; }
  if (view === "quotes") loadCotizaciones(1);
  if (view === "sales-contracts") loadContracts(1);
  if (view === "sales-receivables") loadReceivables();
  if (view === "expenses") loadExpenses(1);
  if (view === "assets") loadActivos(1);
  if (view === "maintenance") loadMantenimientos(1);
  if (view === "warranties") loadWarranties();
  if (view === "reservations") loadReservations();
  if (view === "adjustments") loadAdjustments();
  if (view === "audit") loadAuditLog();
  if (view === "users") loadUsers();
  if (view === "module-access") loadModuleAccess();
  if (view === "role-permissions") loadRolePermissions();
  if (view === "integrations") loadIntegrationsStatus();
  if (view === "api-tokens") loadApiTokens();
  if (view === "n8n-webhooks") loadN8nWebhooks();
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.view));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.goto));
});

// -------- Personalizar íconos del menú con imágenes (solo ADMIN) --------
// Reemplaza el SVG de un ítem/grupo de navegación por una imagen propia.
// Se guarda solo la URL ya procesada (backend); acá solo se pinta y se
// intercepta el click sobre el ícono cuando el modo edición está activo,
// para no interferir con la navegación normal. El estado (iconEditMode,
// navIconDefaults, etc.) se declara al principio del archivo — ver ahí el porqué.

function navIconItemKey(el) {
  if (el.classList.contains("nav-group-header")) {
    const group = el.closest(".nav-group");
    return group ? `group:${group.dataset.group}` : null;
  }
  return el.dataset.view || null;
}

function collectNavIconTargets() {
  const targets = [];
  document.querySelectorAll(".nav-item[data-view], .nav-group-header").forEach((el) => {
    const key = navIconItemKey(el);
    if (!key) return;
    targets.push({ el, key });
    if (!(key in navIconDefaults)) {
      const iconEl = el.querySelector(".nav-icon");
      if (iconEl) navIconDefaults[key] = iconEl.outerHTML;
    }
  });
  return targets;
}

function applyNavIcon(el, key) {
  const iconEl = el.querySelector(".nav-icon");
  if (!iconEl) return;
  const url = navIconOverridesMap[key];
  if (url) {
    const img = document.createElement("img");
    img.className = "nav-icon";
    img.src = url;
    img.alt = "";
    iconEl.replaceWith(img);
    el.classList.add("has-custom-icon");
  } else {
    if (iconEl.tagName === "IMG" && navIconDefaults[key]) {
      iconEl.outerHTML = navIconDefaults[key];
    }
    el.classList.remove("has-custom-icon");
  }
}

function renderNavIconRemoveBadges(targets) {
  targets.forEach(({ el, key }) => {
    let badge = el.querySelector(".nav-icon-remove-badge");
    if (navIconOverridesMap[key]) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-icon-remove-badge";
        badge.textContent = "×";
        badge.title = "Restaurar ícono por defecto";
        badge.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          restoreNavIcon(key);
        });
        el.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  });
}

async function loadNavIconOverrides() {
  const targets = collectNavIconTargets();
  const r = await api("/nav-icons");
  navIconOverridesMap = {};
  if (r.status === "success") (r.data || []).forEach((row) => { navIconOverridesMap[row.item_key] = row.imagen_url; });
  targets.forEach(({ el, key }) => applyNavIcon(el, key));
  renderNavIconRemoveBadges(targets);
}

function toggleIconEditMode() {
  iconEditMode = !iconEditMode;
  document.querySelector(".sidebar")?.classList.toggle("icon-edit-mode", iconEditMode);
  const btn = document.getElementById("icon-edit-mode-toggle");
  if (btn) btn.textContent = iconEditMode ? "Terminar de editar íconos" : "Editar íconos del menú";
}

function triggerIconUpload(itemKey) {
  pendingIconKey = itemKey;
  document.getElementById("nav-icon-upload-input").click();
}

async function restoreNavIcon(itemKey) {
  if (!confirm("¿Restaurar el ícono por defecto de este menú?")) return;
  const r = await api(`/nav-icons/${encodeURIComponent(itemKey)}`, { method: "DELETE" });
  if (r.status === "success") { toast("Ícono restaurado"); loadNavIconOverrides(); }
  else toast(r.error.message, false);
}

document.addEventListener("click", (e) => {
  if (!iconEditMode) return;
  const iconEl = e.target.closest(".nav-icon");
  if (!iconEl) return;
  const container = iconEl.closest(".nav-item[data-view], .nav-group-header");
  if (!container) return;
  e.preventDefault();
  e.stopPropagation();
  const key = navIconItemKey(container);
  if (key) triggerIconUpload(key);
}, true);

document.getElementById("nav-icon-upload-input")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !pendingIconKey) return;
  const fd = new FormData();
  fd.append("icon", file);
  fd.append("item_key", pendingIconKey);
  fd.append("channel", "web");
  const r = await uploadFile("/nav-icons", fd);
  if (r.status === "success") { toast("Ícono actualizado"); loadNavIconOverrides(); }
  else toast(r.error.message, false);
  pendingIconKey = null;
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
    document.getElementById("ai-chat-widget").classList.add("hidden");
    document.getElementById("help-widget").classList.add("hidden");
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
    document.getElementById("ai-chat-widget").classList.add("hidden");
    document.getElementById("help-widget").classList.add("hidden");
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
  ["kpi-products", "kpi-warehouses", "kpi-movements", "kpi-alerts"].forEach((id) => {
    document.getElementById(id).textContent = "…";
  });
  document.getElementById("dash-movements-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("dash-alerts-body").innerHTML = `<tr><td colspan="3" class="${TD_EMPTY}">Cargando…</td></tr>`;

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

  api("/assets-warranties-expiring").then((r) => updateWarrantiesBadge(r.status === "success" ? r.data.length : 0)).catch(() => {});
  api("/chatbot/conversations?estado=ABIERTA&page_size=1").then((r) => updateChatbotBadge(r.status === "success" ? r.data.total : 0)).catch(() => {});

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
  loadStockByWarehouseChart();
  loadProjectsByStatusChart();
  loadTopClientsChart();
  loadTopSuppliersChart();
}

// -------- Centro de ayuda (guía estática, no consume ninguna API externa) --------
// A diferencia del Asistente ICR (Gemini), esto es contenido fijo escrito a
// mano por pantalla — cero costo, cero latencia, funciona sin conexión a
// internet ni credenciales configuradas. Vive solo en el frontend.
const HELP_TOPICS = {
  dashboard: { tips: [
    "Los accesos rápidos (Ingreso, Salida, Transferencia, Reservar stock) abren el formulario correspondiente en un clic.",
    "El resumen de otros módulos se adapta al rol: si algo aparece en '—' es porque tu rol no tiene acceso a ese módulo.",
  ] },
  calendar: { tips: [
    "Agrega en una sola lista fechas de leads, mantenimientos, cobros de contrato, garantías y asistencia — nada se guarda acá, cada evento vive en su módulo de origen.",
    "Haz clic en cualquier evento para saltar directo a su pantalla y registro (ej. abre el lead o el activo correspondiente).",
    "Usa el filtro de tipo de evento para enfocarte en un solo módulo (ej. solo cobros de contrato).",
  ] },
  stock: { tips: [
    "Filtra por almacén o SKU para ubicar existencias rápido.",
    "Haz clic en un SKU para abrir su Kardex: stock actual + historial de movimientos.",
  ] },
  receive: { tips: ["Registra entrada de mercadería a un almacén y ubicación específicos.", "Si el producto usa número de serie o lote, el formulario lo pedirá."] },
  remove: { tips: ["Registra salida/despacho de stock.", "No permite dejar el stock en negativo — si falla, revisa el saldo en Stock."] },
  transfer: { tips: ["Mueve stock entre dos almacenes en una sola operación atómica: sale de uno y entra al otro, o no pasa nada."] },
  products: { tips: [
    "Los productos tipo 'kit' agrupan varios ítems — al despachar un kit se descuentan sus componentes.",
    "Desactivar un producto lo oculta de nuevas operaciones sin borrar su historial.",
  ] },
  movements: { tips: ["Ledger completo e inmutable de todo lo que entró, salió o se transfirió. Exporta a CSV para análisis externo."] },
  alerts: { tips: ["Lista productos por debajo de su punto de reorden — es la misma señal que dispara sugerencias en Reabastecimiento."] },
  warehouses: { tips: [
    "Crea almacenes y sus ubicaciones internas (pasillo/rack/nivel) para tener trazabilidad fina del stock.",
    "Desactivar un almacén no borra su historial, solo evita que se sigan registrando movimientos nuevos ahí.",
  ] },
  purchases: { tips: [
    "Flujo: crear orden → enviar al proveedor → recibir (total o parcial). Una recepción parcial deja el resto como pendiente (backorder).",
  ] },
  "purchases-replenishment": { tips: ["Sugerencias automáticas de cantidad a comprar según punto de reorden y stock actual — punto de partida para crear una orden de compra."] },
  "purchases-suppliers": { tips: ["Catálogo de proveedores usado al crear órdenes de compra y registrar facturas en Cuentas por pagar."] },
  payables: { tips: [
    "Registra facturas de proveedor y sus pagos — pueden ser parciales, el sistema lleva el saldo pendiente.",
    "Una factura totalmente pagada pasa a estado PAGADA automáticamente.",
  ] },
  projects: { tips: [
    "El costeo compara materiales consumidos + mano de obra registrada contra el presupuesto de la obra.",
    "Registra horas de mano de obra desde el detalle del proyecto para que se reflejen en el costeo.",
  ] },
  "projects-clients": { tips: ["Catálogo de clientes, usado en Proyectos, Ventas, CRM y Activos."] },
  "projects-profitability": { tips: ["Ranking de proyectos por margen real (ingresos del contrato vs. costo real) — exportable a CSV."] },
  "accounting-entries": { tips: [
    "La mayoría de asientos se generan solos con las reglas de imputación cuando ocurre un evento de negocio (compra recibida, cobro registrado, etc.).",
    "Un asiento en BORRADOR no afecta los reportes financieros hasta que se contabiliza.",
  ] },
  "accounting-accounts": { tips: ["Estructura de cuentas contables (plan de cuentas) usada por las reglas de imputación y los asientos."] },
  "accounting-rules": { tips: ["Mapea un evento de negocio (ej. 'compra recibida') a qué cuentas debe/haber se afectan automáticamente."] },
  "accounting-fiscal": { tips: ["Tasas fiscales (IGV, UIT, detracción) versionadas por fecha de vigencia — no se sobrescriben, se agrega una nueva versión."] },
  "accounting-reports": { tips: [
    "Estado de Resultados: ingresos menos gastos en un rango de fechas.",
    "Balance General: foto de Activo = Pasivo + Patrimonio a una fecha de corte.",
    "Ambos solo consideran asientos en estado CONTABILIZADO.",
  ] },
  "rrhh-employees": { tips: ["Ficha de cada empleado: cargo, tipo de contrato y costo/hora — este último se usa para costear mano de obra en Proyectos."] },
  "rrhh-attendance": { tips: ["Marca entrada y salida por empleado; las horas trabajadas se calculan solas al marcar salida."] },
  crm: { tips: [
    "Un lead es un contacto/oportunidad antes de tener una cotización formal — cuando se gana, se convierte en cotización con un clic.",
    "Registra cada llamada, email o reunión como actividad para no perder el hilo del seguimiento.",
  ] },
  quotes: { tips: ["Cotiza antes del contrato — una cotización ACEPTADA se convierte en contrato con un clic, sin volver a digitar los ítems."] },
  "sales-contracts": { tips: ["Cada contrato tiene un cronograma de cobro (hitos); registrar el pago de un hito dispara el asiento contable automático."] },
  "sales-receivables": { tips: ["Vista consolidada de hitos de cobro pendientes o vencidos, de todos los contratos, para priorizar la cobranza."] },
  expenses: { tips: ["Registra gastos operativos; si vinculas un proyecto, el gasto entra al costeo real de esa obra."] },
  assets: { tips: ["Equipos instalados en clientes con garantía y ciclo de mantenimiento — haz clic en uno para ver su historial de mantenimientos."] },
  maintenance: { tips: ["Listado global de mantenimientos preventivos y correctivos de todos los activos, con su estado."] },
  warranties: { tips: ["Activos cuya garantía ya venció o está por vencer dentro de la ventana elegida — útil para avisar al cliente a tiempo."] },
  reservations: { tips: ["Aparta stock para un proyecto o cliente sin descontarlo todavía del inventario disponible; libéralo si ya no se usa."] },
  adjustments: { tips: ["Un conteo físico que no cuadra con el sistema queda pendiente hasta que un supervisor lo apruebe."] },
  audit: { tips: ["Registro de solo lectura de toda acción ejecutada sobre el inventario — quién, qué y cuándo."] },
  users: { tips: ["Alta de usuarios y asignación de rol — el rol determina qué puede hacer cada quien (ver Roles y permisos)."] },
  "module-access": { tips: ["Apaga módulos completos por rol sin tocar código — por ejemplo, ocultar Contabilidad al rol VENTAS."] },
  "role-permissions": { tips: ["Mapa de solo lectura: qué acción puede ejecutar cada rol. Para cambiarlo hay que modificar el código (es la fuente de verdad de seguridad)."] },
  integrations: { tips: [
    "Muestra si las integraciones opcionales (IA, Telegram) están configuradas, sin exponer las claves.",
    "'No configurado' significa que falta esa variable de entorno en el servidor.",
  ] },
  settings: { tips: ["Personalización visual del panel (por ahora, el logo)."] },
};
const HELP_DEFAULT_TIPS = ["Todavía no hay una guía específica para esta pantalla. Si tienes dudas, usa el Asistente ICR (el ícono de chat) para preguntar en lenguaje natural."];
let currentHelpView = "dashboard";

function renderHelpPanel(view) {
  currentHelpView = view;
  const [title] = titles[view] || ["Ayuda"];
  document.getElementById("help-subtitle").textContent = title;
  const tips = (HELP_TOPICS[view]?.tips) || HELP_DEFAULT_TIPS;
  const tipsHtml = `<ul class="help-tips">${tips.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  const indexHtml = `<div class="help-index-title">Todos los temas</div><div class="help-index">${Object.keys(titles).map((v) =>
    `<button type="button" class="help-index-item${v === view ? " active" : ""}" onclick="renderHelpPanel('${v}')">${titles[v][0]}</button>`
  ).join("")}</div>`;
  document.getElementById("help-body").innerHTML = `${tipsHtml}<hr class="help-divider" />${indexHtml}`;
}

function toggleHelp() {
  const panel = document.getElementById("help-panel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening) renderHelpPanel(currentHelpView);
}

// -------- Calendario (agenda unificada de solo lectura) --------
const CALENDAR_EVENT_LABELS = {
  LEAD_SEGUIMIENTO: ["Seguimiento de lead", "bg-cyan-50 text-accent-600"],
  MANTENIMIENTO: ["Mantenimiento", "bg-amber-50 text-amber-700"],
  HITO_CONTRATO: ["Cobro de contrato", "bg-emerald-50 text-emerald-700"],
  GARANTIA_VENCE: ["Garantía por vencer", "bg-rose-50 text-rose-700"],
  ASISTENCIA: ["Asistencia", "bg-slate-100 text-slate-600"],
};

async function loadCalendar() {
  const list = document.getElementById("calendar-list");
  list.innerHTML = emptyState("Cargando…", "inbox");
  const dias = document.getElementById("calendar-ventana").value;
  const tipo = document.getElementById("calendar-tipo").value;
  const desde = new Date().toISOString().slice(0, 10);
  const hasta = new Date(Date.now() + Number(dias) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({ desde, hasta });
  if (tipo) params.set("tipos", tipo);
  const r = await api(`/calendar/events?${params}`);
  if (r.status !== "success") {
    list.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver esto.", "lock");
    return;
  }
  const items = r.data || [];
  if (items.length === 0) {
    list.innerHTML = emptyState("Sin eventos programados en esta ventana.", "check");
    return;
  }
  list.innerHTML = items.map((ev) => {
    const [label, cls] = CALENDAR_EVENT_LABELS[ev.tipo] || [ev.tipo, "bg-slate-100 text-slate-600"];
    const fecha = new Date(ev.fecha).toLocaleDateString("es-PE", { weekday: "short", day: "2-digit", month: "short" });
    const tituloJs = String(ev.titulo).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `<div class="table-card flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50" onclick="goToCalendarEvent('${ev.tipo}', '${ev.entidad_id}', '${tituloJs}')">
      <div class="text-xs font-bold text-slate-400 uppercase w-24 shrink-0">${fecha}</div>
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${cls}">${label}</span>
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-navy-900 truncate">${ev.titulo}</div>
        <div class="text-xs text-slate-500 truncate">${ev.subtitulo || ""}</div>
      </div>
      <div class="text-xs text-slate-400 shrink-0">${ev.estado || ""}</div>
    </div>`;
  }).join("");
}

async function goToCalendarEvent(tipo, entidadId, titulo) {
  if (tipo === "LEAD_SEGUIMIENTO") { goToView("crm"); await loadLeads(1); openLeadModal(titulo); }
  else if (tipo === "HITO_CONTRATO") { goToView("sales-contracts"); await loadContracts(1); openContractModal(titulo); }
  else if (tipo === "MANTENIMIENTO" || tipo === "GARANTIA_VENCE") { goToView("assets"); await loadActivos(1); openAssetModal(entidadId); }
  else if (tipo === "ASISTENCIA") { goToView("rrhh-attendance"); }
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
        <div class="h-full rounded-full ranking-bar" style="width:${Math.max(3, (i.monto / max) * 100)}%; background:#1d3557"></div>
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
        <div class="h-full rounded-full ranking-bar" style="width:${Math.max(3, (Math.abs(margen) / max) * 100)}%; background:${negative ? "#e11d48" : "#059669"}"></div>
      </div>
    </div>`;
  }).join("");
}

// -------- Ranking horizontal genérico (barras de progreso), reusado por
// Stock por almacén, Ventas por cliente y Compras por proveedor -- mismo
// patrón visual que ya usaban Gasto por categoría y Proyectos con peor
// margen, extraído acá para no repetir el markup tres veces más.
function renderRankingBars(el, items, { color = "#1d3557", formatValue = (v) => v } = {}) {
  const max = Math.max(...items.map((i) => i.value));
  el.innerHTML = items.map((i) => `
    <div class="mb-2.5">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="font-semibold text-navy-950">${i.label}</span>
        <span class="text-slate-500">${formatValue(i.value)}</span>
      </div>
      <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full rounded-full ranking-bar" style="width:${Math.max(3, (i.value / max) * 100)}%; background:${color}"></div>
      </div>
    </div>`).join("");
}

// -------- Tablero: Stock por almacén --------
// Reusa GET /dashboard/stock-by-warehouse (suma de stock_fisico por almacén
// activo). Un solo tono, igual criterio que Gasto por categoría: acá importa
// la magnitud relativa entre almacenes, no una identidad categórica.
async function loadStockByWarehouseChart() {
  const r = await api("/dashboard/stock-by-warehouse");
  const el = document.getElementById("stock-warehouse-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  const items = (r.data || []).map((w) => ({ label: w.nombre, value: w.total }));
  if (!items.length) { el.innerHTML = emptyState("Sin stock registrado todavía.", "chart"); return; }
  renderRankingBars(el, items, { color: "#009aa4" });
}

// -------- Tablero: Ventas por cliente (top 5) --------
async function loadTopClientsChart() {
  const r = await api("/dashboard/top-clients?limit=5");
  const el = document.getElementById("top-clients-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  const items = (r.data || []).map((c) => ({ label: c.cliente, value: c.total }));
  if (!items.length) { el.innerHTML = emptyState("Sin contratos registrados todavía.", "chart"); return; }
  renderRankingBars(el, items, { color: "#e11d48", formatValue: (v) => `PEN ${money(v)}` });
}

// -------- Tablero: Compras por proveedor (top 5) --------
async function loadTopSuppliersChart() {
  const r = await api("/dashboard/top-suppliers?limit=5");
  const el = document.getElementById("top-suppliers-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  const items = (r.data || []).map((p) => ({ label: p.proveedor, value: p.total }));
  if (!items.length) { el.innerHTML = emptyState("Sin órdenes de compra registradas todavía.", "chart"); return; }
  renderRankingBars(el, items, { color: "#d97706", formatValue: (v) => `PEN ${money(v)}` });
}

// -------- Tablero: Proyectos por estado (donut) --------
// Primer gráfico circular del Panel (los demás son de barras) — mismo
// criterio de color divergente/categórico que ya usan los badges de estado
// de proyecto (marginClass/PROJECT_STATUS_TONES): verde = activo, ámbar =
// pausado, gris = finalizado, rojo = cancelado.
const PROJECT_STATUS_DONUT_COLORS = { ACTIVO: "#059669", PAUSADO: "#d97706", FINALIZADO: "#64748b", CANCELADO: "#e11d48" };

function renderDonutChart(el, items, colorFor, tipId) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) { el.innerHTML = emptyState("Sin datos para mostrar.", "chart"); return; }
  const r = 35, cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = items.map((it) => {
    const dash = (it.value / total) * circumference;
    const seg = `<circle class="donut-segment" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colorFor(it.label)}" stroke-width="16"
      stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"
      onmouseenter="showChartTip(event,'${it.label}: ${it.value}','${tipId}')" onmousemove="moveChartTip(event,'${tipId}')" onmouseleave="hideChartTip('${tipId}')"></circle>`;
    offset += dash;
    return seg;
  }).join("");
  const legend = items.map((it) => `
    <div class="flex items-center justify-between text-xs mb-1.5">
      <span class="inline-flex items-center gap-1.5 font-semibold text-navy-950"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${colorFor(it.label)}"></span>${it.label}</span>
      <span class="text-slate-500">${it.value}</span>
    </div>`).join("");
  el.innerHTML = `
    <div class="flex items-center gap-6 flex-wrap">
      <div class="relative shrink-0" style="width:130px;height:130px">
        <svg viewBox="0 0 100 100" style="width:130px;height:130px" role="img" aria-label="Proyectos por estado">${segments}</svg>
        <div id="${tipId}" class="chart-tip"></div>
      </div>
      <div class="flex-1 min-w-[140px]">${legend}</div>
    </div>`;
}

async function loadProjectsByStatusChart() {
  const r = await api("/dashboard/projects-by-status");
  const el = document.getElementById("projects-status-chart");
  if (r.status !== "success") { el.innerHTML = emptyState(r.error?.message || "Tu rol no tiene permiso para ver este tablero.", "lock"); return; }
  const items = (r.data || []).map((p) => ({ label: p.estado, value: p.cantidad }));
  if (!items.length) { el.innerHTML = emptyState("Sin proyectos registrados todavía.", "chart"); return; }
  renderDonutChart(el, items, (label) => PROJECT_STATUS_DONUT_COLORS[label] || "#94a3b8", "tip-projects-status");
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

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function importProductsCsv(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const result = document.getElementById("products-import-result");
  result.innerHTML = `<p class="text-sm text-slate-400 italic">Importando…</p>`;
  try {
    const csv = await readFileAsText(file);
    const r = await api("/inventory/products/import-csv", { method: "POST", body: JSON.stringify({ csv }) });
    if (r.status !== "success") {
      result.innerHTML = `<div class="result-box err">${r.error.message}</div>`;
      toast(r.error.message, false);
      return;
    }
    const { total, exitosos, fallidos, detalle } = r.data;
    const fallidasHtml = fallidos > 0
      ? `<ul class="mt-2 text-xs text-rose-600 list-disc pl-4">${detalle.filter((d) => !d.ok).map((d) => `<li>Fila ${d.fila} (${d.sku || "sin SKU"}): ${d.error}</li>`).join("")}</ul>`
      : "";
    result.innerHTML = `<div class="result-box ${fallidos > 0 ? "err" : "ok"}">
      <p>Importación completa: ${exitosos} de ${total} productos creados${fallidos > 0 ? `, ${fallidos} con error` : ""}.</p>
      ${fallidasHtml}
    </div>`;
    toast(`${exitosos} producto(s) importado(s)`, fallidos === 0);
    loadProducts();
  } finally {
    inputEl.value = "";
  }
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

// -------- Almacenes y ubicaciones --------
document.getElementById("form-warehouse-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { channel: "web", codigo: f.get("codigo"), nombre: f.get("nombre") };
  setFormLoading(e.target, true);
  try {
    const r = await api("/inventory/warehouses-managed", { method: "POST", body: JSON.stringify(payload) });
    renderResult("warehouse-create-result", r);
    if (r.status === "success") { toast(`Almacén ${r.data.almacen.codigo} creado`); e.target.reset(); loadWarehousesManaged(); loadWarehouseOptions(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadWarehousesManaged() {
  const container = document.getElementById("warehouses-list");
  container.innerHTML = `<p class="text-sm text-slate-400 italic">Cargando…</p>`;
  const r = await api("/inventory/warehouses-managed");
  if (r.status !== "success") {
    container.innerHTML = `<p class="text-sm text-slate-400 italic">${r.error?.message || "Tu rol no tiene permiso para ver almacenes."}</p>`;
    return;
  }
  const items = r.data || [];
  container.innerHTML = items.length
    ? items.map((a) => `
      <div class="form-card mb-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="font-bold text-navy-950">${a.codigo} — ${a.nombre}</div>
            <div class="text-xs text-slate-500 mt-0.5">${a.responsable_nombre ? `Responsable: ${a.responsable_nombre}` : "Sin responsable asignado"}</div>
          </div>
          <div class="flex items-center gap-2">
            ${badge(a.activo ? "ACTIVO" : "INACTIVO", a.activo ? "ok" : "devolucion")}
            <button type="button" class="${a.activo ? "btn-danger" : "btn-secondary"} px-3 py-1.5 text-xs" onclick="toggleWarehouseActive('${a.almacen_id}', ${!a.activo})">
              ${a.activo ? "Desactivar" : "Activar"}
            </button>
          </div>
        </div>
        <table class="w-full border-collapse text-sm mb-3">
          <thead><tr class="text-left text-[11.5px] text-slate-400 uppercase tracking-wide">
            <th class="font-semibold py-1.5 pr-3">Ubicación</th><th class="font-semibold py-1.5 pr-3">Descripción</th>
            <th class="font-semibold py-1.5 pr-3">Estado</th><th class="font-semibold py-1.5"></th>
          </tr></thead>
          <tbody>${a.ubicaciones.length
            ? a.ubicaciones.map((u) => `<tr class="${TR}">
                <td class="${TD}">${u.codigo_ubicacion}</td><td class="${TD}">${u.descripcion || "—"}</td>
                <td class="${TD}">${badge(u.activo ? "ACTIVA" : "INACTIVA", u.activo ? "ok" : "devolucion")}</td>
                <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="toggleLocationActive('${u.ubicacion_id}', ${!u.activo})">${u.activo ? "Desactivar" : "Activar"}</button></td>
              </tr>`).join("")
            : `<tr><td colspan="4" class="${TD_EMPTY}">Sin ubicaciones registradas.</td></tr>`}</tbody>
        </table>
        <form class="flex flex-wrap items-end gap-2" onsubmit="return addLocation(event, '${a.codigo}')">
          <label class="field-label flex-1 min-w-[140px]">Código de ubicación
            <input name="codigo_ubicacion" required placeholder="ej. A-02-R01-N01" class="field" />
          </label>
          <label class="field-label flex-1 min-w-[160px]">Descripción (opcional)
            <input name="descripcion" placeholder="ej. Zona A, Rack 1" class="field" />
          </label>
          <button class="btn-secondary" type="submit">+ Agregar ubicación</button>
        </form>
      </div>`).join("")
    : `<p class="text-sm text-slate-400 italic">Sin almacenes registrados.</p>`;
}

async function toggleWarehouseActive(almacenId, nextActive) {
  if (!confirm(`¿${nextActive ? "Activar" : "Desactivar"} este almacén?`)) return;
  const r = await api(`/inventory/warehouses-managed/${almacenId}`, { method: "PATCH", body: JSON.stringify({ channel: "web", activo: nextActive }) });
  if (r.status === "success") { toast(`Almacén ${nextActive ? "activado" : "desactivado"}`); loadWarehousesManaged(); loadWarehouseOptions(); }
  else toast(r.error.message, false);
}

async function toggleLocationActive(ubicacionId, nextActive) {
  const r = await api(`/inventory/locations/${ubicacionId}`, { method: "PATCH", body: JSON.stringify({ channel: "web", activo: nextActive }) });
  if (r.status === "success") { toast(`Ubicación ${nextActive ? "activada" : "desactivada"}`); loadWarehousesManaged(); }
  else toast(r.error.message, false);
}

async function addLocation(e, almacenCodigo) {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { channel: "web", almacen_codigo: almacenCodigo, codigo_ubicacion: f.get("codigo_ubicacion"), descripcion: f.get("descripcion") || null };
  const r = await api("/inventory/locations", { method: "POST", body: JSON.stringify(payload) });
  if (r.status === "success") { toast("Ubicación agregada"); loadWarehousesManaged(); }
  else toast(r.error.message, false);
  return false;
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

// -------- Compras: cuentas por pagar --------
let currentPayableCodigo = null;
const PAYABLE_STATUS_TONES = { PENDIENTE: "pendiente", PARCIAL: "pendiente", PAGADA: "ok", VENCIDA: "low", ANULADA: "devolucion" };
function payableStatusBadge(estado) {
  return badge(estado, PAYABLE_STATUS_TONES[estado] || "devolucion");
}

document.getElementById("form-payable-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    proveedor_ruc: f.get("proveedor_ruc"), numero_proveedor: f.get("numero_proveedor") || null,
    orden_compra_numero: f.get("orden_compra_numero") || null, monto_total: Number(f.get("monto_total")),
    fecha_emision: f.get("fecha_emision") || null, fecha_vencimiento: f.get("fecha_vencimiento") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/payables/invoices", { method: "POST", body: JSON.stringify(payload) });
    renderResult("payable-create-result", r);
    if (r.status === "success") { toast(`Factura ${r.data.factura.codigo} registrada`); e.target.reset(); loadFacturas(1); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function exportPayablesCsv() {
  const estado = document.getElementById("payable-filter-estado").value;
  const params = new URLSearchParams({ page_size: 2000 });
  if (estado) params.set("estado", estado);
  const r = await api(`/payables/invoices?${params.toString()}`);
  const items = r.data?.items || [];
  downloadCsv(
    "cuentas-por-pagar.csv",
    ["Código", "Proveedor", "N° proveedor", "Moneda", "Monto total", "Monto pagado", "Emisión", "Vencimiento", "Estado"],
    items.map((f) => [f.codigo, f.proveedor_nombre || "", f.numero_proveedor || "", f.moneda || "PEN", f.monto_total, f.monto_pagado,
      f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString("es-PE") : "",
      f.fecha_vencimiento ? new Date(f.fecha_vencimiento).toLocaleDateString("es-PE") : "", f.estado])
  );
}

async function loadFacturas(page) {
  const body = document.getElementById("payables-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("payable-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/payables/invoices?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver cuentas por pagar.", "lock");
    document.getElementById("payables-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((f) => `<tr class="${TR} cursor-pointer" onclick="openPayableModal('${f.codigo}')">
        <td class="${TD} font-semibold text-navy-900">${f.codigo}</td><td class="${TD}">${f.proveedor_nombre || "—"}</td>
        <td class="${TD}">${f.moneda || "PEN"} ${money(f.monto_total)}</td><td class="${TD}">${f.moneda || "PEN"} ${money(f.monto_pagado)}</td>
        <td class="${TD}">${f.fecha_vencimiento ? new Date(f.fecha_vencimiento).toLocaleDateString("es-PE") : "—"}</td>
        <td class="${TD}">${payableStatusBadge(f.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openPayableModal('${f.codigo}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(7, "Sin facturas de proveedor registradas.", "inbox");
  renderPager("payables-pager", r.data, (p) => loadFacturas(p));

  const rep = await api("/payables-report");
  if (rep.status === "success") {
    document.getElementById("payables-cards").innerHTML = [
      costeoCard("Pendiente", `PEN ${money(rep.data.totales.pendiente)}`, "text-amber-600"),
      costeoCard("Vencido", `PEN ${money(rep.data.totales.vencido)}`, rep.data.totales.vencido > 0 ? "text-rose-600" : "text-navy-950"),
    ].join("");
  }
}

async function openPayableModal(codigo) {
  currentPayableCodigo = codigo;
  const modal = document.getElementById("payable-modal");
  document.getElementById("payable-modal-title").textContent = codigo;
  document.getElementById("payable-modal-subtitle").textContent = "Cargando…";
  document.getElementById("payable-summary-cards").innerHTML = "";
  document.getElementById("payable-payments-body").innerHTML = `<tr><td colspan="3" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("payable-pay-result").innerHTML = "";
  document.getElementById("form-payable-pay").reset();
  modal.classList.remove("hidden");

  const r = await api(`/payables/invoices/${encodeURIComponent(codigo)}`);
  if (r.status !== "success") {
    document.getElementById("payable-modal-subtitle").textContent = r.error?.message || "No se pudo cargar la factura";
    return;
  }
  const f = r.data;
  document.getElementById("payable-modal-subtitle").innerHTML = `${f.proveedor_nombre || "—"} · ${payableStatusBadge(f.estado)}`;
  const isTerminal = f.estado === "PAGADA" || f.estado === "ANULADA";
  document.getElementById("form-payable-pay").classList.toggle("hidden", isTerminal);

  document.getElementById("payable-summary-cards").innerHTML = [
    costeoCard("Monto total", `${f.moneda || "PEN"} ${money(f.monto_total)}`),
    costeoCard("Pagado", `${f.moneda || "PEN"} ${money(f.monto_pagado)}`, "text-emerald-600"),
    costeoCard("Saldo pendiente", `${f.moneda || "PEN"} ${money(f.saldo_pendiente)}`, f.saldo_pendiente > 0 ? "text-rose-600" : "text-navy-950"),
  ].join("");

  const body = document.getElementById("payable-payments-body");
  body.innerHTML = (f.pagos || []).length
    ? f.pagos.map((p) => `<tr class="${TR}">
        <td class="${TD}">${p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString("es-PE") : "—"}</td>
        <td class="${TD}">${money(p.monto)}</td><td class="${TD}">${p.metodo || "—"}</td>
      </tr>`).join("")
    : emptyRow(3, "Sin pagos registrados todavía.", "inbox");
}

function closePayableModal() {
  document.getElementById("payable-modal").classList.add("hidden");
  currentPayableCodigo = null;
}

document.getElementById("form-payable-pay").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentPayableCodigo) return;
  const f = new FormData(e.target);
  const payload = { channel: "web", monto: Number(f.get("monto")), fecha_pago: f.get("fecha_pago") || null, metodo: f.get("metodo") || null };
  setFormLoading(e.target, true);
  try {
    const r = await api(`/payables/invoices/${encodeURIComponent(currentPayableCodigo)}/payments`, { method: "POST", body: JSON.stringify(payload) });
    renderResult("payable-pay-result", r);
    if (r.status === "success") { toast("Pago registrado"); openPayableModal(currentPayableCodigo); loadFacturas(1); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePayableModal(); });

// -------- Proyectos --------
let currentProjectCodigo = null;
let currentProjectId = null;

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
  currentProjectId = p.proyecto_id;
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
    ? items.map((c) => `<tr class="${TR}">
        <td class="${TD}">${c.ruc}</td><td class="${TD}">${c.razon_social}</td><td class="${TD}">${c.contacto || "—"}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="openDocumentsModal('cliente', '${c.cliente_id}', '${c.razon_social.replace(/'/g, "\\'")}')">Documentos</button></td>
      </tr>`).join("")
    : emptyRow(4, "Sin clientes registrados.", "inbox");
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

// -------- Contabilidad: reportes financieros --------
const REPORT_ACCOUNT_TYPE_TONES = { ACTIVO: "ok", PASIVO: "low", PATRIMONIO: "pendiente", INGRESO: "ok", GASTO: "low" };
function reportAccountRow(c) {
  return `<tr class="${TR}">
    <td class="${TD} font-mono">${c.codigo}</td><td class="${TD}">${c.nombre}</td>
    <td class="${TD}">${badge(c.tipo, REPORT_ACCOUNT_TYPE_TONES[c.tipo] || "devolucion")}</td>
    <td class="${TD} ${c.saldo < 0 ? "text-rose-600" : ""}">${money(c.saldo)}</td>
  </tr>`;
}

async function loadIncomeStatement() {
  const body = document.getElementById("income-statement-body");
  body.innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const desde = document.getElementById("income-statement-desde").value;
  const hasta = document.getElementById("income-statement-hasta").value;
  const params = new URLSearchParams();
  if (desde) params.set("fecha_desde", desde);
  if (hasta) params.set("fecha_hasta", hasta);
  const r = await api(`/accounting/reports/income-statement?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(4, r.error?.message || "Tu rol no tiene permiso para ver reportes financieros.", "lock");
    document.getElementById("income-statement-cards").innerHTML = "";
    return;
  }
  const d = r.data;
  document.getElementById("income-statement-cards").innerHTML = [
    costeoCard("Total ingresos", `PEN ${money(d.total_ingresos)}`, "text-emerald-600"),
    costeoCard("Total gastos", `PEN ${money(d.total_gastos)}`, "text-rose-600"),
    costeoCard("Utilidad neta", `PEN ${money(d.utilidad_neta)}`, d.utilidad_neta >= 0 ? "text-navy-950" : "text-rose-600"),
  ].join("");
  body.innerHTML = d.cuentas.length
    ? d.cuentas.map(reportAccountRow).join("")
    : emptyRow(4, "Sin movimientos contabilizados en el rango seleccionado.", "inbox");
}

async function loadBalanceSheet() {
  const body = document.getElementById("balance-sheet-body");
  body.innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const corte = document.getElementById("balance-sheet-corte").value;
  const params = corte ? `?fecha_corte=${encodeURIComponent(corte)}` : "";
  const r = await api(`/accounting/reports/balance-sheet${params}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(4, r.error?.message || "Tu rol no tiene permiso para ver reportes financieros.", "lock");
    document.getElementById("balance-sheet-cards").innerHTML = "";
    return;
  }
  const d = r.data;
  document.getElementById("balance-sheet-cards").innerHTML = [
    costeoCard("Total activo", `PEN ${money(d.total_activo)}`),
    costeoCard("Total pasivo", `PEN ${money(d.total_pasivo)}`),
    costeoCard("Total patrimonio", `PEN ${money(d.total_patrimonio)}`, "text-emerald-600"),
  ].join("");
  const filas = d.cuentas.length ? d.cuentas.map(reportAccountRow).join("") : "";
  const filaResultado = `<tr class="${TR}">
    <td class="${TD} font-mono">—</td><td class="${TD} italic">Resultado del ejercicio (acumulado)</td>
    <td class="${TD}">${badge("PATRIMONIO", "pendiente")}</td>
    <td class="${TD} ${d.resultado_ejercicio < 0 ? "text-rose-600" : ""}">${money(d.resultado_ejercicio)}</td>
  </tr>`;
  body.innerHTML = (filas + filaResultado) || emptyRow(4, "Sin movimientos contabilizados hasta la fecha de corte.", "inbox");
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

// -------- CRM / Leads --------
let currentLeadCodigo = null;
let currentLeadId = null;
let leadQuoteDraftLines = [];
const LEAD_STAGE_TONES = { NUEVO: "pendiente", CONTACTADO: "pendiente", CALIFICADO: "pendiente", PROPUESTA: "pendiente", GANADO: "ok", PERDIDO: "low" };
function leadStageBadge(etapa) {
  return badge(etapa, LEAD_STAGE_TONES[etapa] || "devolucion");
}

document.getElementById("form-lead-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    nombre_contacto: f.get("nombre_contacto"), empresa: f.get("empresa") || null, telefono: f.get("telefono") || null,
    email: f.get("email") || null, cliente_ruc: f.get("cliente_ruc") || null, origen: f.get("origen") || null,
    monto_estimado: f.get("monto_estimado") ? Number(f.get("monto_estimado")) : null,
    fecha_proximo_seguimiento: f.get("fecha_proximo_seguimiento") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/crm/leads", { method: "POST", body: JSON.stringify(payload) });
    renderResult("lead-create-result", r);
    if (r.status === "success") { toast(`Lead ${r.data.lead.codigo} creado`); e.target.reset(); loadLeads(1); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadLeads(page) {
  const body = document.getElementById("leads-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const etapa = document.getElementById("lead-filter-etapa").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (etapa) params.set("etapa", etapa);
  const r = await api(`/crm/leads?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver el CRM.", "lock");
    document.getElementById("leads-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((l) => `<tr class="${TR} cursor-pointer" onclick="openLeadModal('${l.codigo}')">
        <td class="${TD} font-semibold text-navy-900">${l.codigo}</td><td class="${TD}">${l.nombre_contacto}${l.empresa ? ` <span class="text-slate-400">(${l.empresa})</span>` : ""}</td>
        <td class="${TD}">${l.cliente_nombre || "—"}</td><td class="${TD}">${l.monto_estimado ? `${l.moneda || "PEN"} ${money(l.monto_estimado)}` : "—"}</td>
        <td class="${TD}">${l.responsable_nombre || "—"}</td><td class="${TD}">${leadStageBadge(l.etapa)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openLeadModal('${l.codigo}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(7, "Sin leads registrados.", "inbox");
  renderPager("leads-pager", r.data, (p) => loadLeads(p));
}

async function exportLeadsCsv() {
  const etapa = document.getElementById("lead-filter-etapa").value;
  const params = new URLSearchParams({ page_size: 2000 });
  if (etapa) params.set("etapa", etapa);
  const r = await api(`/crm/leads?${params.toString()}`);
  const items = r.data?.items || [];
  downloadCsv(
    "leads.csv",
    ["Código", "Contacto", "Empresa", "Cliente", "Teléfono", "Email", "Monto est.", "Moneda", "Responsable", "Etapa", "Próximo seguimiento"],
    items.map((l) => [l.codigo, l.nombre_contacto, l.empresa || "", l.cliente_nombre || "", l.telefono || "", l.email || "",
      l.monto_estimado || "", l.moneda || "", l.responsable_nombre || "", l.etapa, l.fecha_proximo_seguimiento || ""])
  );
}

function renderLeadQuoteDraftLines() {
  const body = document.getElementById("lead-quote-draft-lines-body");
  body.innerHTML = leadQuoteDraftLines.length
    ? leadQuoteDraftLines.map((it, i) => `<tr class="${TR}">
        <td class="${TD}">${it.descripcion}</td><td class="${TD}">${it.cantidad}</td>
        <td class="${TD}">${money(it.precio_unitario)}</td><td class="${TD}">${money(it.cantidad * it.precio_unitario)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="removeLeadQuoteDraftLine(${i})">Quitar</button></td>
      </tr>`).join("")
    : emptyRow(5, "Agrega al menos un ítem para poder convertir el lead.", "inbox");
}

function addLeadQuoteDraftLine() {
  const descripcion = document.getElementById("lead-quote-line-descripcion").value.trim();
  const cantidad = Number(document.getElementById("lead-quote-line-cantidad").value || 0);
  const precio_unitario = Number(document.getElementById("lead-quote-line-precio").value || 0);
  if (!descripcion || cantidad <= 0 || precio_unitario < 0) { toast("Ingresa descripción, cantidad (>0) y precio unitario (>=0) del ítem", false); return; }
  leadQuoteDraftLines.push({ descripcion, cantidad, precio_unitario });
  document.getElementById("lead-quote-line-descripcion").value = "";
  document.getElementById("lead-quote-line-cantidad").value = "";
  document.getElementById("lead-quote-line-precio").value = "";
  renderLeadQuoteDraftLines();
}
function removeLeadQuoteDraftLine(i) {
  leadQuoteDraftLines.splice(i, 1);
  renderLeadQuoteDraftLines();
}

async function openLeadModal(codigo) {
  currentLeadCodigo = codigo;
  leadQuoteDraftLines = [];
  renderLeadQuoteDraftLines();
  const modal = document.getElementById("lead-modal");
  document.getElementById("lead-modal-title").textContent = codigo;
  document.getElementById("lead-modal-subtitle").textContent = "Cargando…";
  document.getElementById("lead-info-line").textContent = "";
  document.getElementById("lead-activities-body").innerHTML = `<tr><td colspan="3" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("lead-activity-result").innerHTML = "";
  document.getElementById("lead-convert-result").innerHTML = "";
  document.getElementById("form-lead-activity").reset();
  modal.classList.remove("hidden");

  const r = await api(`/crm/leads/${encodeURIComponent(codigo)}`);
  if (r.status !== "success") {
    document.getElementById("lead-modal-subtitle").textContent = r.error?.message || "No se pudo cargar el lead";
    return;
  }
  const l = r.data;
  currentLeadId = l.lead_id;
  document.getElementById("lead-modal-subtitle").innerHTML = `${l.nombre_contacto}${l.empresa ? ` — ${l.empresa}` : ""} · ${leadStageBadge(l.etapa)}`;
  const info = [
    l.cliente_nombre ? `Cliente: ${l.cliente_nombre}` : "Sin cliente vinculado",
    l.telefono ? `Tel: ${l.telefono}` : null,
    l.email ? `Email: ${l.email}` : null,
    l.monto_estimado ? `Estimado: ${l.moneda || "PEN"} ${money(l.monto_estimado)}` : null,
    l.motivo_perdida ? `Motivo de pérdida: ${l.motivo_perdida}` : null,
    l.cotizacion_codigo ? `Convertido en cotización: ${l.cotizacion_codigo}` : null,
  ].filter(Boolean).join(" · ");
  document.getElementById("lead-info-line").textContent = info;

  const isClosed = l.etapa === "GANADO" || l.etapa === "PERDIDO";
  document.getElementById("lead-stage-actions").querySelectorAll("button[onclick^='setLeadStage'], button[onclick^='promptLeadLost']").forEach((btn) => {
    btn.classList.toggle("hidden", isClosed);
  });
  document.getElementById("form-lead-activity").classList.toggle("hidden", isClosed);
  document.getElementById("lead-convert-section").classList.toggle("hidden", isClosed || !l.cliente_id);

  document.getElementById("lead-activities-body").innerHTML = (l.actividades || []).length
    ? l.actividades.map((a) => `<tr class="${TR}">
        <td class="${TD}">${new Date(a.fecha).toLocaleDateString("es-PE")}</td><td class="${TD}">${a.tipo}</td><td class="${TD}">${a.descripcion}</td>
      </tr>`).join("")
    : emptyRow(3, "Sin seguimiento registrado todavía.", "inbox");
}

function closeLeadModal() {
  document.getElementById("lead-modal").classList.add("hidden");
  currentLeadCodigo = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLeadModal(); });

async function setLeadStage(etapa) {
  if (!currentLeadCodigo) return;
  const r = await api(`/crm/leads/${encodeURIComponent(currentLeadCodigo)}/stage`, { method: "POST", body: JSON.stringify({ channel: "web", etapa }) });
  if (r.status === "success") { toast(`Lead marcado ${etapa.toLowerCase()}`); openLeadModal(currentLeadCodigo); loadLeads(1); }
  else toast(r.error.message, false);
}

function promptLeadLost() {
  const motivo = prompt("¿Por qué se perdió este lead?");
  if (!motivo) return;
  setLeadStageLost(motivo);
}
async function setLeadStageLost(motivo) {
  const r = await api(`/crm/leads/${encodeURIComponent(currentLeadCodigo)}/stage`, { method: "POST", body: JSON.stringify({ channel: "web", etapa: "PERDIDO", motivo_perdida: motivo }) });
  if (r.status === "success") { toast("Lead marcado perdido"); openLeadModal(currentLeadCodigo); loadLeads(1); }
  else toast(r.error.message, false);
}

document.getElementById("form-lead-activity").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentLeadCodigo) return;
  const f = new FormData(e.target);
  const payload = { channel: "web", tipo: f.get("tipo"), descripcion: f.get("descripcion") };
  setFormLoading(e.target, true);
  try {
    const r = await api(`/crm/leads/${encodeURIComponent(currentLeadCodigo)}/activities`, { method: "POST", body: JSON.stringify(payload) });
    renderResult("lead-activity-result", r);
    if (r.status === "success") { toast("Seguimiento registrado"); e.target.reset(); openLeadModal(currentLeadCodigo); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function convertLeadToQuote() {
  if (!currentLeadCodigo) return;
  if (leadQuoteDraftLines.length === 0) { toast("Agrega al menos un ítem", false); return; }
  if (!confirm(`¿Convertir el lead ${currentLeadCodigo} en una cotización?`)) return;
  const r = await api(`/crm/leads/${encodeURIComponent(currentLeadCodigo)}/convert`, { method: "POST", body: JSON.stringify({ channel: "web", items: leadQuoteDraftLines }) });
  renderResult("lead-convert-result", r);
  if (r.status === "success") {
    toast(`Cotización ${r.data.cotizacion.codigo} creada a partir del lead`);
    loadLeads(1);
    openLeadModal(currentLeadCodigo);
  } else toast(r.error.message, false);
}

// -------- Ventas: cotizaciones --------
let quoteDraftLines = [];
let currentQuoteCodigo = null;

function renderQuoteDraftLines() {
  const body = document.getElementById("quote-draft-lines-body");
  body.innerHTML = quoteDraftLines.length
    ? quoteDraftLines.map((it, i) => `<tr class="${TR}">
        <td class="${TD}">${it.descripcion}</td><td class="${TD}">${it.cantidad}</td>
        <td class="${TD}">${money(it.precio_unitario)}</td><td class="${TD}">${money(it.cantidad * it.precio_unitario)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="removeQuoteDraftLine(${i})">Quitar</button></td>
      </tr>`).join("")
    : emptyRow(5, "Agrega al menos un ítem para poder crear la cotización.", "inbox");
}

function addQuoteDraftLine() {
  const descripcion = document.getElementById("quote-line-descripcion").value.trim();
  const cantidad = Number(document.getElementById("quote-line-cantidad").value || 0);
  const precio_unitario = Number(document.getElementById("quote-line-precio").value || 0);
  if (!descripcion || cantidad <= 0 || precio_unitario < 0) { toast("Ingresa descripción, cantidad (>0) y precio unitario (>=0) del ítem", false); return; }
  quoteDraftLines.push({ descripcion, cantidad, precio_unitario });
  document.getElementById("quote-line-descripcion").value = "";
  document.getElementById("quote-line-cantidad").value = "";
  document.getElementById("quote-line-precio").value = "";
  renderQuoteDraftLines();
}
function removeQuoteDraftLine(i) {
  quoteDraftLines.splice(i, 1);
  renderQuoteDraftLines();
}
renderQuoteDraftLines();

document.getElementById("form-quote-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (quoteDraftLines.length === 0) { toast("Agrega al menos un ítem", false); return; }
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    cliente_ruc: f.get("cliente_ruc"), proyecto_codigo: f.get("proyecto_codigo") || null,
    fecha_emision: f.get("fecha_emision") || null, validez_dias: f.get("validez_dias") ? Number(f.get("validez_dias")) : null,
    items: quoteDraftLines,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/quotes", { method: "POST", body: JSON.stringify(payload) });
    renderResult("quote-create-result", r);
    if (r.status === "success") {
      toast(`Cotización ${r.data.cotizacion.codigo} creada`);
      e.target.reset();
      quoteDraftLines = [];
      renderQuoteDraftLines();
      loadCotizaciones(1);
    } else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

const QUOTE_STATUS_TONES = { BORRADOR: "pendiente", ENVIADA: "pendiente", ACEPTADA: "ok", RECHAZADA: "low", CONVERTIDA: "devolucion" };
function quoteStatusBadge(estado) {
  return badge(estado, QUOTE_STATUS_TONES[estado] || "devolucion");
}

async function loadCotizaciones(page) {
  const body = document.getElementById("quotes-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("quote-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/quotes?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver cotizaciones.", "lock");
    document.getElementById("quotes-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((c) => `<tr class="${TR} cursor-pointer" onclick="openQuoteModal('${c.codigo}')">
        <td class="${TD} font-semibold text-navy-900">${c.codigo}</td><td class="${TD}">${c.cliente_nombre || "—"}</td>
        <td class="${TD}">${c.codigo_proyecto || "—"}</td><td class="${TD}">${c.moneda || "PEN"} ${money(c.total)}</td>
        <td class="${TD}">${quoteStatusBadge(c.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openQuoteModal('${c.codigo}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(6, "Sin cotizaciones registradas.", "inbox");
  renderPager("quotes-pager", r.data, (p) => loadCotizaciones(p));
}

async function openQuoteModal(codigo) {
  currentQuoteCodigo = codigo;
  const modal = document.getElementById("quote-modal");
  document.getElementById("quote-modal-title").textContent = codigo;
  document.getElementById("quote-modal-subtitle").textContent = "Cargando…";
  document.getElementById("quote-items-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("quote-total-line").textContent = "";
  document.getElementById("quote-convert-result").innerHTML = "";
  modal.classList.remove("hidden");

  const r = await api(`/quotes/${encodeURIComponent(codigo)}`);
  if (r.status !== "success") {
    document.getElementById("quote-modal-subtitle").textContent = r.error?.message || "No se pudo cargar la cotización";
    return;
  }
  const c = r.data;
  document.getElementById("quote-modal-subtitle").innerHTML = `${c.cliente_nombre || "—"} ${c.codigo_proyecto ? `· Proyecto ${c.codigo_proyecto}` : ""} · ${quoteStatusBadge(c.estado)}`;

  const isTerminal = c.estado === "CONVERTIDA" || c.estado === "RECHAZADA";
  const actions = document.getElementById("quote-status-actions");
  actions.querySelector("button[onclick=\"setQuoteStatus('ENVIADA')\"]").classList.toggle("hidden", isTerminal || c.estado !== "BORRADOR");
  actions.querySelector("button[onclick=\"setQuoteStatus('ACEPTADA')\"]").classList.toggle("hidden", isTerminal || c.estado === "ACEPTADA");
  actions.querySelector("button[onclick=\"setQuoteStatus('RECHAZADA')\"]").classList.toggle("hidden", isTerminal);
  actions.querySelector("button[onclick=\"convertQuote()\"]").classList.toggle("hidden", c.estado !== "ACEPTADA");

  document.getElementById("quote-items-body").innerHTML = (c.items || []).length
    ? c.items.map((it) => `<tr class="${TR}">
        <td class="${TD}">${it.descripcion}</td><td class="${TD}">${it.cantidad}</td>
        <td class="${TD}">${money(it.precio_unitario)}</td><td class="${TD}">${money(it.cantidad * it.precio_unitario)}</td>
      </tr>`).join("")
    : emptyRow(4, "Sin ítems.", "inbox");
  document.getElementById("quote-total-line").textContent = `Total: ${c.moneda || "PEN"} ${money(c.total)}`;
}

function closeQuoteModal() {
  document.getElementById("quote-modal").classList.add("hidden");
  currentQuoteCodigo = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQuoteModal(); });

async function setQuoteStatus(estado) {
  if (!currentQuoteCodigo) return;
  const r = await api(`/quotes/${encodeURIComponent(currentQuoteCodigo)}/status`, { method: "POST", body: JSON.stringify({ channel: "web", estado }) });
  if (r.status === "success") { toast(`Cotización ${estado.toLowerCase()}`); openQuoteModal(currentQuoteCodigo); loadCotizaciones(1); }
  else toast(r.error.message, false);
}

async function convertQuote() {
  if (!currentQuoteCodigo) return;
  if (!confirm(`¿Convertir la cotización ${currentQuoteCodigo} en un contrato de Ventas?`)) return;
  const r = await api(`/quotes/${encodeURIComponent(currentQuoteCodigo)}/convert`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
  renderResult("quote-convert-result", r);
  if (r.status === "success") {
    toast(`Contrato ${r.data.contrato.codigo_contrato} creado a partir de la cotización`);
    loadCotizaciones(1);
    openQuoteModal(currentQuoteCodigo);
  } else toast(r.error.message, false);
}

// -------- Ventas: contratos --------
let hitoDraftLines = [];
let currentContractCodigo = null;
let currentContractId = null;
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
  currentContractId = c.contrato_id;
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

// -------- Activos: activos instalados --------
let currentAssetId = null;
const ASSET_STATUS_TONES = { OPERATIVO: "ok", EN_MANTENIMIENTO: "pendiente", FUERA_DE_SERVICIO: "low", RETIRADO: "devolucion" };
function assetStatusBadge(estado) {
  return badge(estado, ASSET_STATUS_TONES[estado] || "devolucion");
}
const MAINTENANCE_STATUS_TONES = { PROGRAMADO: "pendiente", EN_PROCESO: "pendiente", COMPLETADO: "ok", CANCELADO: "devolucion" };
function maintenanceStatusBadge(estado) {
  return badge(estado, MAINTENANCE_STATUS_TONES[estado] || "devolucion");
}

document.getElementById("form-asset-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web",
    descripcion: f.get("descripcion"), sku: f.get("sku") || null, serie_numero: f.get("serie_numero") || null,
    cliente_ruc: f.get("cliente_ruc") || null, proyecto_codigo: f.get("proyecto_codigo") || null,
    fecha_instalacion: f.get("fecha_instalacion") || null, garantia_inicio: f.get("garantia_inicio") || null, garantia_fin: f.get("garantia_fin") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/assets", { method: "POST", body: JSON.stringify(payload) });
    renderResult("asset-create-result", r);
    if (r.status === "success") { toast("Activo registrado"); e.target.reset(); loadActivos(1); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadActivos(page) {
  const body = document.getElementById("assets-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("asset-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 20 });
  if (estado) params.set("estado", estado);
  const r = await api(`/assets?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver activos.", "lock");
    document.getElementById("assets-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((a) => `<tr class="${TR} cursor-pointer" onclick="openAssetModal('${a.activo_id}')">
        <td class="${TD} font-semibold text-navy-900">${a.descripcion}</td><td class="${TD}">${a.sku || "—"}</td>
        <td class="${TD}">${a.cliente_nombre || "—"}</td><td class="${TD}">${a.codigo_proyecto || "—"}</td>
        <td class="${TD}">${a.garantia_fin ? new Date(a.garantia_fin).toLocaleDateString("es-PE") : "—"}</td>
        <td class="${TD}">${assetStatusBadge(a.estado)}</td>
        <td class="${TD}"><button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); openAssetModal('${a.activo_id}')">Ver</button></td>
      </tr>`).join("")
    : emptyRow(7, "Sin activos registrados.", "inbox");
  renderPager("assets-pager", r.data, (p) => loadActivos(p));
}

async function openAssetModal(activoId) {
  currentAssetId = activoId;
  const modal = document.getElementById("asset-modal");
  document.getElementById("asset-modal-title").textContent = "Cargando…";
  document.getElementById("asset-modal-subtitle").textContent = "";
  document.getElementById("asset-maintenance-body").innerHTML = `<tr><td colspan="5" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("asset-maintenance-result").innerHTML = "";
  document.getElementById("form-asset-maintenance-schedule").reset();
  modal.classList.remove("hidden");

  const r = await api(`/assets/${encodeURIComponent(activoId)}`);
  if (r.status !== "success") {
    document.getElementById("asset-modal-subtitle").textContent = r.error?.message || "No se pudo cargar el activo";
    return;
  }
  const a = r.data;
  document.getElementById("asset-modal-title").textContent = a.descripcion;
  document.getElementById("asset-modal-subtitle").innerHTML = `${a.cliente_nombre || "—"} ${a.codigo_proyecto ? `· Proyecto ${a.codigo_proyecto}` : ""} · ${assetStatusBadge(a.estado)}`;

  const actions = document.getElementById("asset-status-actions");
  actions.querySelector("button[onclick=\"setAssetStatus('OPERATIVO')\"]").classList.toggle("hidden", a.estado === "OPERATIVO" || a.estado === "RETIRADO");
  actions.querySelector("button[onclick=\"setAssetStatus('FUERA_DE_SERVICIO')\"]").classList.toggle("hidden", a.estado === "FUERA_DE_SERVICIO" || a.estado === "RETIRADO");
  actions.querySelector("button[onclick=\"setAssetStatus('RETIRADO')\"]").classList.toggle("hidden", a.estado === "RETIRADO");
  document.getElementById("form-asset-maintenance-schedule").classList.toggle("hidden", a.estado === "RETIRADO");

  const body = document.getElementById("asset-maintenance-body");
  body.innerHTML = (a.mantenimientos || []).length
    ? a.mantenimientos.map((m) => {
        const abierto = m.estado === "PROGRAMADO" || m.estado === "EN_PROCESO";
        return `<tr class="${TR}">
          <td class="${TD}">${m.tipo}</td><td class="${TD}">${m.fecha_programada ? new Date(m.fecha_programada).toLocaleDateString("es-PE") : "—"}</td>
          <td class="${TD}">${m.tecnico_nombre || "—"}</td><td class="${TD}">${maintenanceStatusBadge(m.estado)}</td>
          <td class="${TD}">${abierto ? `<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="completeMaintenance('${m.mantenimiento_id}')">Completar</button>` : "—"}</td>
        </tr>`;
      }).join("")
    : emptyRow(5, "Sin mantenimientos registrados todavía.", "inbox");
}

function closeAssetModal() {
  document.getElementById("asset-modal").classList.add("hidden");
  currentAssetId = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAssetModal(); });

async function setAssetStatus(estado) {
  if (!currentAssetId) return;
  const r = await api(`/assets/${encodeURIComponent(currentAssetId)}/status`, { method: "POST", body: JSON.stringify({ channel: "web", estado }) });
  if (r.status === "success") { toast("Estado actualizado"); openAssetModal(currentAssetId); loadActivos(1); }
  else toast(r.error.message, false);
}

document.getElementById("form-asset-maintenance-schedule").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentAssetId) return;
  const f = new FormData(e.target);
  const payload = { channel: "web", activo_id: currentAssetId, tipo: f.get("tipo"), descripcion: f.get("descripcion") || null, fecha_programada: f.get("fecha_programada") || null };
  setFormLoading(e.target, true);
  try {
    const r = await api("/maintenance", { method: "POST", body: JSON.stringify(payload) });
    renderResult("asset-maintenance-result", r);
    if (r.status === "success") { toast("Mantenimiento programado"); openAssetModal(currentAssetId); loadActivos(1); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function completeMaintenance(mantenimientoId) {
  if (!confirm("¿Marcar este mantenimiento como completado?")) return;
  const r = await api(`/maintenance/${encodeURIComponent(mantenimientoId)}/complete`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
  if (r.status === "success") { toast("Mantenimiento completado"); openAssetModal(currentAssetId); loadActivos(1); }
  else toast(r.error.message, false);
}

function updateWarrantiesBadge(count) {
  const badge = document.getElementById("warranties-badge");
  if (count > 0) { badge.textContent = count > 99 ? "99+" : count; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}

async function loadWarranties() {
  const body = document.getElementById("warranties-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const dias = document.getElementById("warranties-dias").value;
  const r = await api(`/assets-warranties-expiring?dias=${encodeURIComponent(dias)}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver esto.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((a) => `<tr class="${TR} cursor-pointer" onclick="openAssetModal('${a.activo_id}')">
        <td class="${TD} font-semibold text-navy-900">${a.descripcion}</td><td class="${TD}">${a.sku || "—"}</td>
        <td class="${TD}">${a.cliente_nombre || "—"}</td><td class="${TD}">${a.codigo_proyecto || "—"}</td>
        <td class="${TD}">${new Date(a.garantia_fin).toLocaleDateString("es-PE")}</td>
        <td class="${TD}">${a.dias_restantes < 0 ? `<span class="text-rose-600 font-semibold">Vencida hace ${Math.abs(a.dias_restantes)} días</span>` : `${a.dias_restantes} días`}</td>
      </tr>`).join("")
    : emptyRow(6, "Sin activos con garantía por vencer en esta ventana.", "inbox");
  updateWarrantiesBadge(items.length);
}

// -------- Activos: mantenimientos (listado global) --------
async function loadMantenimientos(page) {
  const body = document.getElementById("maintenance-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const estado = document.getElementById("maintenance-filter-estado").value;
  const params = new URLSearchParams({ page: page || 1, page_size: 30 });
  if (estado) params.set("estado", estado);
  const r = await api(`/maintenance?${params.toString()}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver mantenimientos.", "lock");
    document.getElementById("maintenance-pager").innerHTML = "";
    return;
  }
  const items = r.data.items || [];
  body.innerHTML = items.length
    ? items.map((m) => {
        const abierto = m.estado === "PROGRAMADO" || m.estado === "EN_PROCESO";
        return `<tr class="${TR} cursor-pointer" onclick="openAssetModal('${m.activo_id}')">
          <td class="${TD} font-semibold text-navy-900">${m.activo_descripcion}</td><td class="${TD}">${m.tipo}</td>
          <td class="${TD}">${m.fecha_programada ? new Date(m.fecha_programada).toLocaleDateString("es-PE") : "—"}</td>
          <td class="${TD}">${m.tecnico_nombre || "—"}</td><td class="${TD}">${maintenanceStatusBadge(m.estado)}</td>
          <td class="${TD}">${abierto ? `<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="event.stopPropagation(); completeMaintenanceFromList('${m.mantenimiento_id}')">Completar</button>` : "—"}</td>
        </tr>`;
      }).join("")
    : emptyRow(6, "Sin mantenimientos registrados.", "inbox");
  renderPager("maintenance-pager", r.data, (p) => loadMantenimientos(p));
}

async function completeMaintenanceFromList(mantenimientoId) {
  if (!confirm("¿Marcar este mantenimiento como completado?")) return;
  const r = await api(`/maintenance/${encodeURIComponent(mantenimientoId)}/complete`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
  if (r.status === "success") { toast("Mantenimiento completado"); loadMantenimientos(1); }
  else toast(r.error.message, false);
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
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/users");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para gestionar usuarios.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((u) => `<tr class="${TR}">
        <td class="${TD}">${u.nombre_completo}</td><td class="${TD}">${u.email}</td>
        <td class="${TD}">${u.rol_codigo}</td>
        <td class="${TD}">${badge(u.activo ? "ACTIVO" : "INACTIVO", u.activo ? "ok" : "devolucion")}</td>
        <td class="${TD}">
          <div class="flex items-center gap-1.5">
            <input type="text" value="${u.telegram_id || ""}" placeholder="sin vincular" class="field w-28 text-xs py-1" id="telegram-id-${u.usuario_id}" />
            <button type="button" class="btn-secondary px-2 py-1 text-xs" onclick="saveTelegramId('${u.usuario_id}')">Guardar</button>
          </div>
        </td>
        <td class="${TD}">
          <button class="${u.activo ? "btn-danger" : "btn-secondary"} px-3 py-1.5 text-xs" onclick="toggleUserActive('${u.usuario_id}', ${!u.activo})">
            ${u.activo ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>`).join("")
    : emptyRow(6, "Sin usuarios.", "inbox");
}

async function toggleUserActive(usuarioId, nextActive) {
  if (!confirm(`¿${nextActive ? "Activar" : "Desactivar"} este usuario?`)) return;
  const r = await api(`/users/${usuarioId}`, { method: "PATCH", body: JSON.stringify({ activo: nextActive }) });
  if (r.status === "success") { toast(`Usuario ${nextActive ? "activado" : "desactivado"}`); loadUsers(); }
  else toast(r.error.message, false);
}

async function saveTelegramId(usuarioId) {
  const input = document.getElementById(`telegram-id-${usuarioId}`);
  const r = await api(`/users/${usuarioId}`, { method: "PATCH", body: JSON.stringify({ telegram_id: input.value.trim() }) });
  if (r.status === "success") { toast("Telegram ID actualizado"); loadUsers(); }
  else toast(r.error.message, false);
}

// -------- Switch de módulos --------
const MODULE_ACCESS_ROLES = ["SUPERVISOR", "ALMACENERO", "COMPRAS", "VENTAS", "CONSULTA"];

function moduleToggleSwitch(modulo, rol, checked) {
  return `<label class="relative inline-flex items-center cursor-pointer">
    <input type="checkbox" class="sr-only peer" ${checked ? "checked" : ""} onchange="toggleModuleAccess('${modulo}','${rol}', this.checked)" />
    <div class="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-emerald-500 transition-colors"></div>
    <div class="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow transition-transform peer-checked:translate-x-4"></div>
  </label>`;
}

async function loadModuleAccess() {
  const body = document.getElementById("module-access-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/admin/module-access");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para gestionar módulos.", "lock");
    return;
  }
  const { access } = r.data;
  body.innerHTML = access.map((row) => `<tr class="${TR}">
      <td class="${TD} font-semibold text-navy-900">${row.label}</td>
      ${MODULE_ACCESS_ROLES.map((rol) => `<td class="${TD} text-center">${moduleToggleSwitch(row.modulo, rol, row.roles[rol])}</td>`).join("")}
    </tr>`).join("");
}

async function toggleModuleAccess(modulo, rol, habilitado) {
  const r = await api("/admin/module-access", { method: "POST", body: JSON.stringify({ channel: "web", modulo, rol_codigo: rol, habilitado }) });
  if (r.status === "success") toast(`Módulo ${habilitado ? "habilitado" : "deshabilitado"} para ${rol}`);
  else { toast(r.error.message, false); loadModuleAccess(); }
}

// -------- Roles y permisos --------
async function loadRolePermissions() {
  const container = document.getElementById("role-permissions-list");
  container.innerHTML = `<p class="text-sm text-slate-400 italic">Cargando…</p>`;
  const r = await api("/admin/role-permissions");
  if (r.status !== "success") {
    container.innerHTML = `<p class="text-sm text-slate-400 italic">${r.error?.message || "Tu rol no tiene permiso para ver esto."}</p>`;
    return;
  }
  container.innerHTML = r.data.map((row) => `
    <div class="form-card mb-4">
      <div class="font-bold text-navy-950 mb-2">${row.rol}</div>
      <div class="flex flex-wrap gap-1.5">
        ${row.permisos.map((p) => `<span class="font-mono text-[11px] px-2 py-1 rounded-md bg-slate-100 text-slate-600">${p}</span>`).join("")}
      </div>
    </div>`).join("");
}

// -------- Integraciones --------
async function loadIntegrationsStatus() {
  const container = document.getElementById("integrations-cards");
  container.innerHTML = `<p class="text-sm text-slate-400 italic">Cargando…</p>`;
  const r = await api("/admin/integrations-status");
  if (r.status !== "success") {
    container.innerHTML = `<p class="text-sm text-slate-400 italic">${r.error?.message || "Tu rol no tiene permiso para ver esto."}</p>`;
    return;
  }
  const items = [
    { label: "Asistente de IA (Gemini)", key: "gemini" },
    { label: "Bot de Telegram — token", key: "telegram_bot" },
    { label: "Bot de Telegram — webhook", key: "telegram_webhook" },
    { label: "Google Drive (documentos)", key: "google_drive" },
  ];
  container.innerHTML = items.map(({ label, key }) => {
    const s = r.data[key];
    return `<div class="form-card">
      <div class="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">${label}</div>
      <div class="mb-1">${badge(s.configurado ? "CONFIGURADO" : "NO CONFIGURADO", s.configurado ? "ok" : "low")}</div>
      <div class="text-xs text-slate-500 font-mono">${s.variable}</div>
    </div>`;
  }).join("");
}

// -------- Tokens de servicio (N8N y similares) --------
document.getElementById("form-api-token-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    channel: "web", etiqueta: f.get("etiqueta"), usuario_id: f.get("usuario_id"),
    expira_dias: f.get("expira_dias") || null,
  };
  setFormLoading(e.target, true);
  try {
    const r = await api("/admin/api-tokens", { method: "POST", body: JSON.stringify(payload) });
    const box = document.getElementById("api-token-new-result");
    if (r.status === "success") {
      box.className = "result-box ok";
      box.innerHTML = `<p class="font-semibold mb-2">Token creado — copialo ahora, no se volverá a mostrar:</p>
        <div class="flex items-center gap-2">
          <code class="flex-1 bg-white border border-slate-200 rounded px-2 py-1.5 text-xs break-all select-all">${r.data.token}</code>
          <button type="button" class="btn-secondary px-3 py-1.5 text-xs shrink-0" onclick="navigator.clipboard.writeText('${r.data.token}'); toast('Token copiado')">Copiar</button>
        </div>`;
      e.target.reset();
      loadApiTokens();
    } else {
      box.className = "result-box err";
      box.innerHTML = `<p>${r.error.message}</p>`;
      toast(r.error.message, false);
    }
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadApiTokenUserOptions() {
  const select = document.getElementById("api-token-usuario-select");
  const r = await api("/users");
  if (r.status !== "success") { select.innerHTML = `<option value="">—</option>`; return; }
  select.innerHTML = (r.data || []).filter((u) => u.activo)
    .map((u) => `<option value="${u.usuario_id}">${u.nombre_completo} (${u.rol_codigo})</option>`).join("");
}

async function loadApiTokens() {
  await loadApiTokenUserOptions();
  const body = document.getElementById("api-tokens-body");
  body.innerHTML = `<tr><td colspan="7" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/admin/api-tokens");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(7, r.error?.message || "Tu rol no tiene permiso para ver esto.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((t) => {
        const vencido = t.expira_en && new Date(t.expira_en) < new Date();
        const estado = t.revocado ? badge("REVOCADO", "low") : vencido ? badge("EXPIRADO", "low") : badge("ACTIVO", "ok");
        return `<tr class="${TR}">
          <td class="${TD} font-semibold text-navy-900">${t.etiqueta}</td>
          <td class="${TD}">${t.usuario_nombre} <span class="text-slate-400">(${t.usuario_rol})</span></td>
          <td class="${TD} font-mono text-xs">${t.prefijo}…</td>
          <td class="${TD}">${t.expira_en ? new Date(t.expira_en).toLocaleDateString("es-PE") : "No expira"}</td>
          <td class="${TD}">${t.ultimo_uso ? new Date(t.ultimo_uso).toLocaleString("es-PE") : "Nunca"}</td>
          <td class="${TD}">${estado}</td>
          <td class="${TD}">${t.revocado ? "" : `<button class="btn-danger px-3 py-1.5 text-xs" onclick="revokeApiToken('${t.api_token_id}')">Revocar</button>`}</td>
        </tr>`;
      }).join("")
    : emptyRow(7, "Sin tokens de servicio creados todavía.", "inbox");
}

async function revokeApiToken(apiTokenId) {
  if (!confirm("¿Revocar este token? Cualquier integración que lo use dejará de funcionar de inmediato.")) return;
  const r = await api(`/admin/api-tokens/${encodeURIComponent(apiTokenId)}/revoke`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
  if (r.status === "success") { toast("Token revocado"); loadApiTokens(); }
  else toast(r.error.message, false);
}

// -------- Automatizaciones N8N (webhooks salientes) --------
document.getElementById("form-n8n-webhook-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { channel: "web", evento: f.get("evento"), url: f.get("url"), secret: f.get("secret") || null };
  setFormLoading(e.target, true);
  try {
    const r = await api("/admin/n8n-webhooks", { method: "POST", body: JSON.stringify(payload) });
    if (r.status === "success") { toast("Webhook creado"); e.target.reset(); loadN8nWebhooks(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function loadN8nWebhooks() {
  const body = document.getElementById("n8n-webhooks-body");
  body.innerHTML = `<tr><td colspan="6" class="${TD_EMPTY}">Cargando…</td></tr>`;
  const r = await api("/admin/n8n-webhooks");
  if (r.status !== "success") {
    body.innerHTML = emptyRow(6, r.error?.message || "Tu rol no tiene permiso para ver esto.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((w) => `<tr class="${TR}">
        <td class="${TD} font-mono text-xs">${w.evento}</td>
        <td class="${TD} text-xs break-all">${w.url}</td>
        <td class="${TD}">${w.tiene_secret ? badge("SÍ", "ok") : badge("NO", "devolucion")}</td>
        <td class="${TD}">${w.activo ? badge("ACTIVO", "ok") : badge("INACTIVO", "low")}</td>
        <td class="${TD}">${new Date(w.created_at).toLocaleDateString("es-PE")}</td>
        <td class="${TD} whitespace-nowrap">
          <button class="btn-secondary px-3 py-1.5 text-xs mr-1.5" onclick="toggleN8nWebhook('${w.webhook_id}', ${!w.activo})">${w.activo ? "Desactivar" : "Activar"}</button>
          <button class="btn-danger px-3 py-1.5 text-xs" onclick="deleteN8nWebhook('${w.webhook_id}')">Eliminar</button>
        </td>
      </tr>`).join("")
    : emptyRow(6, "Sin webhooks configurados todavía.", "inbox");
}

async function toggleN8nWebhook(webhookId, activo) {
  const r = await api(`/admin/n8n-webhooks/${encodeURIComponent(webhookId)}/toggle`, { method: "POST", body: JSON.stringify({ channel: "web", activo }) });
  if (r.status === "success") { toast(activo ? "Webhook activado" : "Webhook desactivado"); loadN8nWebhooks(); }
  else toast(r.error.message, false);
}

async function deleteN8nWebhook(webhookId) {
  if (!confirm("¿Eliminar este webhook? Dejará de recibir eventos.")) return;
  const r = await api(`/admin/n8n-webhooks/${encodeURIComponent(webhookId)}?channel=web`, { method: "DELETE" });
  if (r.status === "success") { toast("Webhook eliminado"); loadN8nWebhooks(); }
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

// -------- Asistente de IA (chat flotante, Gemini) --------
let aiChatHistory = [];
let aiChatBusy = false;

function toggleAiChat() {
  const panel = document.getElementById("ai-chat-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    document.getElementById("ai-chat-input").focus();
    if (!aiChatHistory.length) {
      appendAiChatMessage("assistant", "Hola, soy el asistente del ERP. Puedo consultar stock, compras, proyectos, ventas, gastos, cuentas por pagar/cobrar, cotizaciones y activos — pregúntame lo que necesites saber.");
    }
  }
}

function appendAiChatMessage(kind, text) {
  const container = document.getElementById("ai-chat-messages");
  const div = document.createElement("div");
  div.className = `ai-chat-msg ${kind}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

document.getElementById("form-ai-chat").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (aiChatBusy) return;
  const input = document.getElementById("ai-chat-input");
  const mensaje = input.value.trim();
  if (!mensaje) return;
  input.value = "";
  appendAiChatMessage("user", mensaje);
  const pending = appendAiChatMessage("pending", "Pensando…");
  aiChatBusy = true;
  setFormLoading(e.target, true);
  try {
    const r = await api("/ai/chat", { method: "POST", body: JSON.stringify({ channel: "web", mensaje, historial: aiChatHistory }) });
    pending.remove();
    if (r.status === "success") {
      appendAiChatMessage("assistant", r.data.respuesta);
      aiChatHistory.push({ role: "user", parts: [{ text: mensaje }] });
      aiChatHistory.push({ role: "model", parts: [{ text: r.data.respuesta }] });
    } else {
      appendAiChatMessage("error", r.error?.message || "No se pudo consultar al asistente.");
    }
  } catch (err) {
    pending.remove();
    appendAiChatMessage("error", "No se pudo conectar con el asistente.");
  } finally {
    aiChatBusy = false;
    setFormLoading(e.target, false);
  }
});

// -------- Chatbot (administración del chatbot externo, conectado a futuro
// vía N8N: el widget real de la web/tienda no vive en este repositorio) --------
function updateChatbotBadge(count) {
  const badge = document.getElementById("chatbot-badge");
  if (count > 0) { badge.textContent = count > 99 ? "99+" : count; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}

let currentChatbotCodigo = null;

const CHATBOT_ESTADO_TONES = { ABIERTA: "ok", ATENDIDA: "transferencia", CERRADA: "low" };
function chatbotEstadoBadge(estado) { return badge(estado, CHATBOT_ESTADO_TONES[estado] || "devolucion"); }

async function loadChatbotConversations() {
  const list = document.getElementById("chatbot-conversations-list");
  list.innerHTML = `<div class="p-4 text-sm text-slate-400 italic text-center">Cargando…</div>`;
  const estado = document.getElementById("chatbot-filter-estado").value;
  const r = await api(`/chatbot/conversations${estado ? `?estado=${estado}` : ""}`);
  if (r.status !== "success") {
    list.innerHTML = `<div class="p-4 text-sm text-slate-400 italic text-center">${r.error?.message || "Tu rol no tiene permiso para ver esto."}</div>`;
    return;
  }
  const items = r.data.items || [];
  updateChatbotBadge(items.filter((c) => c.estado === "ABIERTA").length);
  list.innerHTML = items.length
    ? items.map((c) => `
      <button type="button" class="row-clickable w-full text-left px-3.5 py-3 border-b border-slate-100 hover:bg-cyan-50/40 transition ${c.codigo === currentChatbotCodigo ? "bg-cyan-50" : ""}" onclick="openChatbotConversation('${c.codigo}')">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-semibold text-navy-950 text-[13.5px] truncate">${c.nombre_contacto || c.contacto || "Visitante"}</span>
          ${chatbotEstadoBadge(c.estado)}
        </div>
        <div class="text-xs text-slate-500 truncate">${c.ultimo_mensaje || "—"}</div>
        <div class="text-[10.5px] text-slate-400 mt-1">${c.codigo} · ${new Date(c.updated_at).toLocaleString("es-PE")}</div>
      </button>`).join("")
    : `<div class="p-4 text-sm text-slate-400 italic text-center">Sin conversaciones todavía.</div>`;
}

async function openChatbotConversation(codigo) {
  currentChatbotCodigo = codigo;
  loadChatbotConversations();
  const panel = document.getElementById("chatbot-thread-panel");
  panel.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-16">Cargando…</div>`;

  const r = await api(`/chatbot/conversations/${encodeURIComponent(codigo)}`);
  if (r.status !== "success") {
    panel.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-16">${r.error?.message || "No se pudo cargar la conversación."}</div>`;
    return;
  }
  const c = r.data;
  const isClosed = c.estado === "CERRADA";
  const bubbles = (c.mensajes || []).map((m) => {
    const mine = m.remitente === "AGENTE";
    return `<div class="flex ${mine ? "justify-end" : "justify-start"} mb-2.5">
      <div class="max-w-[75%] rounded-xl px-3.5 py-2 text-sm ${mine ? "bg-navy-950 text-white" : "bg-slate-100 text-navy-950"}">
        <div>${m.texto}</div>
        <div class="text-[10px] mt-1 ${mine ? "text-white/50" : "text-slate-400"}">${m.remitente} · ${new Date(m.created_at).toLocaleString("es-PE")}</div>
      </div>
    </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-slate-100">
      <div>
        <div class="font-bold text-navy-950">${c.nombre_contacto || c.contacto || "Visitante"} <span class="text-slate-400 font-normal text-xs">(${c.codigo})</span></div>
        <div class="text-xs text-slate-500 mt-0.5">${c.canal} ${c.contacto ? `· ${c.contacto}` : ""} ${c.lead_codigo ? `· Lead ${c.lead_codigo}` : ""} · ${chatbotEstadoBadge(c.estado)}</div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${!c.lead_codigo ? `<button class="btn-secondary px-3 py-1.5 text-xs" onclick="convertChatbotToLead('${c.codigo}')">Convertir a lead</button>` : ""}
        ${!isClosed ? `<button class="btn-danger px-3 py-1.5 text-xs" onclick="closeChatbotConversation('${c.codigo}')">Cerrar</button>` : ""}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto mb-3" style="min-height:280px;">${bubbles || `<div class="text-sm text-slate-400 italic text-center py-10">Sin mensajes todavía.</div>`}</div>
    <form id="form-chatbot-reply" class="flex items-end gap-2 pt-3 border-t border-slate-100">
      <label class="field-label flex-1">Responder
        <textarea name="texto" rows="2" required class="field" placeholder="Escribí la respuesta para el visitante…"></textarea>
      </label>
      <button class="btn-primary btn-loading" type="submit"><span class="btn-label">Enviar</span></button>
    </form>`;

  document.getElementById("form-chatbot-reply").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = new FormData(e.target).get("texto");
    setFormLoading(e.target, true);
    try {
      const rr = await api(`/chatbot/conversations/${encodeURIComponent(codigo)}/reply`, { method: "POST", body: JSON.stringify({ channel: "web", texto }) });
      if (rr.status === "success") openChatbotConversation(codigo);
      else toast(rr.error.message, false);
    } finally {
      setFormLoading(e.target, false);
    }
  });
}

async function closeChatbotConversation(codigo) {
  if (!confirm("¿Cerrar esta conversación?")) return;
  const r = await api(`/chatbot/conversations/${encodeURIComponent(codigo)}/close`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
  if (r.status === "success") { toast("Conversación cerrada"); openChatbotConversation(codigo); }
  else toast(r.error.message, false);
}

async function convertChatbotToLead(codigo) {
  const r = await api(`/chatbot/conversations/${encodeURIComponent(codigo)}/convert-to-lead`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
  if (r.status === "success") { toast(`Lead ${r.data.lead.codigo} creado`); openChatbotConversation(codigo); }
  else toast(r.error.message, false);
}

async function openChatbotConfigModal() {
  const modal = document.getElementById("chatbot-config-modal");
  document.getElementById("chatbot-config-result").innerHTML = "";
  modal.classList.remove("hidden");
  const r = await api("/chatbot/config");
  if (r.status === "success") {
    const form = document.getElementById("form-chatbot-config");
    form.elements.habilitado.checked = r.data.habilitado;
    form.elements.mensaje_bienvenida.value = r.data.mensajeBienvenida;
  }
}
function closeChatbotConfigModal() {
  document.getElementById("chatbot-config-modal").classList.add("hidden");
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChatbotConfigModal(); });
document.getElementById("form-chatbot-config").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  setFormLoading(e.target, true);
  try {
    const r = await api("/chatbot/config", {
      method: "PUT",
      body: JSON.stringify({ channel: "web", habilitado: f.has("habilitado"), mensaje_bienvenida: f.get("mensaje_bienvenida") }),
    });
    const box = document.getElementById("chatbot-config-result");
    if (r.status === "success") { box.className = "result-box ok"; box.innerHTML = "<p>Configuración guardada.</p>"; }
    else { box.className = "result-box err"; box.innerHTML = `<p>${r.error.message}</p>`; }
  } finally {
    setFormLoading(e.target, false);
  }
});

// -------- Gestión documental (modal genérico reusado en Proyectos, Activos, Contratos, Leads y Clientes) --------
let currentDocEntidadTipo = null;
let currentDocEntidadId = null;

async function openDocumentsModal(entidadTipo, entidadId, titulo) {
  currentDocEntidadTipo = entidadTipo;
  currentDocEntidadId = entidadId;
  const modal = document.getElementById("documents-modal");
  document.getElementById("documents-modal-subtitle").textContent = titulo || "";
  document.getElementById("documents-list-body").innerHTML = `<tr><td colspan="4" class="${TD_EMPTY}">Cargando…</td></tr>`;
  document.getElementById("document-upload-result").innerHTML = "";
  document.getElementById("form-document-upload").reset();
  modal.classList.remove("hidden");
  await loadDocumentsList();
}

async function loadDocumentsList() {
  const body = document.getElementById("documents-list-body");
  if (!currentDocEntidadId) { body.innerHTML = emptyRow(4, "No se pudo determinar el registro.", "lock"); return; }
  const r = await api(`/documents?entidad_tipo=${encodeURIComponent(currentDocEntidadTipo)}&entidad_id=${encodeURIComponent(currentDocEntidadId)}`);
  if (r.status !== "success") {
    body.innerHTML = emptyRow(4, r.error?.message || "Tu rol no tiene permiso para ver documentos.", "lock");
    return;
  }
  const items = r.data || [];
  body.innerHTML = items.length
    ? items.map((d) => `<tr class="${TR}">
        <td class="${TD}"><a href="${d.url}" target="_blank" rel="noopener" class="text-accent-600 hover:underline">${d.nombre}</a></td>
        <td class="${TD}">${d.subido_por_nombre || "—"}</td>
        <td class="${TD}">${new Date(d.created_at).toLocaleDateString("es-PE")}</td>
        <td class="${TD}"><button type="button" class="btn-danger px-2 py-1 text-xs" onclick="deleteDocumentAction('${d.archivo_id}')">Eliminar</button></td>
      </tr>`).join("")
    : emptyRow(4, "Sin documentos adjuntos todavía.", "inbox");
}

document.getElementById("form-document-upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentDocEntidadId) return;
  const formData = new FormData(e.target);
  formData.set("entidad_tipo", currentDocEntidadTipo);
  formData.set("entidad_id", currentDocEntidadId);
  formData.set("channel", "web");
  if (formData.get("guardar_en_drive")) formData.set("destino", "drive");
  formData.delete("guardar_en_drive");
  setFormLoading(e.target, true);
  try {
    const r = await uploadFile("/documents", formData);
    renderResult("document-upload-result", r);
    if (r.status === "success") { toast("Documento subido"); e.target.reset(); loadDocumentsList(); }
    else toast(r.error.message, false);
  } finally {
    setFormLoading(e.target, false);
  }
});

async function deleteDocumentAction(archivoId) {
  if (!confirm("¿Eliminar este documento? No se puede deshacer.")) return;
  const r = await api(`/documents/${archivoId}`, { method: "DELETE" });
  if (r.status === "success") { toast("Documento eliminado"); loadDocumentsList(); }
  else toast(r.error.message, false);
}

function closeDocumentsModal() {
  document.getElementById("documents-modal").classList.add("hidden");
  currentDocEntidadTipo = null;
  currentDocEntidadId = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDocumentsModal(); });

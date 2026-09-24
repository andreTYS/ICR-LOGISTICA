// Importación única de los productos reales relevados para ICR-TIENDA (ver
// tools/importador-productos en ese repo, antes DemoDB-Productos) hacia la
// tabla productos del ERP. Habla con la API pública en vez de la base
// directamente (a diferencia de seed-demo.js) para poder correr desde
// cualquier máquina con red hacia el ERP desplegado, sin acceso al
// contenedor de Docker ni a la base — y para que cada alta pase por las
// mismas validaciones/permisos que un alta manual desde el panel.
//
// Uso:
//   node scripts/import-productos-tienda.js \
//     --csv ../ICR-TIENDA/tools/importador-productos/productos_icr_local.csv \
//     --images ../ICR-TIENDA/tools/importador-productos/uploads \
//     --api https://erp.inversionesicr.com/api \
//     --token <token de un usuario con permisos de Almacén/Admin>
//
// Flags opcionales:
//   --dry-run       Muestra el CSV ya transformado (con los SKU generados) sin llamar a la API.
//   --skip-photos   Importa solo los datos del producto, sin subir fotos.
//
// El CSV real (productos_icr_local.csv) no trae código de referencia interna
// (SKU) en 401 de sus 800 filas — se genera uno determinístico como
// <CATEGORIA-SLUG>-<NNN> para esas filas. Los códigos reales duplicados (8
// casos) se separan con un sufijo -2, -3, etc. Todo el lote se importa con
// tipo_control=NORMAL (catálogo de reventa, sin seguimiento por lote/serie
// — si algún producto sí lo necesita, se ajusta después desde el panel) y
// unidad_medida mapeada "Unidades"→"UND", "m"→"M".
//
// Requiere un token de un usuario con permisos inventory.product.create/
// update (Almacenero o Admin) — el token de servicio de la tienda (rol
// VENTAS) NO alcanza, solo tiene permisos de lectura + crear leads.

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

// Parser CSV mínimo RFC 4180 — mismo criterio que inventoryService.parseCsv.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function toCsvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function slugCategoria(categoria) {
  const slug = (categoria || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "SIN-CATEGORIA";
}

const UNIDAD_MEDIDA_MAP = { Unidades: "UND", m: "M" };

// Transforma las filas crudas del CSV de staging (costo,nombre,precio_venta,
// referencia_interna,unidad_medida,categoria_producto,archivo_imagen,
// imagen_url) a productos listos para el import-csv del ERP, generando y
// desduplicando SKUs donde haga falta.
function transformar(rows) {
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const iCosto = idx("costo"), iNombre = idx("nombre"), iPrecio = idx("precio_venta"),
    iRef = idx("referencia_interna"), iUnidad = idx("unidad_medida"), iCategoria = idx("categoria_producto"),
    iArchivo = idx("archivo_imagen");
  for (const [nombre, i] of [["nombre", iNombre], ["referencia_interna", iRef], ["categoria_producto", iCategoria]]) {
    if (i === -1) throw new Error(`El CSV no tiene la columna "${nombre}" esperada`);
  }

  const skusUsados = new Set();
  const contadorPorCategoria = {};
  const productos = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nombre = (r[iNombre] || "").trim();
    if (!nombre) continue;
    const categoria = (r[iCategoria] || "").trim();
    let sku = (r[iRef] || "").trim();

    if (sku && skusUsados.has(sku)) {
      let n = 2;
      let candidato = `${sku}-${n}`;
      while (skusUsados.has(candidato)) { n++; candidato = `${sku}-${n}`; }
      sku = candidato;
    } else if (!sku) {
      const slug = slugCategoria(categoria);
      contadorPorCategoria[slug] = (contadorPorCategoria[slug] || 0) + 1;
      let candidato = `${slug}-${String(contadorPorCategoria[slug]).padStart(3, "0")}`;
      while (skusUsados.has(candidato)) {
        contadorPorCategoria[slug]++;
        candidato = `${slug}-${String(contadorPorCategoria[slug]).padStart(3, "0")}`;
      }
      sku = candidato;
    }
    skusUsados.add(sku);

    const unidad_medida = UNIDAD_MEDIDA_MAP[(r[iUnidad] || "").trim()] || "UND";

    productos.push({
      sku,
      nombre,
      tipo_control: "NORMAL",
      unidad_medida,
      costo_unitario: (r[iCosto] || "0").trim(),
      precio_venta: (r[iPrecio] || "").trim(),
      categoria,
      archivo_imagen: (r[iArchivo] || "").trim(),
    });
  }
  return productos;
}

function buildCsvParaImport(productos) {
  const headers = ["sku", "nombre", "tipo_control", "unidad_medida", "costo_unitario", "precio_venta", "categoria"];
  const lines = [headers.join(",")];
  for (const p of productos) lines.push(headers.map((h) => toCsvField(p[h])).join(","));
  return lines.join("\n");
}

const MIME_POR_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function subirFoto(apiUrl, token, sku, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_POR_EXT[ext];
  if (!mime) return { ok: false, error: `Extensión no soportada: ${ext}` };
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("photo", new Blob([buffer], { type: mime }), path.basename(filePath));
  const res = await fetch(`${apiUrl}/inventory/products/${encodeURIComponent(sku)}/photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "success") {
    return { ok: false, error: body?.error?.message || `HTTP ${res.status}` };
  }
  return { ok: true };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv || (!args["dry-run"] && (!args.api || !args.token))) {
    console.error(
      "Uso: node import-productos-tienda.js --csv <archivo.csv> [--images <carpeta>] --api <url> --token <token> [--skip-photos] [--dry-run]"
    );
    process.exit(1);
  }

  const csvText = fs.readFileSync(args.csv, "utf8");
  const rows = parseCsv(csvText.trim());
  const productos = transformar(rows);
  console.log(`${productos.length} productos transformados de ${rows.length - 1} filas del CSV original.`);

  const csvParaImport = buildCsvParaImport(productos);

  if (args["dry-run"]) {
    console.log("--- CSV transformado (dry-run, no se envía nada a la API) ---");
    console.log(csvParaImport);
    return;
  }

  const apiUrl = String(args.api).replace(/\/+$/, "");

  console.log("Importando datos de producto...");
  const res = await fetch(`${apiUrl}/inventory/products/import-csv`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.token}` },
    body: JSON.stringify({ csv: csvParaImport }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "success") {
    console.error("Error al importar productos:", body?.error?.message || `HTTP ${res.status}`);
    process.exit(1);
  }
  const { total, exitosos, fallidos, detalle } = body.data;
  console.log(`Productos: ${exitosos}/${total} importados correctamente (${fallidos} fallidos).`);
  for (const d of detalle) if (!d.ok) console.log(`  Fila ${d.fila} (SKU ${d.sku}): ${d.error}`);

  if (args["skip-photos"]) {
    console.log("Fotos omitidas (--skip-photos).");
    return;
  }
  if (!args.images) {
    console.log("Sin --images, se omiten las fotos.");
    return;
  }

  console.log("Subiendo fotos...");
  let fotosOk = 0, fotosError = 0;
  for (const p of productos) {
    if (!p.archivo_imagen) continue;
    const filePath = path.join(args.images, p.archivo_imagen);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${p.sku}: no se encontró el archivo ${p.archivo_imagen}`);
      fotosError++;
      continue;
    }
    const r = await subirFoto(apiUrl, args.token, p.sku, filePath);
    if (r.ok) fotosOk++;
    else { fotosError++; console.log(`  ${p.sku}: ${r.error}`); }
  }
  console.log(`Fotos: ${fotosOk} subidas, ${fotosError} con error.`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error("Error inesperado:", err);
    process.exit(1);
  });
}

module.exports = { parseCsv, transformar, buildCsvParaImport, slugCategoria };

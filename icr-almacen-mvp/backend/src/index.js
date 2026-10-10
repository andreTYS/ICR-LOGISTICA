require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const routes = require("./routes");
const { uploadsDir } = require("./uploads");
const { reloadModuleAccessCache } = require("./services/moduleAccessService");
const { runMigrations } = require("./runMigrations");

const app = express();

// Sin ALLOWED_ORIGIN definido, refleja el origen del request (conveniente en
// desarrollo local). En producción, define ALLOWED_ORIGIN (uno o varios,
// separados por coma) para restringir el panel a los dominios reales.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
// Límite por encima del default de Express (100kb): la exportación a Excel
// (POST /export/xlsx) manda hasta varios miles de filas ya armadas en JSON
// en un solo request — un listado con muchas columnas de texto puede pesar
// más que eso fácilmente, y sin este límite más alto el request se rechaza
// con 413 antes de que buildWorkbookBuffer llegue a validar nada.
app.use(express.json({ limit: "10mb" }));

app.use("/api", routes);

// Logo configurable y fotos de producto (ver src/uploads.js)
app.use("/uploads", express.static(uploadsDir, { maxAge: "7d" }));

// Sirve el panel web estático (frontend/) para que el MVP funcione con un solo proceso
app.use(express.static(path.join(__dirname, "..", "..", "frontend")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 4000;

// Las migraciones corren ANTES de aceptar tráfico, y si fallan el proceso
// no arranca — mejor un deploy que no levanta (se ve en los logs de
// inmediato) que un backend sirviendo contra un schema a medio migrar.
// Antes esto era un paso manual (psql a mano en el VPS); ver
// backend/migrations/README.md.
runMigrations()
  .catch((err) => {
    console.error("Fallo al migrar la base de datos al arrancar, el backend no va a levantar:", err);
    process.exit(1);
  })
  .then(() =>
    reloadModuleAccessCache().catch((err) =>
      console.error("No se pudo cargar el switch de módulos al arrancar (se asume todo habilitado)", err)
    )
  )
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ICR Almacén backend escuchando en puerto ${PORT}`);
    });
  });

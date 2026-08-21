require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const routes = require("./routes");

const app = express();

// Sin ALLOWED_ORIGIN definido, refleja el origen del request (conveniente en
// desarrollo local). En producción, define ALLOWED_ORIGIN (uno o varios,
// separados por coma) para restringir el panel a los dominios reales.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express.json());

app.use("/api", routes);

// Sirve el panel web estático (frontend/) para que el MVP funcione con un solo proceso
app.use(express.static(path.join(__dirname, "..", "..", "frontend")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ICR Almacén backend escuchando en puerto ${PORT}`);
});

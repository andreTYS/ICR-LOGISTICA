require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const routes = require("./routes");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", routes);

// Sirve el panel web estático (frontend/) para que el MVP funcione con un solo proceso
app.use(express.static(path.join(__dirname, "..", "..", "frontend")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ICR Almacén backend escuchando en puerto ${PORT}`);
});

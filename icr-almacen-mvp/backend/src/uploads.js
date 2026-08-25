const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { AppError } = require("./errors");

// Carpeta persistida fuera de src/ para que sobreviva a un rebuild de imagen
// Docker (montada como volumen en docker-compose.yml). Sirve tanto el logo
// configurable como las fotos de producto — misma infraestructura, distinto
// campo de destino según el endpoint que la use.
const uploadsDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const MAX_SIZE = 3 * 1024 * 1024; // 3MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED_MIME[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) {
      return cb(new AppError("INVALID_FILE_TYPE", "Solo se aceptan imágenes JPEG, PNG o WebP", 400));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadsDir };

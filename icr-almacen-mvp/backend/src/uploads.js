const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const { AppError } = require("./errors");

// Carpeta persistida fuera de src/ para que sobreviva a un rebuild de imagen
// Docker (montada como volumen en docker-compose.yml). Sirve tanto el logo
// configurable como las fotos de producto — misma infraestructura, distinto
// campo de destino según el endpoint que la use.
const uploadsDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_SIDE = 800; // px — una foto de celular (3000-4000px) no tiene sentido servida tal cual
const MAX_SIZE = 3 * 1024 * 1024; // 3MB de subida; el archivo guardado queda mucho más chico tras procesar
const SHARP_OUTPUT = {
  "image/jpeg": (img) => img.jpeg({ quality: 82, mozjpeg: true }),
  "image/png": (img) => img.png({ compressionLevel: 8 }),
  "image/webp": (img) => img.webp({ quality: 82 }),
};
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

// multer solo valida/recibe el archivo en memoria — el procesamiento y guardado
// final lo hace processAndSaveImage() dentro del handler de cada ruta, así el
// error de sharp (archivo corrupto, etc.) se reporta con el mismo formato que
// el resto de la API en vez de reventar como 500 crudo.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!SHARP_OUTPUT[file.mimetype]) {
      return cb(new AppError("INVALID_FILE_TYPE", "Solo se aceptan imágenes JPEG, PNG o WebP", 400));
    }
    cb(null, true);
  },
});

// Reescala a un máximo de 800px de lado (sin agrandar imágenes más chicas) y
// reencoda en el mismo formato con compresión razonable, antes de guardar.
async function processAndSaveImage(file) {
  const filename = `${crypto.randomUUID()}${EXT[file.mimetype]}`;
  try {
    let image = sharp(file.buffer).resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true });
    image = SHARP_OUTPUT[file.mimetype](image);
    await image.toFile(path.join(uploadsDir, filename));
  } catch (err) {
    throw new AppError("INVALID_FILE_TYPE", "No se pudo procesar la imagen (¿archivo corrupto?)", 400);
  }
  return `/uploads/${filename}`;
}

module.exports = { upload, uploadsDir, processAndSaveImage };

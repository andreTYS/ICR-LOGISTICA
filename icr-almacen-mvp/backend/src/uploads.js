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

// Un ícono del menú siempre se muestra a 17-24px — no tiene sentido
// guardarlo al mismo tamaño que una foto de producto (800px). 96px alcanza
// de sobra incluso para pantallas de alta densidad.
const ICON_MAX_SIDE = 96;
async function processAndSaveIcon(file) {
  const filename = `${crypto.randomUUID()}${EXT[file.mimetype]}`;
  try {
    let image = sharp(file.buffer).resize(ICON_MAX_SIDE, ICON_MAX_SIDE, { fit: "inside", withoutEnlargement: true });
    image = SHARP_OUTPUT[file.mimetype](image);
    await image.toFile(path.join(uploadsDir, filename));
  } catch (err) {
    throw new AppError("INVALID_FILE_TYPE", "No se pudo procesar la imagen (¿archivo corrupto?)", 400);
  }
  return `/uploads/${filename}`;
}

// -------------------- Documentos adjuntos (planos, permisos, certificados) --------------------
// A diferencia de processAndSaveImage (logo/fotos de producto), un documento
// se guarda tal cual: un PDF de planos no es una foto de celular, no tiene
// sentido reescalarlo/recomprimirlo, y necesita admitir tipos que sharp no
// procesa.
const DOCUMENT_MAX_SIZE = 10 * 1024 * 1024; // 10MB — un PDF con planos pesa más que una foto
const ALLOWED_DOCUMENT_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOCUMENT_TYPES[file.mimetype]) {
      return cb(new AppError("INVALID_FILE_TYPE", "Solo se aceptan PDF, JPEG, PNG o WebP", 400));
    }
    cb(null, true);
  },
});

async function saveDocumentFile(file) {
  const filename = `${crypto.randomUUID()}${ALLOWED_DOCUMENT_TYPES[file.mimetype]}`;
  await fs.promises.writeFile(path.join(uploadsDir, filename), file.buffer);
  return { url: `/uploads/${filename}`, tipoArchivo: file.mimetype, tamanoBytes: file.buffer.length };
}

async function deleteUploadedFile(url) {
  if (!url || !url.startsWith("/uploads/")) return;
  try {
    await fs.promises.unlink(path.join(uploadsDir, path.basename(url)));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`No se pudo borrar el archivo '${url}'`, err);
  }
}

module.exports = { upload, uploadsDir, processAndSaveImage, processAndSaveIcon, uploadDocument, saveDocumentFile, deleteUploadedFile };

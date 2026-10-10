const express = require("express");
const router = express.Router();
const { handle } = require("./_shared");
const { AppError } = require("../errors");
const { requirePermission } = require("../auth");
const { uploadDocument, saveDocumentFile, readUploadedFile } = require("../uploads");
const proyectos = require("../services/proyectosService");
const archivos = require("../services/archivosService");
const driveService = require("../services/driveService");
const whatsapp = require("../services/whatsappService");

// -------- Gestión documental --------

router.post(
  "/documents",
  requirePermission("documents.manage"),
  uploadDocument.single("archivo"),
  handle(async (req) => {
    if (!req.file) throw new AppError("SCHEMA_INVALID", "No se recibió ningún archivo", 400);
    let url, tipoArchivo, tamanoBytes;
    if (req.body.destino === "drive") {
      // Si el documento es de un proyecto con su propia carpeta vinculada
      // (proyectos.setDriveFolderId), va ahí; si no, cae a la carpeta
      // global GOOGLE_DRIVE_FOLDER_ID (ver driveService.uploadFile).
      const folderId = req.body.entidad_tipo === "proyecto"
        ? await proyectos.getDriveFolderId(req.body.entidad_id)
        : null;
      const drive = await driveService.uploadFile({ buffer: req.file.buffer, filename: req.body.nombre || req.file.originalname, mimeType: req.file.mimetype, folderId });
      url = drive.webViewLink;
      tipoArchivo = req.file.mimetype;
      tamanoBytes = req.file.buffer.length;
    } else {
      ({ url, tipoArchivo, tamanoBytes } = await saveDocumentFile(req.file));
    }
    return archivos.subirArchivo({
      entidadTipo: req.body.entidad_tipo, entidadId: req.body.entidad_id, nombre: req.body.nombre || req.file.originalname,
      url, tipoArchivo, tamanoBytes, usuarioId: req.user.usuario_id, canal: req.body.channel || "web",
    });
  })
);

router.get(
  "/documents",
  requirePermission("documents.query"),
  handle(async (req) => archivos.listArchivos({ entidadTipo: req.query.entidad_tipo, entidadId: req.query.entidad_id }))
);

router.delete(
  "/documents/:id",
  requirePermission("documents.manage"),
  handle(async (req) => archivos.eliminarArchivo({ archivoId: req.params.id, usuarioId: req.user.usuario_id, canal: req.query.channel || "web" }))
);

router.post(
  "/documents/:id/send-whatsapp",
  requirePermission("documents.manage"),
  handle(async (req) => {
    const archivo = await archivos.getArchivo(req.params.id);
    const buffer = await readUploadedFile(archivo.url);
    await whatsapp.enviarDocumentoPorWhatsapp({
      to: req.body?.to,
      caption: archivo.nombre,
      filename: archivo.nombre,
      buffer,
      mimetype: archivo.tipo_archivo,
    });
    return { enviado_a: req.body?.to };
  })
);

module.exports = router;

import { Router, type RequestHandler } from "express";
import multer from "multer";
import { openDatabase } from "../../../../railway-deploy/lib/database.mjs";
import { registerMenuApi } from "../../../../railway-deploy/lib/menu-router.mjs";

const database = openDatabase(process.env.DATABASE_FILE || "database.sqlite");
const imageParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.mimetype)) {
      callback(new Error("Solo se permiten imágenes JPG, PNG o WebP."));
      return;
    }
    callback(null, true);
  },
}).single("image");

const safeImageUpload: RequestHandler = (req, res, next) => {
  imageParser(req, res, (error) => {
    if (error) {
      const isTooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      res.status(isTooLarge ? 413 : 400).json({
        error: isTooLarge
          ? "La imagen debe pesar menos de 8 MB."
          : error.message || "No se pudo leer la imagen.",
      });
      return;
    }
    next();
  });
};

const router = Router();
registerMenuApi(router, database, safeImageUpload, process.env);

export default router;

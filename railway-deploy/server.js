import "dotenv/config";

import express, { Router } from "express";
import helmet from "helmet";
import multer from "multer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { openDatabase } from "./lib/database.mjs";
import {
  readProductBySlug,
  readPublicStore,
  registerMenuApi,
} from "./lib/menu-router.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(currentDir, "public");
const env = process.env;

function requireConfiguration() {
  const missing = [];
  if (!env.ADMIN_PIN || env.ADMIN_PIN.length < 4) missing.push("ADMIN_PIN (mínimo 4 caracteres)");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET (mínimo 32 caracteres)");
  if (!env.IMGBB_API_KEY) missing.push("IMGBB_API_KEY");
  if (missing.length) throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(", ")}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function canonicalBase(req) {
  if (env.PUBLIC_BASE_URL) {
    try {
      const configured = new URL(env.PUBLIC_BASE_URL);
      if (configured.protocol === "https:" && !configured.username && !configured.password) {
        return configured.origin;
      }
    } catch {
      // Ignore an invalid optional canonical URL and use the forwarded request host.
    }
  }
  return `${req.protocol}://${req.get("host")}`;
}

function htmlWithMetadata(html, { title, description, image, url }) {
  const metadata = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n    ");
  const withoutOldTags = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+(?:name="description"|property="og:[^"]+"|name="twitter:card")[^>]*>\s*/gi, "");
  return withoutOldTags.replace(/<head([^>]*)>/i, `<head$1>\n    ${metadata}`);
}

requireConfiguration();

const databaseFile = env.DATABASE_FILE || resolve(currentDir, "database.sqlite");
const database = openDatabase(databaseFile);
const imageParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.mimetype)) {
      callback(new Error("Solo se permiten imágenes JPG, PNG o WebP."));
      return;
    }
    callback(null, true);
  },
}).single("image");

const safeImageUpload = (req, res, next) => {
  imageParser(req, res, (error) => {
    if (error) {
      const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? "La imagen debe pesar menos de 8 MB."
          : error.message || "No se pudo leer la imagen.",
      });
      return;
    }
    next();
  });
};

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

const api = Router();
api.get("/healthz", (_req, res) => res.json({ status: "ok" }));
registerMenuApi(api, database, safeImageUpload, env);
app.use("/api", api);
app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta de API no encontrada." }));
app.use(express.static(publicDir, { index: false, dotfiles: "deny", maxAge: "1h" }));

app.get("/p/:slug", async (req, res, next) => {
  try {
    const product = readProductBySlug(database, req.params.slug);
    if (!product) {
      res.status(404).send("No encontramos ese producto.");
      return;
    }
    const store = readPublicStore(database);
    const html = await readFile(resolve(publicDir, "index.html"), "utf8");
    const base = canonicalBase(req);
    res.type("html").send(
      htmlWithMetadata(html, {
        title: `${product.name} | ${store.storeName}`,
        description: product.description || store.tagline,
        image: product.imageUrl || store.logoUrl || `${base}/og-default.svg`,
        url: `${base}/p/${encodeURIComponent(product.slug)}`,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/{*splat}", async (req, res, next) => {
  try {
    const store = readPublicStore(database);
    const html = await readFile(resolve(publicDir, "index.html"), "utf8");
    const base = canonicalBase(req);
    res.type("html").send(
      htmlWithMetadata(html, {
        title: store.storeName,
        description: store.tagline,
        image: store.logoUrl || `${base}/og-default.svg`,
        url: `${base}${req.path}`,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  req.log?.error({ errorName: error?.name ?? "Error" }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Ocurrió un error interno. Intenta de nuevo." });
});

const rawPort = env.PORT || "3000";
const port = Number(rawPort);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`PORT no es válido: ${rawPort}`);
}

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Menú Local escuchando en el puerto ${port}\n`);
});

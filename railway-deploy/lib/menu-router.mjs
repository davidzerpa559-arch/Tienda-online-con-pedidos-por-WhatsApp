import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import rateLimit from "express-rate-limit";

const ADMIN_COOKIE = "menu_admin_session";
const VISITOR_COOKIE = "menu_visitor";
const SESSION_TTL_SECONDS = 4 * 60 * 60;
const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 365;

const slugify = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "producto";

const cleanText = (value, max = 500) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const bool = (value) => Number(value) === 1;
const isoDate = (value) => new Date(value).toISOString();
const hmac = (secret, value) =>
  createHmac("sha256", secret).update(value).digest("base64url");

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(req, name) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("=") ?? "");
      } catch {
        return "";
      }
    }
  }
  return "";
}

function cookieOptions(env, maxAge) {
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function adminCookieIsValid(req, secret) {
  const parts = cookieValue(req, ADMIN_COOKIE).split(".");
  if (parts.length !== 3) return false;
  const [expiry, nonce, signature] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) <= Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, hmac(secret, `admin|${expiry}|${nonce}`));
}

function publicStoreRow(db) {
  return db.prepare("SELECT * FROM config WHERE id = 1").get();
}

export function readStoreSettings(db) {
  const row = publicStoreRow(db);
  if (!row) throw new Error("Store configuration row is missing");
  return {
    storeName: row.store_name,
    tagline: row.tagline,
    logoUrl: row.logo_url,
    whatsappNumber: row.whatsapp_number,
    physicalAddress: row.physical_address,
    bankName: row.bank_name,
    bankId: row.bank_id,
    bankPhone: row.bank_phone,
    isOpen: bool(row.is_open),
    pickupEnabled: bool(row.pickup_enabled),
    webhookUrl: row.webhook_url,
  };
}

export function readPublicStore(db) {
  const { webhookUrl: _webhookUrl, ...store } = readStoreSettings(db);
  return store;
}

function mapProduct(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    imageUrl: row.image_url,
    price: money(row.price),
    offerPrice: row.offer_price == null ? null : money(row.offer_price),
    isAvailable: bool(row.is_available),
    likeCount: Number(row.like_count ?? 0),
    dislikeCount: Number(row.dislike_count ?? 0),
  };
}

const productQuery = `
  SELECT p.*,
    SUM(CASE WHEN r.reaction = 'like' THEN 1 ELSE 0 END) AS like_count,
    SUM(CASE WHEN r.reaction = 'dislike' THEN 1 ELSE 0 END) AS dislike_count
  FROM products p
  LEFT JOIN likes r ON r.product_id = p.id
`;

export function readPublicProducts(db, availableOnly = true) {
  const where = availableOnly ? " WHERE p.is_available = 1" : "";
  const rows = db.prepare(`${productQuery}${where} GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`).all();
  return rows.map(mapProduct);
}

export function readProductBySlug(db, slug) {
  const row = db
    .prepare(`${productQuery} WHERE p.slug = ? GROUP BY p.id LIMIT 1`)
    .get(slug);
  return row ? mapProduct(row) : null;
}

function getZones(db, activeOnly = true) {
  const rows = db
    .prepare(
      `SELECT id, name, delivery_fee, is_active FROM zones${activeOnly ? " WHERE is_active = 1" : ""} ORDER BY name COLLATE NOCASE`,
    )
    .all();
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    deliveryFee: money(row.delivery_fee),
    isActive: bool(row.is_active),
  }));
}

function getComments(db, productId, limit = 50) {
  return db
    .prepare(
      `SELECT id, product_id, customer_name, content, created_at
       FROM comments WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(productId, limit)
    .reverse()
    .map((row) => ({
      id: Number(row.id),
      productId: Number(row.product_id),
      customerName: row.customer_name,
      content: row.content,
      createdAt: isoDate(row.created_at),
    }));
}

function validHttpsUrl(value, nullable = true) {
  if ((value === null || value === "") && nullable) return null;
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isPrivateIp(hostname) {
  if (!isIP(hostname)) return false;
  if (hostname.includes(":")) return true;
  const octets = hostname.split(".").map(Number);
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] === 0
  );
}

function validWebhookUrl(value) {
  const normalized = validHttpsUrl(value);
  if (normalized === null || normalized === undefined) return normalized;
  const hostname = new URL(normalized).hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateIp(hostname)
  ) {
    return undefined;
  }
  return normalized;
}

function validCedula(value) {
  if (typeof value !== "string" || !/^[VEJPG]-?[0-9]{6,9}$/i.test(value.trim())) return false;
  const digits = value.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(digits)) return false;
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < digits.length; i += 1) {
    const difference = Number(digits[i]) - Number(digits[i - 1]);
    ascending = difference === 1 ? ascending + 1 : 1;
    descending = difference === -1 ? descending + 1 : 1;
    if (ascending >= 6 || descending >= 6) return false;
  }
  return true;
}

function validPhone(value) {
  return typeof value === "string" && /^[+()\-\s0-9]{7,20}$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7;
}

function validImageUrl(value) {
  if (value === null || value === "") return null;
  return validHttpsUrl(value, false);
}

function updateConfig(db, input) {
  const storeName = cleanText(input.storeName, 100);
  const tagline = cleanText(input.tagline, 180);
  const logoUrl = validImageUrl(input.logoUrl);
  const whatsappNumber = cleanText(input.whatsappNumber, 20);
  const physicalAddress = cleanText(input.physicalAddress, 300);
  const bankName = cleanText(input.bankName, 100);
  const bankId = cleanText(input.bankId, 20);
  const bankPhone = cleanText(input.bankPhone, 20);
  const webhookUrl = validWebhookUrl(input.webhookUrl);

  if (storeName.length < 2) return { error: "El nombre del negocio debe tener al menos 2 caracteres." };
  if (input.logoUrl && logoUrl === undefined) return { error: "El logo debe ser una URL HTTPS válida." };
  if (whatsappNumber && !validPhone(whatsappNumber)) return { error: "El número de WhatsApp no parece válido." };
  if (input.webhookUrl && webhookUrl === undefined) return { error: "El webhook debe ser HTTPS y no puede apuntar a una dirección local." };
  if (typeof input.isOpen !== "boolean" || typeof input.pickupEnabled !== "boolean") {
    return { error: "El estado de apertura y la opción de retiro deben ser interruptores válidos." };
  }

  db.prepare(`
    UPDATE config SET store_name = ?, tagline = ?, logo_url = ?, whatsapp_number = ?,
      physical_address = ?, bank_name = ?, bank_id = ?, bank_phone = ?,
      is_open = ?, pickup_enabled = ?, webhook_url = ?
    WHERE id = 1
  `).run(
    storeName,
    tagline,
    logoUrl,
    whatsappNumber,
    physicalAddress,
    bankName,
    bankId,
    bankPhone,
    Number(input.isOpen),
    Number(input.pickupEnabled),
    webhookUrl,
  );
  return { value: readStoreSettings(db) };
}

function uniqueSlug(db, name) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM products WHERE slug = ?").get(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function validProduct(input) {
  const name = cleanText(input.name, 100);
  const description = cleanText(input.description, 1000);
  const category = cleanText(input.category, 60);
  const price = Number(input.price);
  const offerPrice = input.offerPrice == null || input.offerPrice === "" ? null : Number(input.offerPrice);
  const imageUrl = validImageUrl(input.imageUrl);
  if (name.length < 2) return { error: "El nombre del producto debe tener al menos 2 caracteres." };
  if (!Number.isFinite(price) || price <= 0) return { error: "El precio debe ser mayor que cero." };
  if (offerPrice !== null && (!Number.isFinite(offerPrice) || offerPrice <= 0 || offerPrice >= price)) {
    return { error: "El precio de oferta debe ser positivo y menor que el precio normal." };
  }
  if (input.imageUrl && imageUrl === undefined) return { error: "La foto debe ser una URL HTTPS válida." };
  if (typeof input.isAvailable !== "boolean") return { error: "La disponibilidad debe ser válida." };
  return { value: { name, description, category, price: money(price), offerPrice: offerPrice === null ? null : money(offerPrice), imageUrl, isAvailable: input.isAvailable } };
}

function productById(db, id) {
  const row = db.prepare(`${productQuery} WHERE p.id = ? GROUP BY p.id LIMIT 1`).get(id);
  return row ? mapProduct(row) : null;
}

function adminOrders(db) {
  const rows = db.prepare(`
    SELECT o.*, z.name AS current_zone_name
    FROM orders o
    LEFT JOIN zones z ON z.id = o.zone_id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 100
  `).all();
  return rows.map((row) => ({
    id: Number(row.id),
    customerName: row.customer_name,
    cedula: row.cedula,
    phone: row.phone,
    fulfillment: row.fulfillment,
    zoneName: row.zone_name ?? row.current_zone_name ?? null,
    address: row.address,
    referencePoint: row.reference_point,
    notes: row.notes,
    paymentReference: row.payment_reference,
    items: JSON.parse(row.items_json),
    total: money(row.total),
    status: row.status,
    createdAt: isoDate(row.created_at),
  }));
}

function adminMetrics(db) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = today.toISOString();
  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS orders_today,
      SUM(CASE WHEN status = 'pending_verification' THEN 1 ELSE 0 END) AS pending_orders,
      SUM(CASE WHEN created_at >= ? AND status IN ('confirmed', 'preparing', 'ready', 'delivered') THEN total ELSE 0 END) AS sales_today
    FROM orders
  `).get(start, start);
  return {
    ordersToday: Number(rows.orders_today ?? 0),
    pendingOrders: Number(rows.pending_orders ?? 0),
    salesToday: money(rows.sales_today ?? 0),
  };
}

function validZone(input) {
  const name = cleanText(input.name, 80);
  const deliveryFee = Number(input.deliveryFee);
  if (name.length < 2) return { error: "El nombre de la zona debe tener al menos 2 caracteres." };
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) return { error: "El costo de envío no puede ser negativo." };
  if (typeof input.isActive !== "boolean") return { error: "El estado de la zona no es válido." };
  return { value: { name, deliveryFee: money(deliveryFee), isActive: input.isActive } };
}

function normalizedPhone(value) {
  return String(value).replace(/\D/g, "");
}

function orderMessage(order, store, input, itemLines, deliveryFee) {
  const fulfillmentLine =
    input.fulfillment === "pickup"
      ? `Retiro en tienda: ${store.physicalAddress || "dirección por confirmar"}`
      : `Delivery: ${order.zoneName} — ${order.address}${input.referencePoint ? ` (${input.referencePoint})` : ""}`;
  const lines = [
    `Hola, quiero confirmar el pedido #${order.id} de ${store.storeName}.`,
    "",
    ...itemLines.map((item) => `${item.quantity} × ${item.name} — $${money(item.unitPrice * item.quantity).toFixed(2)}`),
    "",
    `Subtotal: $${order.subtotal.toFixed(2)}`,
    `Envío: $${deliveryFee.toFixed(2)}`,
    `Total: $${order.total.toFixed(2)}`,
    `Modalidad: ${fulfillmentLine}`,
    `Cliente: ${input.customerName} | C.I. ${input.cedula} | ${input.phone}`,
    `Referencia Pago Móvil: ${input.paymentReference}`,
    `${store.bankName} | C.I. ${store.bankId} | ${store.bankPhone}`,
    input.notes ? `Nota: ${input.notes}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

async function notifyWebhook(req, env, store, order, input) {
  if (!store.webhookUrl || !env.MACRODROID_WEBHOOK_TOKEN) return "not_configured";
  const payload = {
    event: "order.payment_reference.submitted",
    orderId: order.id,
    createdAt: order.createdAt,
    customer: {
      name: input.customerName,
      phone: input.phone,
    },
    payment: {
      method: "mobile_payment",
      reference: input.paymentReference,
      amount: order.total,
      currency: "USD",
      bank: store.bankName,
      accountCedula: store.bankId,
      accountPhone: store.bankPhone,
    },
    fulfillment: {
      mode: input.fulfillment,
      zone: order.zoneName,
      address: input.address,
      referencePoint: input.referencePoint,
    },
    items: order.items,
    verificationRequired: true,
    status: "pending_verification",
  };
  try {
    const response = await fetch(store.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MACRODROID_WEBHOOK_TOKEN}`,
        "X-Webhook-Token": env.MACRODROID_WEBHOOK_TOKEN,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) req.log?.warn({ orderId: order.id, status: response.status }, "MacroDroid webhook returned a non-success status");
    return response.ok ? "sent" : "failed";
  } catch (error) {
    req.log?.warn({ orderId: order.id, errorName: error?.name ?? "Error" }, "MacroDroid webhook delivery failed");
    return "failed";
  }
}

export function registerMenuApi(router, db, imageUpload, env = process.env) {
  const sessionSecret = env.SESSION_SECRET;
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos antes de volver a intentar." });
    },
  });
  const commentLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ error: "Espera unos minutos antes de publicar otro comentario." });
    },
  });
  const reactionLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ error: "Has hecho demasiadas reacciones. Intenta más tarde." });
    },
  });
  const orderLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ error: "Se alcanzó el límite de pedidos por hora. Intenta más tarde." });
    },
  });

  function requireAdmin(req, res, next) {
    if (!adminCookieIsValid(req, sessionSecret)) {
      res.status(401).json({ error: "Inicia sesión para continuar." });
      return;
    }
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host")) {
          res.status(403).json({ error: "Origen no permitido." });
          return;
        }
      } catch {
        res.status(403).json({ error: "Origen no permitido." });
        return;
      }
    }
    next();
  }

  function visitorHash(req, res) {
    const current = cookieValue(req, VISITOR_COOKIE).split(".");
    let visitorId = current.length === 2 && safeEqual(current[1], hmac(sessionSecret, `visitor|${current[0]}`))
      ? current[0]
      : "";
    if (!visitorId) {
      visitorId = randomBytes(20).toString("hex");
      const signature = hmac(sessionSecret, `visitor|${visitorId}`);
      res.append("Set-Cookie", `${VISITOR_COOKIE}=${visitorId}.${signature}; ${cookieOptions(env, VISITOR_TTL_SECONDS)}`);
    }
    return hmac(sessionSecret, `visitor-hash|${visitorId}`);
  }

  router.get("/storefront", (_req, res) => {
    res.json({
      store: readPublicStore(db),
      products: readPublicProducts(db, false),
      zones: getZones(db, true),
    });
  });

  router.get("/products/:slug", (req, res) => {
    const slug = cleanText(req.params.slug, 100);
    const product = readProductBySlug(db, slug);
    if (!product) {
      res.status(404).json({ error: "No encontramos ese producto." });
      return;
    }
    res.json({ product, comments: getComments(db, product.id) });
  });

  router.post("/products/:slug/reactions", reactionLimiter, (req, res) => {
    const product = readProductBySlug(db, cleanText(req.params.slug, 100));
    if (!product) {
      res.status(404).json({ error: "No encontramos ese producto." });
      return;
    }
    const reaction = req.body?.reaction;
    if (!["like", "dislike", "clear"].includes(reaction)) {
      res.status(400).json({ error: "La reacción no es válida." });
      return;
    }
    const hash = visitorHash(req, res);
    if (reaction === "clear") {
      db.prepare("DELETE FROM likes WHERE product_id = ? AND visitor_hash = ?").run(product.id, hash);
    } else {
      db.prepare(`
        INSERT INTO likes (product_id, visitor_hash, reaction) VALUES (?, ?, ?)
        ON CONFLICT(product_id, visitor_hash) DO UPDATE SET reaction = excluded.reaction
      `).run(product.id, hash, reaction);
    }
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN reaction = 'like' THEN 1 ELSE 0 END) AS like_count,
        SUM(CASE WHEN reaction = 'dislike' THEN 1 ELSE 0 END) AS dislike_count
      FROM likes WHERE product_id = ?
    `).get(product.id);
    const current = db.prepare("SELECT reaction FROM likes WHERE product_id = ? AND visitor_hash = ?").get(product.id, hash);
    res.json({
      likeCount: Number(counts.like_count ?? 0),
      dislikeCount: Number(counts.dislike_count ?? 0),
      currentReaction: current?.reaction ?? null,
    });
  });

  router.get("/products/:slug/comments", (req, res) => {
    const product = readProductBySlug(db, cleanText(req.params.slug, 100));
    if (!product) {
      res.status(404).json({ error: "No encontramos ese producto." });
      return;
    }
    res.json(getComments(db, product.id));
  });

  router.post("/products/:slug/comments", commentLimiter, (req, res) => {
    const product = readProductBySlug(db, cleanText(req.params.slug, 100));
    if (!product) {
      res.status(404).json({ error: "No encontramos ese producto." });
      return;
    }
    const customerName = cleanText(req.body?.customerName, 60);
    const content = cleanText(req.body?.content, 500);
    if (customerName.length < 2 || content.length < 1) {
      res.status(400).json({ error: "Escribe tu nombre y un comentario de hasta 500 caracteres." });
      return;
    }
    const result = db.prepare("INSERT INTO comments (product_id, customer_name, content) VALUES (?, ?, ?)").run(product.id, customerName, content);
    const row = db.prepare("SELECT id, product_id, customer_name, content, created_at FROM comments WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({
      id: Number(row.id),
      productId: Number(row.product_id),
      customerName: row.customer_name,
      content: row.content,
      createdAt: isoDate(row.created_at),
    });
  });

  router.post("/orders", orderLimiter, async (req, res) => {
    const input = req.body ?? {};
    const customerName = cleanText(input.customerName, 100);
    const cedula = typeof input.cedula === "string" ? input.cedula.trim().toUpperCase() : "";
    const phone = cleanText(input.phone, 20);
    const fulfillment = input.fulfillment;
    const paymentReference = typeof input.paymentReference === "string" ? input.paymentReference.trim() : "";
    const notes = cleanText(input.notes, 500);
    const address = cleanText(input.address, 300);
    const referencePoint = cleanText(input.referencePoint, 200);
    if (customerName.length < 2 || !validCedula(cedula) || !validPhone(phone)) {
      res.status(400).json({ error: "Revisa el nombre, la cédula venezolana y el teléfono." });
      return;
    }
    if (!/^\d{6}$/.test(paymentReference)) {
      res.status(400).json({ error: "La referencia de Pago Móvil debe tener exactamente 6 dígitos." });
      return;
    }
    if (!["delivery", "pickup"].includes(fulfillment)) {
      res.status(400).json({ error: "Selecciona delivery o retiro en tienda." });
      return;
    }
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) {
      res.status(400).json({ error: "El carrito no contiene productos válidos." });
      return;
    }
    const store = readStoreSettings(db);
    if (!store.isOpen) {
      res.status(409).json({ error: "El negocio está cerrado y no puede recibir pedidos ahora." });
      return;
    }
    if (!validPhone(store.whatsappNumber) || !store.bankName || !store.bankId || !validPhone(store.bankPhone)) {
      res.status(409).json({ error: "El negocio todavía no ha completado sus datos de pago y WhatsApp." });
      return;
    }

    let zone = null;
    let deliveryFee = 0;
    if (fulfillment === "pickup") {
      if (!store.pickupEnabled) {
        res.status(400).json({ error: "El retiro en tienda no está disponible." });
        return;
      }
    } else {
      if (!Number.isSafeInteger(input.zoneId) || !address || address.length < 8 || referencePoint.length < 3) {
        res.status(400).json({ error: "Para delivery indica zona, dirección exacta y punto de referencia." });
        return;
      }
      zone = db.prepare("SELECT id, name, delivery_fee FROM zones WHERE id = ? AND is_active = 1").get(input.zoneId);
      if (!zone) {
        res.status(400).json({ error: "La zona seleccionada no tiene delivery disponible." });
        return;
      }
      deliveryFee = money(zone.delivery_fee);
    }

    const seen = new Set();
    const orderItems = [];
    let subtotal = 0;
    for (const item of input.items) {
      const productId = Number(item?.productId);
      const quantity = Number(item?.quantity);
      if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50 || seen.has(productId)) {
        res.status(400).json({ error: "El carrito contiene cantidades o productos inválidos." });
        return;
      }
      seen.add(productId);
      const product = db.prepare("SELECT id, name, price, offer_price, is_available FROM products WHERE id = ?").get(productId);
      if (!product || !bool(product.is_available)) {
        res.status(409).json({ error: `El producto ${product?.name ?? ""} ya no está disponible.` });
        return;
      }
      const unitPrice = money(product.offer_price == null ? product.price : product.offer_price);
      subtotal += unitPrice * quantity;
      orderItems.push({ productId, name: product.name, quantity, unitPrice });
    }
    subtotal = money(subtotal);
    const total = money(subtotal + deliveryFee);
    const now = new Date().toISOString();
    let inserted;
    try {
      const createOrder = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO orders (
            customer_name, cedula, phone, fulfillment, zone_id, zone_name,
            address, reference_point, notes, payment_reference, items_json,
            subtotal, delivery_fee, total, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', ?)
        `).run(
          customerName,
          cedula,
          phone,
          fulfillment,
          zone?.id ?? null,
          zone?.name ?? null,
          fulfillment === "delivery" ? address : "",
          fulfillment === "delivery" ? referencePoint : "",
          notes,
          paymentReference,
          JSON.stringify(orderItems),
          subtotal,
          deliveryFee,
          total,
          now,
        );
        return Number(result.lastInsertRowid);
      });
      inserted = createOrder();
    } catch (error) {
      if (String(error?.code ?? "").includes("CONSTRAINT_UNIQUE")) {
        res.status(409).json({ error: "Esa referencia de pago ya fue enviada con otro pedido." });
        return;
      }
      throw error;
    }

    const order = {
      id: inserted,
      createdAt: now,
      subtotal,
      total,
      zoneName: zone?.name ?? null,
      items: orderItems,
    };
    const message = orderMessage(order, store, {
      customerName,
      cedula,
      phone,
      fulfillment,
      address,
      referencePoint,
      paymentReference,
      notes,
    }, orderItems, deliveryFee);
    const whatsappUrl = `https://wa.me/${normalizedPhone(store.whatsappNumber)}?text=${encodeURIComponent(message)}`;
    const webhookStatus = await notifyWebhook(req, env, store, order, {
      customerName,
      phone,
      fulfillment,
      address,
      referencePoint,
      paymentReference,
    });
    res.status(201).json({
      id: inserted,
      total,
      status: "pending_verification",
      whatsappUrl,
      webhookStatus,
    });
  });

  router.get("/admin/session", (req, res) => {
    res.json({ authenticated: adminCookieIsValid(req, sessionSecret) });
  });

  router.post("/admin/session", adminLoginLimiter, (req, res) => {
    const expectedPin = env.ADMIN_PIN;
    const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
    if (!expectedPin || !safeEqual(pin, expectedPin)) {
      res.status(expectedPin ? 401 : 503).json({ error: "No se pudo validar el PIN de administración." });
      return;
    }
    const expiry = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
    const nonce = randomBytes(16).toString("hex");
    const signature = hmac(sessionSecret, `admin|${expiry}|${nonce}`);
    res.append("Set-Cookie", `${ADMIN_COOKIE}=${expiry}.${nonce}.${signature}; ${cookieOptions(env, SESSION_TTL_SECONDS)}`);
    res.json({ authenticated: true });
  });

  router.delete("/admin/session", (req, res) => {
    res.append("Set-Cookie", `${ADMIN_COOKIE}=; ${cookieOptions(env, 0)}`);
    res.json({ authenticated: false });
  });

  router.get("/admin/overview", requireAdmin, (_req, res) => {
    res.json({
      store: readStoreSettings(db),
      products: readPublicProducts(db, false),
      zones: getZones(db, false),
      orders: adminOrders(db),
      metrics: adminMetrics(db),
    });
  });

  router.patch("/admin/settings", requireAdmin, (req, res) => {
    const result = updateConfig(db, req.body ?? {});
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/upload", requireAdmin, imageUpload, async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Selecciona una imagen en formato JPG, PNG o WebP." });
      return;
    }
    if (!env.IMGBB_API_KEY) {
      res.status(503).json({ error: "La carga de imágenes no está configurada en el servidor." });
      return;
    }
    try {
      const form = new FormData();
      form.append("image", new Blob([file.buffer], { type: file.mimetype }), "menu-image.jpg");
      const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null);
      const url = payload?.data?.display_url ?? payload?.data?.url;
      if (!response.ok || typeof url !== "string" || !url.startsWith("https://")) {
        req.log?.warn({ status: response.status }, "ImgBB rejected the image upload");
        res.status(502).json({ error: "ImgBB no pudo procesar la imagen. Intenta con otra foto." });
        return;
      }
      res.status(201).json({ url });
    } catch (error) {
      req.log?.warn({ errorName: error?.name ?? "Error" }, "Image upload request failed");
      res.status(502).json({ error: "No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo." });
    }
  });

  router.post("/admin/products", requireAdmin, (req, res) => {
    const validated = validProduct(req.body ?? {});
    if (validated.error) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const product = validated.value;
    const slug = uniqueSlug(db, product.name);
    const result = db.prepare(`
      INSERT INTO products (slug, name, description, category, image_url, price, offer_price, is_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, product.name, product.description, product.category, product.imageUrl, product.price, product.offerPrice, Number(product.isAvailable));
    res.status(201).json(productById(db, Number(result.lastInsertRowid)));
  });

  router.patch("/admin/products/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Identificador de producto no válido." });
      return;
    }
    const validated = validProduct(req.body ?? {});
    if (validated.error) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const exists = db.prepare("SELECT 1 FROM products WHERE id = ?").get(id);
    if (!exists) {
      res.status(404).json({ error: "No encontramos ese producto." });
      return;
    }
    const product = validated.value;
    db.prepare(`
      UPDATE products SET name = ?, description = ?, category = ?, image_url = ?,
        price = ?, offer_price = ?, is_available = ? WHERE id = ?
    `).run(product.name, product.description, product.category, product.imageUrl, product.price, product.offerPrice, Number(product.isAvailable), id);
    res.json(productById(db, id));
  });

  router.delete("/admin/products/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Identificador de producto no válido." });
      return;
    }
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "No encontramos ese producto." });
      return;
    }
    res.sendStatus(204);
  });

  router.post("/admin/zones", requireAdmin, (req, res) => {
    const validated = validZone(req.body ?? {});
    if (validated.error) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const zone = validated.value;
    const result = db.prepare("INSERT INTO zones (name, delivery_fee, is_active) VALUES (?, ?, ?)").run(zone.name, zone.deliveryFee, Number(zone.isActive));
    res.status(201).json({ id: Number(result.lastInsertRowid), name: zone.name, deliveryFee: zone.deliveryFee, isActive: zone.isActive });
  });

  router.patch("/admin/zones/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Identificador de zona no válido." });
      return;
    }
    const validated = validZone(req.body ?? {});
    if (validated.error) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const zone = validated.value;
    const result = db.prepare("UPDATE zones SET name = ?, delivery_fee = ?, is_active = ? WHERE id = ?")
      .run(zone.name, zone.deliveryFee, Number(zone.isActive), id);
    if (result.changes === 0) {
      res.status(404).json({ error: "No encontramos esa zona." });
      return;
    }
    res.json({ id, name: zone.name, deliveryFee: zone.deliveryFee, isActive: zone.isActive });
  });

  router.delete("/admin/zones/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: "Identificador de zona no válido." });
      return;
    }
    const result = db.prepare("DELETE FROM zones WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "No encontramos esa zona." });
      return;
    }
    res.sendStatus(204);
  });

  router.patch("/admin/orders/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status;
    const allowed = ["pending_verification", "confirmed", "preparing", "ready", "delivered", "rejected"];
    if (!Number.isSafeInteger(id) || id < 1 || !allowed.includes(status)) {
      res.status(400).json({ error: "El pedido o el estado no son válidos." });
      return;
    }
    const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
    if (result.changes === 0) {
      res.status(404).json({ error: "No encontramos ese pedido." });
      return;
    }
    const order = adminOrders(db).find((item) => item.id === id);
    res.json(order);
  });

  return router;
}

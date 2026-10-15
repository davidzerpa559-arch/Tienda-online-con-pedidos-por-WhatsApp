import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const defaultProducts = [
  {
    slug: "arepa-reina-pepiada",
    name: "Arepa reina pepiada",
    description: "Pollo mechado, aguacate cremoso y un toque de limón.",
    category: "Arepas",
    price: 5.5,
    offerPrice: null,
  },
  {
    slug: "cachapa-con-queso",
    name: "Cachapa con queso",
    description: "Maíz dulce a la plancha con queso de mano.",
    category: "Cachapas",
    price: 6.5,
    offerPrice: null,
  },
  {
    slug: "tequenos-x6",
    name: "Tequeños x6",
    description: "Seis tequeños dorados, recién hechos para compartir.",
    category: "Para compartir",
    price: 4.5,
    offerPrice: 3.9,
  },
];

export function openDatabase(filePath = process.env.DATABASE_FILE || "database.sqlite") {
  const resolvedPath = filePath === ":memory:" ? filePath : resolve(filePath);
  if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      whatsapp_number TEXT NOT NULL DEFAULT '',
      physical_address TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_id TEXT NOT NULL DEFAULT '',
      bank_phone TEXT NOT NULL DEFAULT '',
      is_open INTEGER NOT NULL DEFAULT 0,
      pickup_enabled INTEGER NOT NULL DEFAULT 1,
      webhook_url TEXT
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      price REAL NOT NULL CHECK (price >= 0),
      offer_price REAL CHECK (offer_price IS NULL OR offer_price >= 0),
      is_available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      delivery_fee REAL NOT NULL CHECK (delivery_fee >= 0),
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      visitor_hash TEXT NOT NULL,
      reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
      UNIQUE (product_id, visitor_hash)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      cedula TEXT NOT NULL,
      phone TEXT NOT NULL,
      fulfillment TEXT NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
      zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
      zone_name TEXT,
      address TEXT NOT NULL DEFAULT '',
      reference_point TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      payment_reference TEXT NOT NULL UNIQUE,
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL CHECK (subtotal >= 0),
      delivery_fee REAL NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
      total REAL NOT NULL CHECK (total >= 0),
      status TEXT NOT NULL DEFAULT 'pending_verification'
        CHECK (status IN ('pending_verification', 'confirmed', 'preparing', 'ready', 'delivered', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_product_created ON comments(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
  `);

  db.prepare(`
    INSERT INTO config (
      id, store_name, tagline, logo_url, whatsapp_number, physical_address,
      bank_name, bank_id, bank_phone, is_open, pickup_enabled, webhook_url
    ) VALUES (1, ?, ?, NULL, '', '', '', '', '', 0, 1, NULL)
    ON CONFLICT(id) DO NOTHING
  `).run("Sazón de Barrio", "Comida hecha con cariño, lista para compartir.");

  const insertProduct = db.prepare(`
    INSERT INTO products (slug, name, description, category, image_url, price, offer_price, is_available)
    VALUES (@slug, @name, @description, @category, NULL, @price, @offerPrice, 1)
    ON CONFLICT(slug) DO NOTHING
  `);
  const seedProducts = db.transaction(() => {
    for (const product of defaultProducts) insertProduct.run(product);
  });
  seedProducts();

  return db;
}

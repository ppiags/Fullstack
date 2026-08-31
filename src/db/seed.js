import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getDb, initDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../../data');

export function runSeed(db) {
  const products = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'));
  const keysData = JSON.parse(fs.readFileSync(path.join(dataDir, 'keys.json'), 'utf8'));
  const promos = JSON.parse(fs.readFileSync(path.join(dataDir, 'promocodes.json'), 'utf8'));

  const upsertProduct = db.prepare(`
    INSERT INTO products (sku, name, type, price, currency, image)
    VALUES (@sku, @name, @type, @price, @currency, @image)
    ON CONFLICT(sku) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      price = excluded.price,
      currency = excluded.currency,
      image = excluded.image
  `);
  for (const p of products.products) upsertProduct.run(p);

  const insertKey = db.prepare(`
    INSERT OR IGNORE INTO keys (code, status) VALUES (?, 'available')
  `);
  for (const code of keysData.keys) insertKey.run(code);

  const upsertPromo = db.prepare(`
    INSERT INTO promocodes (code, type, value, currency, max_uses, used_count)
    VALUES (@code, @type, @value, @currency, @max_uses, 0)
    ON CONFLICT(code) DO UPDATE SET
      type = excluded.type,
      value = excluded.value,
      currency = excluded.currency,
      max_uses = excluded.max_uses,
      used_count = 0
  `);
  for (const promo of promos.promocodes) {
    upsertPromo.run({ ...promo, currency: promo.currency ?? null });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const db = getDb();
  initDb(db);
  runSeed(db);
  console.log('Seeded OK');
}

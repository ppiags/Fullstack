import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getDb, initDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../../data');

const TARGET_OFFERS = 3000;
const SELLERS = ['Seller A', 'Seller B', 'Seller C', 'Seller D', 'Seller E'];

function stockForOffer(index) {
  return (index % 20) + 1;
}

function seedOffers(db) {
  const now = new Date().toISOString();
  const products = db.prepare('SELECT sku, price, currency FROM products').all();

  db.exec('DELETE FROM keys WHERE offer_id IS NOT NULL');
  db.exec('DELETE FROM offers');

  const upsertSyntheticProduct = db.prepare(`
    INSERT INTO products (sku, name, type, price, currency, image)
    VALUES (@sku, @name, @type, @price, @currency, NULL)
    ON CONFLICT(sku) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      price = excluded.price,
      currency = excluded.currency
  `);

  const insertOffer = db.prepare(`
    INSERT INTO offers (
      id, product_sku, seller_name, price, currency,
      stock_available, stock_reserved, updated_at
    ) VALUES (
      @id, @product_sku, @seller_name, @price, @currency,
      @stock_available, 0, @updated_at
    )
  `);

  const insertOfferKey = db.prepare(`
    INSERT INTO keys (code, status, offer_id) VALUES (?, 'available', ?)
  `);

  const createOffer = (offerId, productSku, sellerName, price, currency, stock, index) => {
    insertOffer.run({
      id: offerId,
      product_sku: productSku,
      seller_name: sellerName,
      price,
      currency,
      stock_available: stock,
      updated_at: now,
    });
    for (let k = 0; k < stock; k++) {
      insertOfferKey.run(`KEY-${offerId}-${k}`, offerId);
    }
    return index + 1;
  };

  const seedTransaction = db.transaction(() => {
    let offerIndex = 0;

    for (const product of products) {
      if (product.sku.startsWith('GEN-')) continue;
      const numSellers = 3 + (offerIndex % 3);
      for (let s = 0; s < numSellers; s++) {
        const offerId = `off_${product.sku}_${s}`;
        const stock = stockForOffer(offerIndex);
        const price = product.price + s * 10;
        offerIndex = createOffer(
          offerId,
          product.sku,
          SELLERS[s % SELLERS.length],
          price,
          product.currency,
          stock,
          offerIndex,
        );
      }
    }

    let genIndex = 0;
    while (offerIndex < TARGET_OFFERS - 1) {
      const sku = `GEN-${genIndex}`;
      const type = genIndex % 2 === 0 ? 'key' : 'giftcard';
      upsertSyntheticProduct.run({
        sku,
        name: `Synthetic ${type} ${genIndex}`,
        type,
        price: 500 + (genIndex % 500),
        currency: 'RUB',
      });

      const numSellers = 3 + (offerIndex % 3);
      for (let s = 0; s < numSellers && offerIndex < TARGET_OFFERS - 1; s++) {
        const offerId = `off_${sku}_${s}`;
        const stock = stockForOffer(offerIndex);
        const price = 500 + (genIndex % 500) + s * 10;
        offerIndex = createOffer(
          offerId,
          sku,
          SELLERS[s % SELLERS.length],
          price,
          'RUB',
          stock,
          offerIndex,
        );
      }
      genIndex++;
    }

    const cs2 = products.find((p) => p.sku === 'KEY-CS2-PRIME');
    createOffer(
      'off_race_last',
      'KEY-CS2-PRIME',
      'Seller Race',
      (cs2?.price ?? 1290) - 10,
      cs2?.currency ?? 'RUB',
      1,
      offerIndex,
    );
  });

  seedTransaction();
}

export function runSeed(db) {
  const products = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'));
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

  seedOffers(db);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const db = getDb();
  initDb(db);
  runSeed(db);
  console.log('Seeded OK');
}

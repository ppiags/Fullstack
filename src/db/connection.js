import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    const dbPath = process.env.DB_PATH || './data/store.db';
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
  }
  return dbInstance;
}

function migrateColumns(db) {
  const migrations = [
    'ALTER TABLE orders ADD COLUMN offer_id TEXT',
    'ALTER TABLE orders ADD COLUMN hold_expires_at TEXT',
    'ALTER TABLE keys ADD COLUMN offer_id TEXT',
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!String(e.message).includes('duplicate column name')) throw e;
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_keys_offer_status ON keys(offer_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_hold ON orders(status, hold_expires_at)');
}

export function initDb(db = getDb()) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateColumns(db);
}

export function seedDb(db = getDb()) {
  runSeed(db);
}

export function resetDbForTests() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

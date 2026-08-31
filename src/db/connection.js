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

export function initDb(db = getDb()) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
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

import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getDb, initDb, seedDb } from './db/connection.js';
import apiRouter from './routes/api.js';
import webhooksRouter from './routes/webhooks.js';
import adminRouter from './routes/admin.js';
import payRouter from './routes/pay.js';
import { supplierARouter, supplierBRouter } from './routes/suppliers.js';
import { attachWebSocket } from './services/wsHub.js';
import { startHoldExpiry } from './services/holdExpiryService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const db = getDb();
  initDb(db);
  seedDb(db);

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', apiRouter);
  app.use('/webhook', webhooksRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/pay', payRouter);
  app.use('/supplier-a', supplierARouter);
  app.use('/supplier-b', supplierBRouter);

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
  attachWebSocket(server);
  startHoldExpiry();
}

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsonPost } from './lib/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const scripts = [
  'race-test-webhook.js',
  'race-test-webhook-dedup.js',
  'race-test-webhook-early.js',
  'race-test-double-buy.js',
  'race-test-promo.js',
  'race-test-out-of-stock.js',
  'race-test-last-unit.js',
];

async function runScript(name) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(__dirname, name)], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ALLOW_TEST_ORDER_ID: '1',
        SUPPLIER_A_ERROR_RATE: '0',
        SUPPLIER_B_ERROR_RATE: '0',
      },
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited ${code}`))));
  });
}

for (const script of scripts) {
  console.log('\nResetting test DB...');
  const reset = await jsonPost('/api/test/reset-db', {});
  if (reset.status !== 200) {
    console.error('FAIL: start server with ALLOW_TEST_ORDER_ID=1 first');
    process.exit(1);
  }

  console.log(`\n=== ${script} ===`);
  await runScript(script);
}

console.log('\nAll race tests passed');

import { test } from 'node:test';
import assert from 'node:assert/strict';

function remainingMs(order, serverNowIso, clientReceivedAt) {
  const skew = clientReceivedAt - Date.parse(serverNowIso);
  return Date.parse(order.hold_expires_at) - (Date.now() - skew);
}

test('remainingMs accounts for server/client clock skew', () => {
  const serverNowMs = Date.now() - 5000;
  const serverNow = new Date(serverNowMs).toISOString();
  const clientReceivedAt = Date.now();
  const holdExpires = new Date(Date.now() + 120_000).toISOString();
  const order = { hold_expires_at: holdExpires };

  const ms = remainingMs(order, serverNow, clientReceivedAt);
  assert.ok(ms > 115_000 && ms <= 126_000);
});

test('remainingMs is zero when hold already expired', () => {
  const serverNow = new Date().toISOString();
  const clientReceivedAt = Date.now();
  const holdExpires = new Date(Date.now() - 1000).toISOString();
  const order = { hold_expires_at: holdExpires };

  const ms = remainingMs(order, serverNow, clientReceivedAt);
  assert.ok(ms <= 0);
});

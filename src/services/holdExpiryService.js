import { expireDueHolds } from './orderService.js';

let intervalId = null;

export function startHoldExpiry(intervalMs = 1000) {
  if (intervalId) return intervalId;
  intervalId = setInterval(() => {
    try {
      expireDueHolds();
    } catch (e) {
      console.error('expireDueHolds error', e);
    }
  }, intervalMs);
  return intervalId;
}

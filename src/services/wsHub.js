import WebSocket, { WebSocketServer } from 'ws';

const clients = new Set();

export function attachWebSocket(server, path = '/ws') {
  const wss = new WebSocketServer({ server, path });
  wss.on('connection', (ws) => {
    attachClient(ws);
    ws.send(JSON.stringify({ type: 'hello', serverNow: new Date().toISOString() }));
  });
  return wss;
}

export function attachClient(ws) {
  clients.add(ws);
  ws.on?.('close', () => clients.delete(ws));
  ws.on?.('error', () => clients.delete(ws));
}

export function clearClients() {
  clients.clear();
}

export function broadcast(type, payload = {}) {
  const message = JSON.stringify({ type, ...payload });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

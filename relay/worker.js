/**
 * Jomboy graphics relay.
 *
 * One Durable Object per room. The control page POSTs the current state, every connected
 * display gets it pushed over a WebSocket, and the object keeps the last state so a Browser
 * Source that OBS just refreshed is caught up the instant it connects.
 *
 * This exists because the public ntfy instances kept going down mid-show. Same shape of
 * traffic, but on infrastructure you own.
 *
 *   POST /r/<room>   body = state JSON   → store and broadcast
 *   GET  /r/<room>                       → last state (polling fallback / backfill)
 *   GET  /r/<room>   Upgrade: websocket  → live push, current state sent on connect
 *   GET  /                               → health check
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    // WebSocket subscribe. Hibernation API, so an idle room costs nothing while a show is
    // between graphics but connected clients are never dropped.
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      const current = await this.state.storage.get('state');
      if (current) {
        try { pair[1].send(current); } catch { /* client vanished between accept and send */ }
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (request.method === 'POST') {
      const body = await request.text();
      if (body.length > 512 * 1024) return json({ error: 'state too large' }, 413);
      await this.state.storage.put('state', body);
      let sent = 0;
      for (const ws of this.state.getWebSockets()) {
        // one dead socket must not stop the rest of the room being updated
        try { ws.send(body); sent++; } catch { /* it will drop on its own */ }
      }
      return json({ ok: true, sent });
    }

    const current = await this.state.storage.get('state');
    return json(current || 'null');
  }

  // Clients only listen; anything inbound is ignored rather than trusted.
  async webSocketMessage() {}
  async webSocketClose(ws, code, reason, wasClean) { try { ws.close(code, reason); } catch {} }
  async webSocketError() {}
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/r\/([A-Za-z0-9._-]{1,64})\/?$/);
    if (!match) {
      return json({ ok: true, service: 'jomboy-relay', usage: 'POST or GET /r/<room>' });
    }

    const id = env.ROOM.idFromName(match[1]);
    return env.ROOM.get(id).fetch(request);
  },
};

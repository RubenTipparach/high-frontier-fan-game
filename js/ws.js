// WebSocket client. Auto-reconnect with exponential backoff. Tracks
// the set of subscribed channels so a re-connection silently resubs
// to whatever was active before the drop. Consumers register typed
// handlers via on(type, handler).

import { apiBaseUrl } from './api.js';

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 15000];
// Stop attempting reconnects after this many consecutive failures.
// User 2026-05-29: Firefox repeatedly fails the wss handshake to the
// production server and the loop spams the console forever. Polling
// (lobby + game) is the real fallback path - once we've given up on
// the socket, the REST polls continue to drive every UI update, and
// the next deliberate ws.connect() (e.g. a fresh sign-in) restarts
// the attempt counter. Surfaced as state: { ready:false, giveUp:true }
// so a UI layer can show "Live updates unavailable - polling for
// changes" without polling the connection itself.
const MAX_RECONNECT_ATTEMPTS = 6;

export class WSClient {
  constructor() {
    this.ws = null;
    this.token = null;
    this.profile = null;
    this.ready = false;            // post-auth
    this.handlers = new Map();     // type -> Set<fn>
    this.channels = new Set();     // channels we want to be subscribed to
    this.reconnectAttempt = 0;
    this.deliberatelyClosed = false;
    this._pingTimer = null;
  }

  // Derive ws(s):// URL from the meta-configured HTTP API base. Same
  // host, /ws path; http -> ws, https -> wss.
  url() {
    const base = apiBaseUrl();
    if (!base) return null;
    return base.replace(/^http/, 'ws') + '/ws';
  }

  on(type, fn) {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(type, msg) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) {
      try { fn(msg); } catch (err) { console.error('ws handler', type, err); }
    }
  }

  connect(token) {
    this.token = token;
    this.deliberatelyClosed = false;
    // Fresh connect resets the give-up counter so a transient outage
    // earlier in the session doesn't bar WS forever.
    this.reconnectAttempt = 0;
    this._openSocket();
  }

  disconnect() {
    this.deliberatelyClosed = true;
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.ready = false;
    this.channels.clear();
    this.emit('state', { ready: false, closed: true });
  }

  _openSocket() {
    const url = this.url();
    if (!url || !this.token) return;
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => {
      this.ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'auth_ok':
          this.profile = msg.profile;
          this.ready = true;
          this.reconnectAttempt = 0;
          // Re-establish whatever subscriptions were active before the drop.
          for (const ch of this.channels) {
            this.ws.send(JSON.stringify({ type: 'sub', channel: ch }));
          }
          this.emit('state', { ready: true });
          this._startPing();
          return;
        case 'auth_error':
          this.deliberatelyClosed = true;
          this.emit('state', { ready: false, authError: true });
          try { this.ws.close(); } catch {}
          return;
        default:
          this.emit(msg.type, msg);
          this.emit('*', msg);
      }
    });
    this.ws.addEventListener('close', () => {
      this.ready = false;
      this.emit('state', { ready: false });
      if (!this.deliberatelyClosed) this._scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      // The close handler will run after, handling reconnect.
    });
  }

  _scheduleReconnect() {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      // Give up on the socket and let the REST polls handle every
      // update from here. A fresh connect() (sign-in, etc.) resets
      // the counter so a transient outage doesn't lock the client
      // out of WS for the whole session.
      this.emit('state', { ready: false, giveUp: true });
      return;
    }
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    setTimeout(() => { if (!this.deliberatelyClosed) this._openSocket(); }, delay);
  }

  _startPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  }

  subscribe(channel) {
    this.channels.add(channel);
    if (this.ready && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'sub', channel }));
    }
  }

  unsubscribe(channel) {
    this.channels.delete(channel);
    if (this.ready && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'unsub', channel }));
    }
  }
}

// Singleton so different modules share one socket.
export const ws = new WSClient();

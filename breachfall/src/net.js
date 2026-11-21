// Co-op over WebRTC data channels, using PeerJS for the handshake (its free public server introduces the
// browsers to each other; after that they talk directly). One player hosts: their game runs the zombies, the
// rounds and the order of every wall that breaks. Friends join with the host's five-letter room code.
//
// For a local test, add ?peer=localhost:9000 to the address to use your own PeerJS server instead.

const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'breachfall-v2-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export class Net {
  constructor() {
    this.role = 'solo'; this.id = 'h'; this.code = ''; this.peer = null; this.hostConn = null;
    this.conns = new Map(); this.names = new Map(); this.n = 0;
    this.onMsg = null; this.onJoin = null; this.onLeave = null; this.onDrop = null;
  }
  get active() { return this.role !== 'solo'; }
  get host() { return this.role === 'host'; }
  get client() { return this.role === 'client'; }
  static supported() { return typeof RTCPeerConnection !== 'undefined'; }

  async load() {
    if (window.Peer) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = PEER_URL; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error('The co-op library could not be downloaded. Check your connection.' + HINT));
      document.head.appendChild(s);
    });
  }
  options() {
    const q = new URLSearchParams(location.search).get('peer');
    if (q) { const [host, port] = q.split(':'); return { host, port: +port || 9000, path: '/', secure: false, debug: 1 }; }
    return { debug: 1 };
  }
  open(id) {
    return new Promise((res, rej) => {
      const p = id ? new window.Peer(id, this.options()) : new window.Peer(this.options());
      const t = setTimeout(() => rej(new Error('The co-op server did not answer. Try again in a moment.' + HINT)), 12000);
      p.on('open', () => { clearTimeout(t); this.peer = p; res(p); });
      p.on('error', (e) => { if (!this.peer) { clearTimeout(t); p.destroy(); rej(e); } else if (e.type === 'peer-unavailable') this.onDrop?.('No game is running with that code.'); });
      p.on('disconnected', () => { if (this.peer === p && !p.destroyed) p.reconnect(); });
    });
  }

  async hostGame() {
    await this.load();
    for (let tries = 0; ; tries++) {
      const code = Array.from({ length: 5 }, () => LETTERS[(Math.random() * LETTERS.length) | 0]).join('');
      try { await this.open(PREFIX + code); this.code = code; break; }
      catch (e) { if (e.type !== 'unavailable-id' || tries > 4) throw friendly(e); }
    }
    this.role = 'host'; this.id = 'h';
    this.peer.on('connection', (c) => {
      c.on('open', () => {
        const id = 'p' + (++this.n); c.pid = id; this.conns.set(id, c);
        c.on('data', (m) => { if (m && m.k === 'hello') { this.names.set(id, String(m.name || 'Player').slice(0, 16)); this.onJoin?.(id, this.names.get(id)); } else this.onMsg?.(id, m); });
        c.on('close', () => { if (this.conns.delete(id)) this.onLeave?.(id, this.names.get(id)); });
        c.on('error', () => {});
      });
    });
    return this.code;
  }

  async joinGame(code, name) {
    await this.load();
    code = code.trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) throw new Error('A room code is five letters.');
    try { await this.open(null); } catch (e) { throw friendly(e); }
    const c = this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('No game is running with that code.')), 12000);
      this.onDrop = (msg) => { clearTimeout(t); rej(new Error(msg)); };
      c.on('open', () => { clearTimeout(t); res(); });
      c.on('error', () => { clearTimeout(t); rej(new Error('Could not reach that game.')); });
    });
    this.onDrop = null;
    this.role = 'client'; this.hostConn = c; this.code = code;
    c.on('data', (m) => this.onMsg?.('h', m));
    c.on('close', () => { this.onLeave?.('h', 'host'); });
    c.send({ k: 'hello', name });
  }

  // client: to the host. host: to everyone, or everyone but one
  send(m) { if (this.client) this.hostConn?.open && this.hostConn.send(m); else if (this.host) this.broadcast(m); }
  to(id, m) { if (this.host) { const c = this.conns.get(id); if (c?.open) c.send(m); } }
  broadcast(m, except) { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m); }
  close() {
    try { this.hostConn?.close(); for (const c of this.conns.values()) c.close(); this.peer?.destroy(); } catch { /* already gone */ }
    this.role = 'solo'; this.id = 'h'; this.peer = null; this.hostConn = null; this.conns.clear(); this.names.clear();
  }
}

const EMBEDDED = (() => { try { return window.top !== window; } catch { return true; } })();
const HINT = EMBEDDED ? ' If you are playing inside a preview window, co-op is blocked there: open the hosted copy of the game instead.' : '';
function friendly(e) {
  const t = e && e.type;
  if (t === 'browser-incompatible') return new Error('This browser cannot make direct connections, so co-op is unavailable here.');
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return new Error('Could not reach the co-op server. Check your connection and try again.' + HINT);
  return e instanceof Error ? e : new Error(String(e && e.message || e));
}

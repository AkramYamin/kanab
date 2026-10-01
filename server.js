// Space Heroes — local game server.
//
// Serves the TV page (/) and the phone page (/play), and runs the match
// itself (see server/host.js):
//   phone --(binary stick input, ~60/s)--> server (60 steps/s simulation)
//   server --(snapshots 60/s)--> TV / laptop screens
//   server --(snapshots 30/s)--> phones that show the game themselves
//   server --(HUD, vibration)--> every phone

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { Host } from './server/host.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
};

const ROUTES = {
  '/': path.join(PUBLIC, 'index.html'),
  '/play': path.join(PUBLIC, 'play.html'),
  '/vendor/nipplejs.js': path.join(ROOT, 'node_modules/nipplejs/dist/nipplejs.js'),
};

// Pick the address phones on the same Wi-Fi can reach. HOST_IP overrides.
function lanAddress() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  const preferred = ['en0', 'en1', 'wlan0', 'wlp2s0', 'eth0', 'Wi-Fi', 'Ethernet'];
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const rank = (preferred.includes(name) ? 0 : 10) + (isPrivate ? 0 : 5);
      found.push({ address: a.address, rank });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return found[0]?.address || 'localhost';
}

const joinUrl = `http://${lanAddress()}:${PORT}/play`;
const qrSvg = await QRCode.toString(joinUrl, {
  type: 'svg',
  margin: 1,
  errorCorrectionLevel: 'M',
  color: { dark: '#0b1020', light: '#ffffff' },
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    res.end(JSON.stringify({ joinUrl, qr: qrSvg }));
    return;
  }
  let file = ROUTES[url.pathname];
  if (!file) {
    file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC + path.sep)) {
      res.writeHead(403).end();
      return;
    }
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// WebSockets: phones (players) and screens (the TV / laptop view)

// Compression adds latency for tiny messages, so it stays off.
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 64 * 1024 });

const screens = new Set();
const phones = new Map(); // cid -> { cid, pid, ws, info, seen }
const byPid = new Map(); // pid -> phone record

const sendRaw = (ws, str) => {
  if (ws && ws.readyState === 1) ws.send(str);
};

const host = new Host(
  {
    phone: (pid, str) => sendRaw(byPid.get(pid)?.ws, str),
    phones: (str) => {
      for (const p of phones.values()) sendRaw(p.ws, str);
    },
    screens: (str) => {
      for (const ws of screens) sendRaw(ws, str);
    },
    hasScreens: () => screens.size > 0,
  },
  process.env.SETTINGS_FILE || path.join(ROOT, '.settings.json'),
  path.join(PUBLIC, 'voices'),
  // FAMILY_DIR=none hides the family names and picture (e.g. for public screenshots).
  process.env.FAMILY_DIR || path.join(PUBLIC, 'family'),
);

function allocPid() {
  for (let pid = 1; pid < 256; pid++) if (!byPid.has(pid)) return pid;
  // All slots used: evict the phone that has been gone the longest.
  let oldest = null;
  for (const p of phones.values()) if (!p.ws && (!oldest || p.seen < oldest.seen)) oldest = p;
  if (!oldest) return 0;
  phones.delete(oldest.cid);
  byPid.delete(oldest.pid);
  return oldest.pid;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  let role = null;
  let phone = null;

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (phone) host.phoneInput(phone.pid, data);
      else if (role === 'screen') host.screenInput(data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'ping') {
      sendRaw(ws, JSON.stringify({ t: 'pong', ts: msg.ts }));
      return;
    }
    if (role === 'screen') return host.screenMessage(msg);
    if (role === 'phone') {
      if (msg.t === 'join') {
        phone.info = {
          name: String(msg.name || 'Player').slice(0, 14),
          color: String(msg.color || '#ffcc4d').slice(0, 9),
          team: msg.team === 'red' || msg.team === 'blue' ? msg.team : 'auto',
        };
        host.phoneJoined(phone.pid, phone.info);
      } else if (phone.info) host.phoneMessage(phone.pid, msg);
      return;
    }

    if (msg.t === 'hello' && (msg.role === 'screen' || msg.role === 'host')) {
      role = 'screen';
      screens.add(ws);
      host.screenHello((str) => sendRaw(ws, str));
      console.log(`📺 screen connected (${screens.size} open)`);
    } else if (msg.t === 'hello' && msg.role === 'phone') {
      role = 'phone';
      const cid = String(msg.cid || Math.random()).slice(0, 40);
      phone = phones.get(cid);
      if (!phone) {
        phone = { cid, pid: allocPid(), ws: null, info: null, seen: Date.now() };
        if (!phone.pid) return ws.close(4001, 'full');
        phones.set(cid, phone);
        byPid.set(phone.pid, phone);
      }
      if (phone.ws && phone.ws !== ws) phone.ws.close(4002, 'reconnected');
      phone.ws = ws;
      sendRaw(ws, JSON.stringify({ t: 'welcome', pid: phone.pid, host: true }));
      sendRaw(ws, JSON.stringify(host.lobbyMsg()));
      console.log(`📱 phone #${phone.pid} connected`);
    }
  });

  ws.on('close', () => {
    if (role === 'screen') {
      screens.delete(ws);
      console.log(`📺 screen closed (${screens.size} open)`);
    } else if (role === 'phone' && phone && phone.ws === ws) {
      phone.ws = null;
      phone.seen = Date.now();
      host.phoneLeft(phone.pid);
      console.log(`📱 phone #${phone.pid} left`);
    }
  });
});

// Drop sockets that stopped answering (phone locked, left Wi-Fi, ...).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  const line = '─'.repeat(52);
  console.log(`\n${line}\n  🎮  SPACE HEROES is running!\n${line}`);
  console.log(`  TV / laptop : http://localhost:${PORT}`);
  console.log(`  Phones      : ${joinUrl}  (or scan the QR on the TV)`);
  console.log(`${line}\n`);
});

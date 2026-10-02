// Makes the README pictures and clips in docs/media/ with headless Chrome.
// Needs a game server; start it with FAMILY_DIR=none so your own team names
// and picture stay out of the images:
//   PORT=3100 FAMILY_DIR=none SETTINGS_FILE=/tmp/media.json node server.js
//   BASE=http://localhost:3100 npm run media
//   ONLY=hero,maps npm run media        (some of: weapons, hero, maps, join, play, arabic)
//   KEEP=dir KEEP_REEL=dir              (also keep the raw shots / reel frames, to pick moments by hand)
//
// The clips are animated WebP (they play inline on GitHub). Encoding them
// needs Python with Pillow; the voice tool's environment has it, or set PYTHON.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/media'));
const ONLY = new Set((process.env.ONLY || '').split(',').filter(Boolean));
const PYTHON = process.env.PYTHON || [path.join(ROOT, 'tools/voice/.venv/bin/python'), 'python3'].find((p) => p === 'python3' || existsSync(p));
const PORT = Number(process.env.CDP_PORT || 9334);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !ONLY.size || ONLY.has(name);

await fs.mkdir(OUT, { recursive: true });
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sh-media-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--window-size=1920,1080', 'about:blank',
], { stdio: 'ignore' });

class Tab {
  static async open() {
    for (let i = 0; i < 50; i++) {
      try {
        const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
        const tab = new Tab(t.webSocketDebuggerUrl);
        await tab.ready;
        await tab.send('Page.enable');
        return tab;
      } catch {
        await sleep(200);
      }
    }
    throw new Error('Chrome did not start');
  }

  constructor(url) {
    this.ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.method) return this.listeners.get(m.method)?.(m.params);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  async size(width, height, { mobile = false, scale = 1 } = {}) {
    this.w = width;
    this.h = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  async go(url, wait = 1500) {
    await this.send('Page.navigate', { url });
    await sleep(wait);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || expression);
    return r.result.value;
  }

  // A JPEG of the page, as bytes.
  async grab(quality = 90, front = true) {
    if (front) {
      await this.send('Page.bringToFront');
      await sleep(300);
    }
    const { data } = await this.send('Page.captureScreenshot', { format: 'jpeg', quality });
    return Buffer.from(data, 'base64');
  }

  async shot(file, opts = {}) {
    await this.send('Page.bringToFront');
    await sleep(400);
    const { data } = await this.send('Page.captureScreenshot', { format: opts.png ? 'png' : 'jpeg', quality: opts.quality ?? 86 });
    await fs.writeFile(path.join(OUT, file), Buffer.from(data, 'base64'));
    console.log(`  saved ${path.relative(ROOT, path.join(OUT, file))}`);
  }

  // Records `seconds` of the page as JPEG frames with their timestamps.
  async record(seconds, dir) {
    await fs.mkdir(dir, { recursive: true });
    await this.send('Page.bringToFront');
    const frames = [];
    const writes = [];
    this.listeners.set('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      this.send('Page.screencastFrameAck', { sessionId });
      const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
      frames.push({ file, t: metadata.timestamp });
      writes.push(fs.writeFile(file, Buffer.from(data, 'base64')));
    });
    await this.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    await sleep(seconds * 1000);
    await this.send('Page.stopScreencast');
    this.listeners.delete('Page.screencastFrame');
    await Promise.all(writes);
    return frames;
  }
}

// Picks frames at a steady rate from each segment ({ frames, from, to } in
// screencast seconds) and encodes them, one after another, as an animated WebP.
async function encodeClip(segments, file, { fps = 20, width = 1280, quality = 70 } = {}) {
  const picked = [];
  for (const { frames, from, to } of segments) {
    let k = 0;
    for (let t = from; t <= to; t += 1 / fps) {
      while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
      picked.push(frames[k].file);
    }
  }
  const list = path.join(tmp, `${file}.json`);
  await fs.writeFile(list, JSON.stringify(picked));
  const py = `
import json, sys
from PIL import Image
files, out, w, fps, q = json.load(open(sys.argv[1])), sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
imgs = []
for f in files:
    im = Image.open(f).convert('RGB')
    imgs.append(im.resize((w, round(im.height * w / im.width)), Image.LANCZOS))
imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=round(1000 / fps), loop=0,
             quality=q, method=4, kmax=60)
`;
  const r = spawnSync(PYTHON, ['-c', py, list, path.join(OUT, file), String(width), String(fps), String(quality)], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`encoding ${file} failed (needs Python with Pillow; set PYTHON)`);
  const { size } = await fs.stat(path.join(OUT, file));
  console.log(`  saved ${path.relative(ROOT, path.join(OUT, file))} (${picked.length} frames, ${(size / 1e6).toFixed(1)} MB)`);
}

// The TV camera normally fits everyone on the map. For the clips a director
// follows the biggest fight up close instead, and every 50 ms notes how much
// is going on in view, so the script can keep the best seconds.
const DIRECTOR = `(minH) => {
  const cam = cc.cam;
  let fx = null, fy = null, fh = minH;
  cam.ease = function (tx, ty, tz, dt) {
    const map = cc.world.map;
    if (window.__overview) {
      this.x = map.W / 2; this.y = map.H / 2;
      this.zoom = Math.min(cc.renderer.cw / map.W, cc.renderer.ch / map.H);
      return;
    }
    const alive = [...cc.world.players.values()].filter((p) => p.alive);
    let best = null;
    for (const p of alive) {
      const near = alive.filter((q) => Math.hypot(p.x - q.x, p.y - q.y) < 700);
      const red = near.filter((q) => q.team === 'red').length;
      const cx = near.reduce((s, q) => s + q.x, 0) / near.length;
      const cy = near.reduce((s, q) => s + q.y, 0) / near.length;
      // A fight needs both teams; stay on the current one unless a better one starts.
      const score = near.length + 3 * Math.min(red, near.length - red) - (fx === null ? 0 : Math.hypot(cx - fx, cy - fy) / 600);
      if (!best || score > best.score) {
        const xs = near.map((q) => q.x), ys = near.map((q) => q.y);
        const h = Math.max((Math.max(...ys) - Math.min(...ys)) + 420, ((Math.max(...xs) - Math.min(...xs)) + 520) * 9 / 16);
        best = { score, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - 40, h };
      }
    }
    if (!best) return;
    if (fx === null) { fx = best.x; fy = best.y; }
    const k = 1 - Math.exp(-2.6 * dt);
    fx += (best.x - fx) * k;
    fy += (best.y - fy) * k;
    fh += (Math.min(1200, Math.max(minH, best.h)) - fh) * (1 - Math.exp(-1.2 * dt));
    this.x = fx; this.y = fy; this.zoom = cc.renderer.ch / fh;
  };
  cam.snap = function () { this.ready = true; this.ease(0, 0, 0, 1); };
  cam.ready = false;
  window.__overview = false;
  window.__act = [];
  let lx = 0, ly = 0;
  clearInterval(window.__sampler);
  window.__sampler = setInterval(() => {
    const w = cc.world;
    if (!w) return;
    const hw = cc.renderer.cw / 2 / cam.zoom, hh = cc.renderer.ch / 2 / cam.zoom;
    const inView = (o) => Math.abs(o.x - cam.x) < hw * 0.85 && Math.abs(o.y - cam.y) < hh * 0.85;
    const seen = [...w.players.values()].filter((p) => p.alive && inView(p));
    const red = seen.filter((p) => p.team === 'red').length;
    let a = seen.length + 3 * Math.min(red, seen.length - red);
    for (const b of w.projectiles) if (inView(b)) a += b.kind === 'bullet' ? 0.3 : 1.5;
    a -= Math.hypot(cam.x - lx, cam.y - ly) / 12; // whip pans look bad
    lx = cam.x; ly = cam.y;
    window.__act.push([Date.now() / 1000, a]);
  }, 50);
  return true;
}`;

// The window of `len` seconds with the most action, inside the recording.
function bestWindow(act, frames, len) {
  const t0 = frames[0].t + 0.3;
  const t1 = frames.at(-1).t - len;
  let best = null;
  for (const [t] of act) {
    if (t < t0 || t > t1) continue;
    const sum = act.reduce((s, [u, a]) => (u >= t && u < t + len ? s + a : s), 0);
    if (!best || sum > best.sum) best = { from: t, to: t + len, sum };
  }
  return best;
}

const setTo = async (tv, key, value) => {
  for (let i = 0; i < 12; i++) {
    const v = await tv.eval(`cc.lobby.settings.find((s) => s.key === '${key}').v`);
    if (v === value) return;
    await tv.eval(`cc.send({ t: 'set', key: '${key}', dir: 1 }); true`);
    await sleep(150);
  }
  throw new Error(`could not set ${key} to ${value}`);
};
const toLobby = async (tv) => {
  await tv.eval(`cc.lobby && cc.send({ t: 'lobby' }); true`);
  await sleep(700);
};

// Synthetic thumbs for the phone joysticks (nipplejs listens to pointer events).
const HOLD = `(id, zone, x0, y0, dx, dy) => {
  const el = document.querySelector(zone);
  const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y,
    bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1, buttons: 1 }));
  ev('pointerup', x0, y0); // let go of an earlier thumb first
  ev('pointerdown', x0, y0);
  for (let i = 1; i <= 8; i++) ev('pointermove', x0 + dx * i / 8, y0 + dy * i / 8);
  return true;
}`;

// The special weapons, staged in the lobby's background game on Glacier
// Keep's floor: a freeze ray, a hammer, bees and a black hole.
const WEAPONS_SCENE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('#lobby').classList.add('hidden');
  document.querySelector('#soundHint')?.classList.add('hidden');
  const g = cc.world;
  const P = [...g.players.values()];
  const put = (p, team, x, weapon, aim) => {
    Object.assign(p, { team, x, y: 1800, vx: 0, vy: 0, bot: null, prot: 0, hp: 100, weapon, ammo: 999, aim, alive: true });
    Object.assign(p.input, { mx: 0, my: 0, aiming: true, aim, fire: false });
  };
  // Teleporters sit at x 1560 and 1840, so stay clear of them.
  put(P[0], 'red', 860, 'freeze', -0.1);
  put(P[1], 'blue', 1080, 'blaster', Math.PI);
  put(P[2], 'red', 1150, 'hammer', 0);
  put(P[3], 'blue', 1400, 'shotgun', Math.PI);
  put(P[4], 'blue', 2250, 'bees', Math.PI + 0.35);
  put(P[5], 'red', 1980, 'rocket', Math.PI);
  // A fixed camera on the action (someone may fly off through a portal).
  cc.cam.ease = function () { this.x = 1555; this.y = 1540; this.zoom = cc.renderer.ch / 840; };
  cc.cam.snap = function () { this.ready = true; this.ease(); };
  cc.cam.ready = false;
  window.__scene = setInterval(() => {
    for (const p of P) { p.hp = 100; p.alive = true; }
    P[0].input.fire = P[1].frozenT <= 0.2;
    P[4].input.fire = true;
  }, 16);
  // Hammer the shotgun soldier, then throw a black hole into the middle.
  setTimeout(() => { P[2].input.mx = 1; P[2].input.fire = true; }, 900);
  setTimeout(() => { P[2].input.mx = 0; P[2].input.fire = false; }, 1500);
  setTimeout(() => {
    g.projectiles.push({ id: 99999, kind: 'hole', wkey: 'hole', owner: P[5].pid, team: 'red', x: 1700, y: 1690, vx: 0, vy: 0,
      life: 2.2, age: 0, gravity: 0, active: true });
  }, 1800);
  return true;
})()`;

// Device frames and the dark backdrop used by the pictures.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@500;700;800&family=Russo+One&family=Lalezar&display=swap');
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { background: radial-gradient(ellipse 80% 70% at 50% 0%, #2a3478 0%, #121838 55%, #080b1a 100%); color: #f4f6ff;
  font-family: Rubik, system-ui, sans-serif; position: relative; }
img { display: block; width: 100%; }
.abs { position: absolute; }
.tv { background: #04050a; padding: 12px; border-radius: 22px; box-shadow: 0 0 0 2px #2c3354, 0 40px 90px rgba(0, 0, 0, 0.6); }
.tv img { border-radius: 6px; }
.tv.stand::after { content: ''; position: absolute; left: 50%; bottom: -34px; width: 34%; height: 22px; transform: translateX(-50%);
  background: linear-gradient(#20253c, #0b0e1c); border-radius: 0 0 14px 14px; }
.phone { background: #04050a; padding: 12px; border-radius: 40px; box-shadow: 0 0 0 2px #3c4470, 0 30px 70px rgba(0, 0, 0, 0.65); }
.phone img { border-radius: 30px; }
.phone.wide { padding: 12px 16px; }
.step { position: absolute; display: flex; align-items: center; gap: 14px; font: 400 34px 'Russo One', 'Lalezar', sans-serif; white-space: nowrap; }
.step b { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; color: #221400; font-size: 28px;
  background: linear-gradient(180deg, #ffe38a, #ffcc4d 45%, #ff8a3d); box-shadow: 0 6px 18px rgba(255, 160, 60, 0.4); }
.tag { position: absolute; padding: 10px 20px; border-radius: 14px; background: rgba(8, 11, 26, 0.82); border: 1px solid rgba(255, 255, 255, 0.14);
  font: 400 28px 'Russo One', 'Lalezar', sans-serif; }
.tag small { display: block; font: 600 19px Rubik, sans-serif; color: #b6bde3; margin-top: 2px; }
.tile { position: absolute; border-radius: 16px; overflow: hidden; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.1), 0 20px 50px rgba(0, 0, 0, 0.5); }
.tile .tag { left: 12px; bottom: 12px; font-size: 19px; padding: 6px 13px; border-radius: 10px; }
.tile.big .tag { left: 18px; bottom: 18px; font-size: 26px; padding: 9px 18px; }
`;

const dataUri = async (file) => `data:image/jpeg;base64,${(await fs.readFile(file)).toString('base64')}`;

// Renders `body` (HTML using the CSS above) and saves it as a JPEG.
async function compose(tab, file, width, height, body) {
  await tab.size(width, height);
  await tab.go('about:blank', 200);
  const { frameTree } = await tab.send('Page.getFrameTree');
  await tab.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${body}</body>` });
  await tab.send('Page.bringToFront');
  await tab.eval(`Promise.race([
    Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]),
    new Promise((r) => setTimeout(r, 5000)),
  ]).then(() => true)`);
  await sleep(300);
  await tab.shot(file, { quality: 88 });
}

const MAPS = [
  ['canyon', 'Canyon Run'],
  ['glacier', 'Glacier Keep'],
  ['forest', 'Treehouse Forest'],
  ['temple', 'Jungle Temple'],
  ['district', 'Neon District'],
];
const shots = path.join(tmp, 'shots');
await fs.mkdir(shots, { recursive: true });
const keep = async (name, buf) => {
  const f = path.join(shots, name);
  await fs.writeFile(f, buf);
  if (process.env.KEEP) await fs.copyFile(f, path.join(process.env.KEEP, name));
  return f;
};
if (process.env.KEEP) await fs.mkdir(process.env.KEEP, { recursive: true });

try {
  // Screencasts come out right only from a tab sized before its first page,
  // so each recording gets a fresh TV tab.
  const tvTab = async (w, h, scale = 1) => {
    const tab = await Tab.open();
    await tab.size(w, h, { scale });
    await tab.go(`${BASE}/`, 2500);
    return tab;
  };
  const studio = await Tab.open();
  let tv = await tvTab(1920, 1080);
  await toLobby(tv);
  await setTo(tv, 'lang', 'en');
  await setTo(tv, 'screen', 'tv');
  await setTo(tv, 'assist', true);

  // ------------------------------------------- weapons clip (lobby demo)
  if (want('weapons')) {
    console.log('weapons clip');
    await setTo(tv, 'map', 'glacier');
    await sleep(1000);
    await tv.eval(WEAPONS_SCENE);
    await tv.send('Page.bringToFront');
    const frames = await tv.record(4.6, path.join(tmp, 'weapons'));
    await tv.eval(`clearInterval(window.__scene); true`);
    await encodeClip([{ frames, from: frames[0].t + 0.2, to: frames.at(-1).t }], 'weapons.webp', { width: 1100 });
  }

  // ------------------------------- gameplay reel + one picture per map
  if (want('hero') || want('maps')) {
    console.log('gameplay');
    tv = await tvTab(1280, 720, 1.5);
    await setTo(tv, 'mode', 'tdm');
    await setTo(tv, 'bots', 8);
    await setTo(tv, 'skill', 'hard');
    await setTo(tv, 'limit', 40);
    await setTo(tv, 'time', 15);
    const segments = [];
    const tiles = {};
    for (const [id] of MAPS) {
      await setTo(tv, 'map', id);
      await tv.eval(`cc.send({ t: 'start' }); true`);
      await sleep(400);
      await tv.eval(`(${DIRECTOR})(850)`);
      await tv.send('Page.bringToFront');
      await sleep(9000);
      const frames = await tv.record(22, path.join(tmp, `reel-${id}`));
      const act = await tv.eval('window.__act');
      if (process.env.KEEP_REEL) {
        // For picking the best moments by hand.
        const dir = path.join(process.env.KEEP_REEL, id);
        await fs.cp(path.join(tmp, `reel-${id}`), dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'frames.json'), JSON.stringify(frames));
      }
      const win = bestWindow(act, frames, 3.2);
      if (id !== 'district') segments.push({ frames, ...win }); // too dark for the reel
      // The whole map, for the maps picture.
      await tv.eval('window.__overview = true');
      await sleep(600);
      tiles[id] = await keep(`map-${id}.jpg`, await tv.grab());
      console.log(`  ${id}: ${(frames.length / 22).toFixed(0)} fps, best window at +${(win.from - frames[0].t).toFixed(1)} s`);
      await toLobby(tv);
    }
    if (want('hero')) await encodeClip(segments, 'gameplay.webp');
    if (want('maps')) {
      // One big tile and four small ones.
      const hs = 231, ws = 411, gap = 20, pad = 40, hb = hs * 2 + gap, wb = 858;
      let body = '';
      for (const [k, [id, name]] of MAPS.entries()) {
        const [x, y, w, h] = k === 0 ? [pad, pad, wb, hb] : [pad + wb + gap + ((k - 1) % 2) * (ws + gap), pad + Math.floor((k - 1) / 2) * (hs + gap), ws, hs];
        body += `<div class="tile${k === 0 ? ' big' : ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><img src="${await dataUri(tiles[id])}"><div class="tag">${name}</div></div>`;
      }
      await compose(studio, 'maps.jpg', pad * 2 + wb + gap * 2 + ws * 2, pad * 2 + hb, body);
    }
  }

  // ---------------------------------- people: phones join and play
  if (want('play') || want('join') || want('arabic')) {
    console.log('phones');
    tv = await tvTab(1920, 1080);
    await setTo(tv, 'mode', 'ctf');
    await setTo(tv, 'map', 'canyon');
    await setTo(tv, 'bots', 4);
    await setTo(tv, 'skill', 'normal');
    await setTo(tv, 'limit', 3);
    await setTo(tv, 'time', 10);
    // A family of four, all watching the TV with their phones as controllers.
    const people = [
      { en: 'Dad', ar: 'بابا', color: '#ffcc4d', team: 'red' },
      { en: 'Mom', ar: 'ماما', color: '#ff7ae0', team: 'blue' },
      { en: 'Ali', ar: 'علي', color: '#5dff8a', team: 'red' },
      { en: 'Sami', ar: 'سامي', color: '#7df9ff', team: 'blue' },
    ];
    const join = async (ph, i, lang) => {
      const p = people[i];
      await ph.size(390, 844, { mobile: true, scale: 2 });
      await ph.go(`${BASE}/favicon.svg`, 300);
      await ph.eval(`localStorage.setItem('cc_cid', 'media-${i}'); localStorage.setItem('cc_view', 'tv'); localStorage.setItem('cc_lang', '${lang}'); sessionStorage.clear(); true`);
      await ph.go(`${BASE}/play`, 1800);
      await ph.eval(`document.querySelector('#name').value = '${p[lang]}'; document.querySelector('[data-c="${p.color}"]').click(); true`);
      const shot = i === 0 ? await keep(`join-${lang}.jpg`, await ph.grab()) : null;
      await ph.eval(`document.querySelector('#joinBtn').click(); true`);
      await sleep(400);
      await ph.eval(`document.querySelector('.tp.${p.team}').click(); true`);
      await sleep(300);
      return shot;
    };
    const phones = [];
    for (let i = 0; i < people.length; i++) phones.push(await Tab.open());
    const lobbyShots = async (lang) => {
      await setTo(tv, 'lang', lang);
      const joined = [];
      for (let i = 0; i < people.length; i++) joined.push(await join(phones[i], i, lang));
      await sleep(1500);
      await tv.eval(`document.querySelector('#soundHint')?.classList.add('hidden'); true`);
      return { join: joined[0], phoneLobby: await keep(`phone-lobby-${lang}.jpg`, await phones[2].grab()), tvLobby: await keep(`tv-lobby-${lang}.jpg`, await tv.grab()) };
    };

    if (want('arabic')) {
      const ar = await lobbyShots('ar');
      await compose(studio, 'arabic.jpg', 1800, 860, `
        <div class="tv abs" style="left:50px;top:50px;width:1290px"><img src="${await dataUri(ar.tvLobby)}"></div>
        <div class="phone abs" style="left:1390px;top:40px;width:370px"><img src="${await dataUri(ar.join)}"></div>`);
    }

    const en = await lobbyShots('en');
    if (want('join')) {
      await compose(studio, 'join.jpg', 1800, 790, `
        <div class="tv abs" style="left:50px;top:120px;width:1060px"><img src="${await dataUri(en.tvLobby)}"></div>
        <div class="phone abs" style="left:1150px;top:110px;width:300px"><img src="${await dataUri(en.join)}"></div>
        <div class="phone abs" style="left:1480px;top:110px;width:300px"><img src="${await dataUri(en.phoneLobby)}"></div>
        <div class="step" style="left:60px;top:36px"><b>1</b>Scan the code on the TV</div>
        <div class="step" style="left:1150px;top:36px"><b>2</b>Name, color, team</div>`);
    }

    if (want('play')) {
      await tv.eval(`cc.send({ t: 'start' }); true`);
      await sleep(800);
      await tv.eval(`(${DIRECTOR})(950)`);
      for (const [j, ph] of phones.entries()) {
        await ph.size(844, 390, { mobile: true, scale: 2 });
        await sleep(700); // the controller rebuilds its sticks after a resize
        await ph.eval(`(${HOLD})(1, '#zoneL', 190, 260, ${j % 2 ? -40 : 60}, -45)`);
        await ph.eval(`(${HOLD})(2, '#zoneR', 650, 250, ${j % 2 ? -70 : 70}, -30)`);
      }
      await tv.send('Page.bringToFront');
      await sleep(9000);
      // Of a few TV pictures, keep the one with the most soldiers in view.
      let best = null;
      for (let k = 0; k < 10; k++) {
        const n = await tv.eval(`(() => {
          const c = cc.cam, hw = cc.renderer.cw / 2 / c.zoom * 0.9, hh = cc.renderer.ch / 2 / c.zoom * 0.85;
          return [...cc.world.players.values()].filter((p) => p.alive && Math.abs(p.x - c.x) < hw && Math.abs(p.y - c.y) < hh).length;
        })()`);
        if (!best || n > best.n) best = { n, jpg: await tv.grab() };
        await sleep(600);
      }
      const tvGame = await keep('tv-game.jpg', best.jpg);
      // Kids' controllers: thumbs down on both sticks.
      const pads = [];
      const alive = (j) => tv.eval(`[...cc.world.players.values()].some((p) => p.name === '${people[j].en}' && p.alive)`);
      for (const j of [2, 3]) {
        // A knocked-out soldier's phone shows a countdown, so wait and retry.
        let pad = null;
        let jpg = null;
        for (let k = 0; k < 6 && !pad; k++) {
          while (!(await alive(j))) await sleep(250);
          // Coming to the front rebuilds the sticks, so put the thumbs down after that.
          await phones[j].send('Page.bringToFront');
          await sleep(800);
          await phones[j].eval(`(${HOLD})(1, '#zoneL', 200, 250, ${j === 2 ? 55 : -50}, -40)`);
          await phones[j].eval(`(${HOLD})(2, '#zoneR', 640, 240, ${j === 2 ? 70 : -70}, -25)`);
          await sleep(250);
          jpg = await phones[j].grab(90, false);
          if (await alive(j)) pad = jpg;
        }
        pads.push(await keep(`controller-${j}.jpg`, pad || jpg));
      }
      await compose(studio, 'play.jpg', 1800, 1050, `
        <div class="tv stand abs" style="left:270px;top:40px;width:1260px"><img src="${await dataUri(tvGame)}"></div>
        <div class="phone wide abs" style="left:40px;top:640px;width:660px;transform:rotate(-4deg)"><img src="${await dataUri(pads[0])}"></div>
        <div class="phone wide abs" style="left:1100px;top:640px;width:660px;transform:rotate(4deg)"><img src="${await dataUri(pads[1])}"></div>`);
      await toLobby(tv);
    }
  }
} finally {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
process.exit(0); // the DevTools sockets would keep Node running

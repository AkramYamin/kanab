// Captures README screenshots with headless Chrome: one TV plus four phones
// that join, pick teams and play. Needs the game server running (npm start).
//
//   npm run screenshots
//   CHROME=/path/to/chrome BASE=http://localhost:3000 npm run screenshots
//   SHOT_LANG=ar OUT=docs/screenshots/ar npm run screenshots   (Arabic)
//   ONLY=weapons npm run screenshots                            (just the weapons scene)

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT ? new URL(`file://${path.resolve(process.env.OUT)}/`) : new URL('../docs/screenshots/', import.meta.url);
const LANG = process.env.SHOT_LANG || 'en';
const ONLY = process.env.ONLY || '';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fs.mkdir(OUT, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', 'about:blank',
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
    this.ws = new WebSocket(url, { perMessageDeflate: false });
    this.seq = 0;
    this.pending = new Map();
    this.ready = new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d);
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

  async size(width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
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

  async shot(name) {
    await this.send('Page.bringToFront');
    await sleep(500);
    const { data } = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    await fs.writeFile(new URL(name, OUT), Buffer.from(data, 'base64'));
    console.log('  saved ' + path.relative(process.cwd(), new URL(name, OUT).pathname));
  }
}

// A staged scene in the lobby's background game showing the special weapons:
// a frozen soldier, bees on their way, a hammer bonk and a black hole.
const WEAPONS_SCENE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('#lobby').classList.add('hidden');
  document.querySelector('#soundHint')?.classList.add('hidden');
  const g = cc.world;
  const P = [...g.players.values()];
  const put = (p, team, x, weapon, aim) => {
    Object.assign(p, { team, x, y: 1800, vx: 0, vy: 0, bot: null, prot: 0, hp: 100, weapon, ammo: 99, aim, alive: true });
    Object.assign(p.input, { mx: 0, my: 0, aiming: true, aim, fire: false });
  };
  // Glacier Keep's floor; teleporters sit at x 1560 and 1840, so stay clear of them.
  put(P[0], 'red', 880, 'freeze', -0.12);
  put(P[1], 'blue', 1080, 'blaster', Math.PI);
  put(P[2], 'red', 1230, 'hammer', 0);
  put(P[3], 'blue', 1600, 'shotgun', Math.PI);
  put(P[4], 'blue', 2200, 'bees', Math.PI + 0.45);
  put(P[5], 'red', 1480, 'rocket', -0.4);
  g.projectiles.push({ id: 99999, kind: 'hole', wkey: 'hole', owner: P[5].pid, team: 'red', x: 1700, y: 1690, vx: 0, vy: 0,
    life: 99, age: 0.9, gravity: 0, active: true });
  const keep = setInterval(() => {
    P[1].frozenT = 1.2;
    P[1].hp = P[3].hp = P[2].hp = P[0].hp = 100;
    P[0].input.fire = true;
    P[4].input.fire = true;
  }, 16);
  await wait(1300);
  P[3].x = 1300; P[3].vx = 0; P[3].vy = 0;
  P[2].input.fire = true;
  await wait(60);
  cc.renderer.bonk(P[3].x - 10, P[3].y - 40, cc.t('ft.bonk'));
  cc.renderer.freezeFx(P[1], cc.t('ft.frozen'));
  await wait(40);
  clearInterval(keep);
  g.step = () => {};
  cc.cam.ready = false; // snap the camera onto the scene
  return true;
})()`;

// Synthetic thumbs for the phone joysticks (nipplejs listens to pointer events).
const HOLD = `(id, zone, x0, y0, dx, dy) => {
  const el = document.querySelector(zone);
  const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y,
    bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1, buttons: 1 }));
  ev('pointerdown', x0, y0);
  for (let i = 1; i <= 8; i++) ev('pointermove', x0 + dx * i / 8, y0 + dy * i / 8);
}`;

try {
  const tv = await Tab.open();
  await tv.size(1920, 1080);
  await tv.go(`${BASE}/`, 2500);
  const set = async (key, times = 1) => {
    for (let i = 0; i < times; i++) await tv.eval(`cc.send({ t: 'set', key: '${key}', dir: 1 }); true`);
    await sleep(150);
  };
  const lobbyValue = (key) => tv.eval(`cc.lobby.settings.find((s) => s.key === '${key}').v`);
  // Known starting point: CTF, first map, 4 bots, normal, TV screen.
  while ((await lobbyValue('mode')) !== 'ctf') await set('mode');
  while ((await lobbyValue('map')) !== 'canyon') await set('map');
  while ((await lobbyValue('bots')) !== 4) await set('bots');
  while ((await lobbyValue('skill')) !== 'normal') await set('skill');
  while ((await tv.eval(`cc.lobby.settings.find((s) => s.key === 'screen').v`)) !== 'tv') await set('screen');
  while ((await tv.eval('cc.lobby.lang')) !== LANG) await set('lang');

  while ((await lobbyValue('map')) !== 'glacier') await set('map');
  await sleep(800);
  await tv.eval(WEAPONS_SCENE);
  await tv.shot('tv-weapons.jpg');
  if (ONLY !== 'weapons') {
    await tv.go(`${BASE}/`, 2500);
    while ((await lobbyValue('map')) !== 'canyon') await set('map');

    // Dad and Mom watch the game on their phones, the kids watch the TV.
    const people = LANG === 'ar'
      ? [['بابا', '#ffcc4d', 'red', 'phone'], ['ماما', '#ff7ae0', 'blue', 'phone'], ['علي', '#5dff8a', 'red', 'tv'], ['سامي', '#7df9ff', 'blue', 'tv']]
      : [['Dad', '#ffcc4d', 'red', 'phone'], ['Mom', '#ff7ae0', 'blue', 'phone'], ['Ali', '#5dff8a', 'red', 'tv'], ['Sami', '#7df9ff', 'blue', 'tv']];
    const phones = [];
    for (const [i, [name, color, team, watch]] of people.entries()) {
      const ph = await Tab.open();
      await ph.size(390, 844, true);
      await ph.go(`${BASE}/favicon.svg`, 300);
      await ph.eval(`localStorage.setItem('cc_cid', 'shot-${i}'); localStorage.setItem('cc_view', '${watch}'); sessionStorage.clear(); true`);
      await ph.go(`${BASE}/play`, 1800);
      await ph.eval(`document.querySelector('#name').value = '${name}'; document.querySelector('[data-c="${color}"]').click(); true`);
      if (i === 0) await ph.shot('phone-join.jpg');
      await ph.eval(`document.querySelector('#joinBtn').click(); true`);
      await sleep(400);
      await ph.eval(`document.querySelector('.tp.${team}').click(); true`);
      await sleep(300);
      phones.push(ph);
    }

    await sleep(1500);
    await tv.shot('tv-lobby.jpg');
    await phones[0].shot('phone-lobby.jpg');

    const maps = ['canyon', 'district', 'glacier', 'temple'];
    for (const [i, map] of maps.entries()) {
      if (i > 0) {
        await tv.eval(`cc.send({ t: 'lobby' }); true`);
        await sleep(600);
        await set('map');
      }
      await tv.eval(`cc.send({ t: 'start' }); true`);
      await sleep(800);
      for (const [j, ph] of phones.entries()) {
        await ph.size(844, 390, true);
        await sleep(700); // the controller rebuilds its sticks after a resize
        await ph.eval(`(${HOLD})(1, '#zoneL', 190, 260, ${j % 2 ? -40 : 60}, -45)`);
        await ph.eval(`(${HOLD})(2, '#zoneR', 650, 250, ${j % 2 ? -70 : 70}, -30)`);
      }
      await sleep(9000);
      await phones[0].send('Page.bringToFront');
      await sleep(600);
      const diag = await phones[0].eval(`(async () => {
        let n = 0; const t0 = performance.now();
        await Promise.race([
          new Promise((r) => { const f = () => (++n, performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
        const w = cc.world, me = w && w.players.get([...w.players.values()].find((p) => p.name === '${people[0][0]}')?.pid);
        return me ? { fps: n, alive: me.alive, server: [Math.round(me.sx), Math.round(me.sy)], shown: [Math.round(me.x), Math.round(me.y)], cam: [Math.round(cc.cam.x), Math.round(cc.cam.y)] } : null;
      })()`);
      console.log(`  ${map}: phone`, JSON.stringify(diag));
      await tv.shot(`tv-${map}.jpg`);
      await phones[0].shot(`phone-view-${map}.jpg`);
      if (i === 0) await phones[2].shot('phone-controller.jpg');
    }

    await tv.eval(`cc.send({ t: 'finish' }); true`);
    await sleep(3600);
    await tv.shot('tv-results.jpg');
    await phones[0].shot('phone-gameover.jpg');
  }
} finally {
  // Wait for Chrome to quit, or it is still writing into its profile folder.
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, sleep(5000)]);
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

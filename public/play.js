// Phone: controller, and optionally the game screen too.
// Left thumb: move (push up to jump, hold to jetpack). Right thumb: aim, and
// firing starts as soon as you drag. Joysticks come from nipplejs; each one
// appears wherever the thumb lands, so small hands never hunt for a button.
//
// "Watch on my phone": the phone draws the match with a camera that follows
// its own soldier. That soldier is moved by local prediction (the same
// physics the server runs), so it reacts instantly instead of waiting for
// Wi-Fi; the server's answer quietly corrects it a few times per second.

import { mapById } from './js/maps.js';
import { Game, PHYS, STEP, TEAM_COLOR } from './js/game.js';
import { World } from './js/world.js';
import { Renderer } from './js/render.js';
import { Camera, updateFollowCamera } from './js/camera.js';
import { playEvents } from './js/events.js';
import { audio } from './js/audio.js';
import { clamp } from './js/util.js';
import { t, setLang, getLang, applyStatic, settingText, FUN_NAMES } from './js/i18n.js';

const $ = (s) => document.querySelector(s);
const COLORS = ['#ffcc4d', '#5dff8a', '#ff7ae0', '#7df9ff', '#ff9f43', '#b28dff', '#ffffff', '#a3ff5c', '#ff6b6b', '#4dd4ff'];
const funName = () => {
  const list = FUN_NAMES[getLang()];
  return list[(Math.random() * list.length) | 0];
};

const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* ignore */ } },
};

let cid = store.get('cc_cid');
if (!cid) {
  cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set('cc_cid', cid);
}
let name = store.get('cc_name') || '';
let color = store.get('cc_color') || COLORS[(Math.random() * COLORS.length) | 0];
// Survive an accidental refresh: rejoin automatically in the same tab.
let joined = store.get('cc_joined', sessionStorage) === '1';
// Where this phone wants to watch: 'auto' follows the host's lobby setting.
let viewPref = store.get('cc_view') || 'auto';
// Language: 'auto' follows the host's lobby setting; a phone can override it.
let langPref = store.get('cc_lang') || 'auto';

let ws = null;
let pid = null;
let lobby = null;
let view = 'join';
let lastHud = null;
let rtt = 30;

// ------------------------------------------------------------------ network

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => send({ t: 'hello', role: 'phone', cid });
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  ws.onclose = (e) => {
    if (e.code === 4002) {
      showOffline(t('ph.otherTab'));
      return;
    }
    showOffline(t('ph.lost'));
    setTimeout(connect, 1000);
  };
}

function send(o) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      pid = m.pid;
      $('#offline').classList.add('hidden');
      joinReady = true;
      $('#joinNote').textContent = t('ph.ready');
      if (joined) sendJoin();
      syncView(true);
      break;
    case 'pong':
      rtt = performance.now() - m.ts;
      showPing(rtt);
      break;
    case 'lobby':
      lobby = m;
      applyLang();
      applyLobby();
      break;
    case 'match':
      startWorld(m);
      break;
    case 'roster':
      world?.setRoster(m.players);
      break;
    case 'snap':
      onSnap(m);
      break;
    case 'hud':
      applyHud(m);
      break;
    case 'vibe':
      if (navigator.vibrate) navigator.vibrate(m.p);
      break;
    case 'end':
      showOver(m);
      break;
  }
}

function sendJoin() {
  send({ t: 'join', name, color, team: 'auto' });
  // The server ignores anything sent before joining: tell it again now.
  sentView = null;
  syncView();
}

// Ping more often while drawing the game: the delay feeds the prediction.
let pingT = 0;
setInterval(() => {
  pingT++;
  if (phoneView || pingT % 4 === 0) send({ t: 'ping', ts: performance.now() });
}, 500);

function showPing(ms) {
  const el = $('#ping');
  el.textContent = `⚡ ${Math.round(ms)} ms`;
  el.classList.toggle('good', ms < 40);
}

function showOffline(msg) {
  $('#offlineMsg').textContent = msg;
  $('#offline').classList.remove('hidden');
}

// ----------------------------------------------------------------- language

let joinReady = false;
let langApplied = false;
const effectiveLang = () =>
  langPref !== 'auto' ? langPref : lobby?.lang || ((navigator.language || '').startsWith('ar') ? 'ar' : 'en');

function applyLang() {
  const changed = setLang(effectiveLang());
  if (!changed && langApplied) return;
  langApplied = true;
  applyStatic();
  if (joinReady) $('#joinNote').textContent = t('ph.ready');
  for (const b of document.querySelectorAll('#langpick button')) b.classList.toggle('on', b.dataset.lang === getLang());
  paintViewPick();
  if (lobby) applyLobby();
  if (lastHud) applyHud(lastHud, true);
}

$('#langpick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  langPref = b.dataset.lang;
  store.set('cc_lang', langPref);
  applyLang();
  buzz(10);
});

// -------------------------------------------------------------------- views

function setView(v) {
  if (view === v) return;
  view = v;
  for (const id of ['join', 'wait', 'pad', 'over']) $(`#${id}`).classList.toggle('hidden', id !== v);
  if (v === 'pad') {
    $('#padName').textContent = name;
    makeJoysticks();
  } else destroyJoysticks();
  syncView();
  checkRotate();
}

// Join screen
const nameInput = $('#name');
nameInput.value = name;
const swatches = $('#swatches');
swatches.innerHTML = COLORS.map((c) => `<button style="--c:${c}" data-c="${c}" aria-label="color"></button>`).join('');
function paintSwatches() {
  for (const b of swatches.children) b.classList.toggle('on', b.dataset.c === color);
  document.documentElement.style.setProperty('--me', color);
}
paintSwatches();
swatches.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  color = b.dataset.c;
  paintSwatches();
  buzz(10);
});
$('#dice').addEventListener('click', () => {
  nameInput.value = funName();
  buzz(10);
});
$('#joinBtn').addEventListener('click', () => {
  name = nameInput.value.trim().slice(0, 12) || funName();
  nameInput.value = name;
  store.set('cc_name', name);
  store.set('cc_color', color);
  joined = true;
  store.set('cc_joined', '1', sessionStorage);
  nameInput.blur();
  buzz(30);
  unlockAudio();
  goFullscreen();
  sendJoin();
  setView('wait');
});
$('#editBtn').addEventListener('click', () => {
  joined = false;
  store.set('cc_joined', '0', sessionStorage);
  setView('join');
});

function goFullscreen() {
  const el = document.documentElement;
  if (!el.requestFullscreen || document.fullscreenElement) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}

// Phone speakers: sound effects only (the TV does music and the announcer).
function unlockAudio() {
  audio.musicOn = false;
  audio.voiceOn = false;
  audio.falloff = 1.3;
  audio.unlock();
}

// Lobby
$('#teampick').addEventListener('click', (e) => {
  const b = e.target.closest('.tp');
  if (!b) return;
  send({ t: 'team', team: b.dataset.team });
  buzz(15);
});
$('#viewpick').addEventListener('click', (e) => {
  const b = e.target.closest('.vp');
  if (!b) return;
  setViewPref(b.dataset.view);
  buzz(15);
});
$('#setList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  send({ t: 'set', key: b.dataset.key });
  buzz(10);
});
$('#startBtn').addEventListener('click', () => {
  send({ t: 'start' });
  buzz(40);
  goFullscreen();
});
$('#againBtn').addEventListener('click', () => {
  send({ t: 'again' });
  buzz(30);
});
$('#toLobbyBtn').addEventListener('click', () => send({ t: 'lobby' }));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function applyLobby() {
  if (!lobby) return;
  const me = lobby.players.find((p) => p.pid === pid);
  const isCap = lobby.captain === pid;
  const ffa = lobby.mode === 'ffa';
  if (me) document.body.dataset.team = ffa ? 'ffa' : me.team;

  if (!joined) setView('join');
  else if (lobby.screen === 'game') setView('pad');
  else if (lobby.screen === 'results') setView('over');
  else setView('wait');

  const teamLabel = ffa ? t('ph.ffa') : me ? t('ph.teamLabel', { team: me.team }) : '';
  $('#me').innerHTML = `<div class="av"><i></i></div><div><h1>${esc(name)}</h1><p>${teamLabel}</p></div>`;
  $('#teampick').classList.toggle('hidden', ffa);
  for (const b of document.querySelectorAll('.tp')) b.classList.toggle('on', me?.team === b.dataset.team);
  paintViewPick();

  $('#capBox').classList.toggle('hidden', !isCap);
  if (isCap) {
    $('#setList').innerHTML = lobby.settings
      .map((s) => `<button data-key="${s.key}"><span>${esc(t(`set.${s.key}`))}</span><b>${esc(settingText(s))}</b></button>`)
      .join('');
  }
  const cap = lobby.players.find((p) => p.pid === lobby.captain);
  $('#waitMsg').textContent = isCap ? t('ph.capHint') : cap ? t('ph.waitCap', { name: cap.name }) : t('getReady');
  $('#overBtns').classList.toggle('hidden', !isCap);
  $('#overMsg').textContent = isCap ? '' : t('ph.captainNext');
  syncView();
}

function showOver(m) {
  $('#overTitle').textContent = t(`title.${m.title[0]}`, m.title[1]);
  $('#overTitle').style.color = m.color;
  $('#overSub').textContent = m.won ? t('ph.won') : m.title[0] === 'draw' ? t('ph.close') : t('ph.gg');
  $('#overStats').innerHTML = `
    <div><b>${m.k}</b><span>${t('ph.kos')}</span></div>
    <div><b>${m.d}</b><span>${t('ph.downs')}</span></div>
    ${m.c ? `<div><b>${m.c}</b><span>${t('ph.flags')}</span></div>` : ''}
    ${m.mvp ? `<div><b>⭐</b><span>${t('ph.mvp')}</span></div>` : ''}`;
  buzz(m.won ? [80, 60, 80, 60, 200] : [120]);
}

// ------------------------------------------------ watch on TV or on phone

const effectiveView = () => (viewPref === 'auto' ? lobby?.screenMode || 'tv' : viewPref);
let phoneView = false;
let sentView = null;

function setViewPref(v) {
  viewPref = v;
  store.set('cc_view', v);
  paintViewPick();
  syncView();
}

function paintViewPick() {
  const v = effectiveView();
  for (const b of document.querySelectorAll('.vp')) b.classList.toggle('on', b.dataset.view === v);
  $('#viewBtn').textContent = v === 'phone' ? '📺' : '📱';
  $('#viewBtn').title = v === 'phone' ? t('ph.viewTv') : t('ph.viewPhone');
}

function syncView(force = false) {
  const on = view === 'pad' && effectiveView() === 'phone';
  const key = `${on}:${viewPref}`;
  if (on !== phoneView) {
    phoneView = on;
    document.body.classList.toggle('phoneview', on);
    $('#view').classList.toggle('hidden', !on);
    $('#mini').classList.toggle('hidden', !on);
    if (on) startRender();
    else stopRender();
  }
  if (force || key !== sentView) {
    sentView = key;
    send({ t: 'view', on, pref: viewPref });
  }
}

$('#viewBtn').addEventListener('click', () => {
  setViewPref(effectiveView() === 'phone' ? 'tv' : 'phone');
  buzz(15);
});

// ------------------------------------------------------ phone game screen

let world = null;
let predGame = null;
let pred = null;
const corr = { x: 0, y: 0 };
let renderer = null;
const cam = new Camera();
let rafId = 0;
let predAcc = 0;
let miniBase = null;

function startWorld(m) {
  world = new World(mapById(m.map), m);
  world.localPid = pid;
  predGame = new Game(world.map, { mode: m.mode, scoreLimit: 99, timeLimit: 999 });
  pred = null;
  cam.ready = false;
  miniBase = null;
  $('#padFeed').innerHTML = '';
  if (renderer) renderer.setMap(world.map);
}

const predInput = { mx: 0, my: 0, aim: 0, aiming: false, fire: false, gren: 0 };

function predFrom(p) {
  return {
    pid: p.pid, team: p.team, chill: p.chill, frozenT: p.frozenT, iceProt: 0,
    x: p.sx, y: p.sy, vx: p.vx, vy: p.vy, w: PHYS.W, h: PHYS.H,
    onGround: p.onGround, onPlat: p.onPlat, airT: p.airT, jumpCd: p.jumpCd, jumpAge: p.jumpAge, dropT: p.dropT,
    fuel: p.fuel, fling: p.fling, teleLock: p.teleLock, jetting: p.jetting,
    aim: pred ? pred.aim : p.aim, facing: p.facing, weapon: p.weapon, powerT: p.powerT, input: predInput,
  };
}

// The server's answer is a little in the past: replay our recent input on
// top of it to get "now", then blend any difference away.
function onSnap(s) {
  if (!world) return;
  const events = world.apply(s, performance.now());
  const me = world.players.get(pid);
  predGame.projectiles = world.projectiles; // black holes pull us here too
  if (me && me.alive) {
    const srv = predFrom(me);
    const lag = clamp(Math.round(rtt / (STEP * 1000)) + 1, 0, 12);
    for (let i = 0; i < lag; i++) predGame.movePlayer(srv, STEP, world.phase === 'countdown');
    if (!pred || Math.hypot(srv.x - pred.x, srv.y - pred.y) > 170) {
      corr.x = 0;
      corr.y = 0;
    } else {
      corr.x += pred.x - srv.x;
      corr.y += pred.y - srv.y;
    }
    pred = srv;
  } else pred = null;
  if (phoneView && renderer) playEvents(events, world, renderer, audio, phoneUi);
}

function startRender() {
  if (!renderer) {
    renderer = new Renderer($('#view'), { maxDpr: 2, maxWidth: 2200, nameSize: 12, textScale: 0.75, vignette: 0.25 });
  }
  renderer.resize();
  if (world) renderer.setMap(world.map);
  cam.ready = false;
  cancelAnimationFrame(rafId);
  let last = performance.now();
  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!world) return;
    renderer.setMap(world.map);
    drawPhoneFrame(dt, now);
  };
  rafId = requestAnimationFrame(frame);
}

function stopRender() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  audio.setLoops(0, 0);
}

function drawPhoneFrame(dt, now) {
  world.update(dt, now);
  const me = world.players.get(pid);
  // Own soldier: run the physics locally with the current stick input.
  predInput.mx = input.mx;
  predInput.my = input.my;
  predInput.aiming = input.aiming;
  if (input.aiming) predInput.aim = Math.atan2(input.ay, input.ax);
  predInput.fire = input.fire;
  predGame.projectiles = world.projectiles;
  predAcc += dt;
  while (predAcc >= STEP) {
    if (pred) predGame.movePlayer(pred, STEP, world.phase === 'countdown');
    predAcc -= STEP;
  }
  const k = Math.exp(-dt * 10);
  corr.x *= k;
  corr.y *= k;
  if (me && pred && me.alive) {
    Object.assign(me, {
      x: pred.x + corr.x, y: pred.y + corr.y, vx: pred.vx, vy: pred.vy,
      onGround: pred.onGround, jetting: pred.jetting, aim: pred.aim, facing: pred.facing,
    });
  } else if (me) {
    me.x = me.sx;
    me.y = me.sy;
  }
  const focus = me || { x: world.map.W / 2, y: world.map.H / 2, aim: 0 };
  updateFollowCamera(cam, { x: focus.x, y: focus.y, aim: focus.aim, aiming: input.aiming }, world.map, renderer.cw, renderer.ch, dt);
  audio.listener = { x: cam.x, y: cam.y, halfW: renderer.cw / 2 / cam.zoom, halfH: renderer.ch / 2 / cam.zoom };
  let jet = 0;
  const near = (x) => Math.abs(x - cam.x) < renderer.cw / cam.zoom;
  for (const p of world.players.values()) {
    if (p.alive && p.jetting && near(p.x)) jet += p.pid === pid ? 1 : 0.4;
  }
  let bees = 0;
  let holes = 0;
  for (const b of world.projectiles) {
    if (b.kind === 'bee' && near(b.x)) bees++;
    else if (b.kind === 'hole' && b.active && near(b.x)) holes++;
  }
  audio.setLoops(jet, 0, bees, holes);
  renderer.frame(world, cam, dt, now / 1000, (ctx, R) => R.drawArrows(ctx, objectives(me)));
  drawMinimap(me);
}

// Where should I go? Arrows at the screen edge point the way.
function objectives(me) {
  const out = [];
  if (!me || !world.flags) return out;
  const mine = world.flags[me.team];
  const theirs = world.flags[me.team === 'red' ? 'blue' : 'red'];
  if (!mine || !theirs) return out;
  if (me.carrying) out.push({ x: mine.hx, y: mine.hy - 40, color: TEAM_COLOR[me.team], icon: '⌂' });
  else if (theirs.state !== 'carried' || theirs.carrier !== pid) out.push({ x: theirs.x, y: theirs.y - 40, color: TEAM_COLOR[theirs.team], icon: '⚑' });
  if (mine.state !== 'home') out.push({ x: mine.x, y: mine.y - 40, color: TEAM_COLOR[mine.team], icon: '!' });
  return out;
}

function drawMinimap(me) {
  const c = $('#mini');
  const map = world.map;
  const d = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(c.clientWidth * d);
  const h = Math.round(c.clientHeight * d);
  if (!w || !h) return;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    miniBase = null;
  }
  const s = Math.min(w / map.W, h / map.H);
  const ox = (w - map.W * s) / 2;
  const oy = (h - map.H * s) / 2;
  if (!miniBase) {
    miniBase = document.createElement('canvas');
    miniBase.width = w;
    miniBase.height = h;
    const g = miniBase.getContext('2d');
    g.fillStyle = 'rgba(8,10,24,0.55)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const b of map.solids) g.fillRect(ox + b.x * s, oy + b.y * s, Math.max(1, b.w * s), Math.max(1, b.h * s));
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (const p of map.plats) g.fillRect(ox + p.x * s, oy + p.y * s, Math.max(1, p.w * s), Math.max(1.5, 16 * s));
  }
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.drawImage(miniBase, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineWidth = d;
  const vw = renderer.cw / cam.zoom;
  const vh = renderer.ch / cam.zoom;
  g.strokeRect(ox + (cam.x - vw / 2) * s, oy + (cam.y - vh / 2) * s, vw * s, vh * s);
  if (world.flags) {
    for (const f of [world.flags.red, world.flags.blue]) {
      g.fillStyle = TEAM_COLOR[f.team];
      g.fillRect(ox + f.x * s - 2 * d, oy + (f.y - 60) * s - 3 * d, 4 * d, 6 * d);
    }
  }
  for (const p of world.players.values()) {
    if (!p.alive) continue;
    const self = p.pid === pid;
    g.fillStyle = self ? '#ffffff' : TEAM_COLOR[p.team] || p.color;
    g.beginPath();
    g.arc(ox + p.x * s, oy + (p.y - 30) * s, (self ? 3.2 : 2.2) * d, 0, Math.PI * 2);
    g.fill();
  }
}

const phoneUi = {
  get me() {
    return pid;
  },
  tick: (n) => {
    showPadBanner(String(n), 800);
    audio.tick(false);
  },
  go: () => {
    showPadBanner(t('go'), 800);
    audio.tick(true);
  },
  banner: (title) => showPadBanner(title, 2000),
  toast: (text, c) => addPadFeed(esc(text), c),
  feed: (k, v) => {
    if (!v) return;
    const nm = (p) => `<b style="color:${p.color}">${esc(p.name)}</b>`;
    addPadFeed(k ? `${nm(k)} ✦ ${nm(v)}` : `${nm(v)} ☠`);
  },
  fanfare: () => audio.fanfare(),
};

let padBannerT = 0;
let padBannerUntil = 0;
function showPadBanner(text, ms) {
  const el = $('#padBanner');
  el.textContent = text;
  el.classList.remove('hidden');
  padBannerUntil = performance.now() + ms;
  clearTimeout(padBannerT);
  padBannerT = setTimeout(() => {
    padBannerUntil = 0;
    applyHud(lastHud || {}, true);
  }, ms);
}

function addPadFeed(html, c) {
  const box = $('#padFeed');
  const el = document.createElement('div');
  el.innerHTML = html;
  if (c) el.style.color = c;
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.remove(), 4000);
}

// -------------------------------------------------------------- joysticks

const input = { mx: 0, my: 0, ax: 0, ay: 0, aiming: false, fire: false, gren: 0 };
let joyL = null;
let joyR = null;
let lastSend = 0;
let pending = false;

const q = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
function sendInput() {
  pending = false;
  lastSend = performance.now();
  if (!ws || ws.readyState !== 1) return;
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  b[0] = 1;
  dv.setInt8(1, q(input.mx));
  dv.setInt8(2, q(input.my));
  dv.setInt8(3, q(input.ax));
  dv.setInt8(4, q(input.ay));
  b[5] = (input.fire ? 1 : 0) | (input.aiming ? 2 : 0);
  b[6] = input.gren & 255;
  ws.send(b);
}
// Send right away, but never more than one packet per ~12 ms.
function push() {
  const wait = 12 - (performance.now() - lastSend);
  if (wait <= 0) sendInput();
  else if (!pending) {
    pending = true;
    setTimeout(sendInput, wait);
  }
}
setInterval(() => {
  if (view === 'pad') sendInput();
}, 100);

function makeJoysticks() {
  destroyJoysticks();
  const size = Math.max(110, Math.min(170, Math.round(Math.min(innerWidth, innerHeight) * 0.42)));
  const teamColor = getComputedStyle(document.body).getPropertyValue('--team').trim() || '#ffcc4d';
  const opts = (zone, c) => ({
    zone, mode: 'dynamic', color: c, size, threshold: 0.05, fadeTime: 90,
    multitouch: false, maxNumberOfNipples: 1, restOpacity: 0.7, follow: true, dynamicPage: true,
  });
  const zl = $('#zoneL');
  const zr = $('#zoneR');
  joyL = nipplejs.create(opts(zl, '#ffffff'));
  joyR = nipplejs.create(opts(zr, teamColor));

  joyL.on('start', () => zl.classList.add('active', 'used'));
  joyL.on('move', (e, d) => {
    input.mx = d.vector.x;
    input.my = -d.vector.y;
    push();
  });
  joyL.on('end', () => {
    input.mx = 0;
    input.my = 0;
    zl.classList.remove('active');
    push();
  });

  joyR.on('start', () => zr.classList.add('active', 'used'));
  joyR.on('move', (e, d) => {
    const force = Math.min(1, d.force);
    input.ax = d.vector.x;
    input.ay = -d.vector.y;
    input.aiming = force > 0.12;
    input.fire = force > 0.3;
    push();
  });
  joyR.on('end', () => {
    input.fire = false;
    input.aiming = false;
    zr.classList.remove('active');
    push();
  });
}

function destroyJoysticks() {
  joyL?.destroy();
  joyR?.destroy();
  joyL = joyR = null;
  Object.assign(input, { mx: 0, my: 0, fire: false, aiming: false });
  $('#zoneL').classList.remove('active');
  $('#zoneR').classList.remove('active');
}

const grenBtn = $('#grenBtn');
const throwGrenade = (e) => {
  e.preventDefault();
  e.stopPropagation();
  input.gren = (input.gren + 1) & 255;
  sendInput();
  buzz(20);
  grenBtn.classList.add('press');
  setTimeout(() => grenBtn.classList.remove('press'), 120);
};
grenBtn.addEventListener('touchstart', throwGrenade, { passive: false });
grenBtn.addEventListener('mousedown', throwGrenade);

// -------------------------------------------------------------------- HUD

function applyHud(m, force = false) {
  const p = force ? {} : lastHud || {};
  lastHud = m;
  if (m.hp === undefined) return;
  if (m.hp !== p.hp) {
    const fill = $('#hpFill');
    fill.style.width = `${m.hp}%`;
    fill.className = m.hp > 60 ? '' : m.hp > 30 ? 'mid' : 'low';
    $('#hpNum').textContent = m.hp;
  }
  if (m.w !== p.w) $('#wName').textContent = t(`w.${m.w}`);
  if (m.a !== p.a) $('#wAmmo').textContent = m.a < 0 ? '∞' : m.a;
  if (m.g !== p.g || m.h !== p.h) {
    // Black holes (from the swirl pickup) are thrown before normal grenades.
    const hole = m.h > 0;
    $('#grenNum').textContent = hole ? m.h : m.g;
    grenBtn.querySelector('span').textContent = hole ? '◎' : '✹';
    grenBtn.classList.toggle('hole', hole);
    grenBtn.classList.toggle('empty', !hole && m.g === 0);
  }
  if (m.f !== p.f) $('#fuelFill').style.width = `${m.f * 10}%`;
  $('#dead').classList.toggle('hidden', m.al === 1);
  if (!m.al) $('#respawnIn').textContent = m.rs;
  // Stick colors follow --team through CSS, so no need to rebuild them.
  if (m.tm !== p.tm) document.body.dataset.team = m.tm;
  const time = `${Math.floor(m.tl / 60)}:${String(m.tl % 60).padStart(2, '0')}`;
  if (m.sc) {
    const mine = (t) => (m.tm === t ? 'mine' : '');
    $('#score').innerHTML = `<span class="r ${mine('red')}">${m.sc[0]}</span><small>:</small><span class="b ${mine('blue')}">${m.sc[1]}</span><em>${time}</em>`;
  } else {
    $('#score').innerHTML = `<small>${t('ph.kosShort')}</small>${m.k}<em>${time}</em>`;
  }
  if (padBannerUntil > performance.now()) return;
  const bannerEl = $('#padBanner');
  const msg = m.ph === 'countdown' ? t('ph.readyDots') : m.fz ? t('ph.frozen') : m.fl ? t('ph.flagHome') : m.pw ? t('ph.power') : '';
  bannerEl.textContent = msg;
  bannerEl.classList.toggle('hidden', !msg);
}

// ------------------------------------------------------------- phone care

function buzz(p) {
  if (navigator.vibrate) navigator.vibrate(p);
}

function checkRotate() {
  const portrait = innerHeight > innerWidth;
  $('#rotate').classList.toggle('hidden', !(view === 'pad' && portrait));
}
let resizeT = null;
addEventListener('resize', () => {
  checkRotate();
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (view === 'pad') makeJoysticks();
    miniBase = null;
  }, 250);
});

// No pinch-zoom, double-tap zoom, text selection or pull-to-refresh mid-game.
document.addEventListener('touchmove', (e) => {
  if (view === 'pad') e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerdown', () => audio.ctx && audio.unlock(), { passive: true });

applyLang();
paintViewPick();
if (joined) {
  setView('wait');
  unlockAudio();
}
connect();

window.cc = { get world() { return world; }, get pred() { return pred; }, cam, get renderer() { return renderer; }, setViewPref };

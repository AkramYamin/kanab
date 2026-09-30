// TV / laptop screen. The match runs on the server; this page draws it with a
// camera that zooms to keep every player in view, plays the sound, shows the
// lobby and HUD, and lets the laptop keyboard join as a player.

import { mapById } from './maps.js';
import { Game, PHYS, STEP, TEAM_COLOR } from './game.js';
import { makeBot, BOT_NAMES, BOT_NAMES_AR } from './bots.js';
import { WEAPON_ICON } from './weapons.js';
import { Renderer } from './render.js';
import { World } from './world.js';
import { Camera, updateTVCamera } from './camera.js';
import { playEvents, demoHooks } from './events.js';
import { audio } from './audio.js';
import { escapeHtml } from './util.js';
import { t, setLang, getLang, applyStatic, settingText } from './i18n.js';

const $ = (s) => document.querySelector(s);
const KB_PID = 900;
const DEMO_COLORS = ['#ffcc4d', '#5dff8a', '#ff7ae0', '#7df9ff', '#ff9f43', '#b28dff'];

const renderer = new Renderer($('#game'));
const cam = new Camera();
let lobby = null;
let screen = 'lobby';
let world = null;
let demo = null;
let ws = null;
let resultsTimer = null;

// ------------------------------------------------------------------- net

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    send({ t: 'hello', role: 'screen' });
    $('#netStatus').classList.remove('show');
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    onMessage(m);
  };
  ws.onclose = () => {
    $('#netStatus').textContent = t('reconnecting');
    $('#netStatus').classList.add('show');
    setTimeout(connect, 1000);
  };
}

function send(o) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(o));
}

function onMessage(m) {
  switch (m.t) {
    case 'lobby': {
      lobby = m;
      const changed = setLang(m.lang);
      if (changed || !langReady) applyLanguage(changed);
      renderLobby();
      setScreen(m.screen);
      break;
    }
    case 'match':
      startWorld(m);
      break;
    case 'roster':
      world?.setRoster(m.players);
      break;
    case 'snap':
      if (world) playEvents(world.apply(m, performance.now()), world, renderer, audio, ui);
      break;
    case 'results':
      showResults(m);
      break;
    case 'joined':
      audio.join();
      toast(t('joined', { name: m.name }), m.color);
      break;
    case 'toast':
      toast(t(m.key), m.color);
      break;
  }
}

// Language comes from the lobby setting and applies to every screen.
let langReady = false;
function applyLanguage(changed) {
  langReady = true;
  applyStatic();
  audio.setLang(getLang());
  if (changed && screen === 'lobby') {
    demo = null;
    startDemo();
  }
  // Voices load a moment after the page; warn if there is none for Arabic.
  if (getLang() === 'ar') setTimeout(() => !audio.hasVoice && toast(t('noVoice'), '#ffcc4d'), 1500);
}

// ----------------------------------------------------------- lobby & demo

function setScreen(s) {
  if (s === screen && (s !== 'lobby' || demo)) return;
  screen = s;
  $('#lobby').classList.toggle('hidden', s !== 'lobby');
  $('#hud').classList.toggle('hidden', s === 'lobby');
  $('#results').classList.toggle('hidden', s !== 'results');
  if (s === 'lobby') {
    world = null;
    clearTimeout(resultsTimer);
    startDemo();
  } else demo = null;
}

// Attract mode: bots playing quietly behind the lobby.
function startDemo() {
  const map = mapById(lobby?.map);
  if (demo && demo.map === map) return;
  demo = new Game(map, { mode: 'ctf', scoreLimit: 3, timeLimit: Infinity, aimAssist: false, demo: true }, demoHooks(renderer));
  const names = getLang() === 'ar' ? BOT_NAMES_AR : BOT_NAMES;
  for (let i = 0; i < 6; i++) {
    demo.addPlayer({
      pid: 500 + i, name: names[i + 8], color: DEMO_COLORS[i], team: i % 2 ? 'blue' : 'red',
      bot: makeBot('normal', i < 2 ? 'defend' : 'attack'),
    });
  }
  renderer.setMap(map);
  cam.ready = false;
}

function renderLobby() {
  const L = lobby;
  const ffa = L.mode === 'ffa';
  const viewIcon = (p) => (p.kb ? '⌨︎' : p.view === 'phone' || (p.view !== 'tv' && L.screenMode === 'phone') ? '📱' : '📺');
  const card = (p) => `
    <li class="pcard ${p.on ? '' : 'away'}" style="--c:${p.color}">
      <span class="avatar"><i></i></span>
      <span class="nm">${escapeHtml(p.name)}</span>
      ${p.pid === L.captain ? '<span class="tag cap" title="Captain">👑</span>' : ''}
      <span class="tag view" title="Where they watch">${viewIcon(p)}</span>
    </li>`;
  const botCards = (n) =>
    Array.from({ length: n }, () => `<li class="pcard bot"><span class="avatar"><i></i></span><span class="nm">${t('bot')}</span></li>`).join('');
  const empty = `<li class="empty">${t('emptyTeam')}</li>`;
  if (ffa) {
    $('#teams').innerHTML = `<div class="team ffa"><h2>${t('ffaTitle')}</h2>
      <ul>${L.players.map(card).join('') + botCards(L.bots) || empty}</ul></div>`;
  } else {
    const col = (team) => {
      const list = L.players.filter((p) => p.team === team);
      return `<div class="team ${team}">
        <h2><span>${t(`${team}Team`)}</span><b>${list.length + L.botSplit[team]}</b></h2>
        <ul>${list.map(card).join('') + botCards(L.botSplit[team]) || empty}</ul></div>`;
    };
    $('#teams').innerHTML = `${col('red')}<div class="vs">${t('vs')}</div>${col('blue')}`;
  }
  $('#settings').innerHTML = L.settings
    .map((s) => `<button class="pill" data-key="${s.key}"><span>${t(`set.${s.key}`)}</span><b>${escapeHtml(settingText(s))}</b></button>`)
    .join('');
  const cap = L.players.find((p) => p.pid === L.captain);
  $('#captain').innerHTML = cap
    ? t('captainLine', { name: `<b style="color:${cap.color}">${escapeHtml(cap.name)}</b>` })
    : L.players.length
      ? t('pressEnter')
      : t('waitingPlayers');
  $('#startBtn').disabled = !L.canStart;
  if (screen === 'lobby') startDemo();
}

$('#settings').addEventListener('click', (e) => {
  const b = e.target.closest('.pill');
  if (!b) return;
  audio.ui();
  send({ t: 'set', key: b.dataset.key, dir: 1 });
});
$('#settings').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.pill');
  if (!b) return;
  e.preventDefault();
  send({ t: 'set', key: b.dataset.key, dir: -1 });
});
$('#startBtn').addEventListener('click', () => send({ t: 'start' }));
$('#againBtn').addEventListener('click', () => send({ t: 'start' }));
$('#lobbyBtn').addEventListener('click', () => send({ t: 'lobby' }));
$('#fsBtn').addEventListener('click', toggleFullscreen);
$('#langBtn').addEventListener('click', () => send({ t: 'set', key: 'lang', dir: 1 }));
$('#musicBtn').addEventListener('click', toggleMusic);

async function loadInfo() {
  try {
    const info = await (await fetch('/api/info')).json();
    $('#qr').innerHTML = info.qr;
    $('#qrSmall').innerHTML = info.qr;
    $('#joinUrl').textContent = info.joinUrl.replace(/^http:\/\//, '');
  } catch {
    setTimeout(loadInfo, 1500);
  }
}

// ----------------------------------------------------------------- match

function startWorld(m) {
  world = new World(mapById(m.map), m);
  renderer.setMap(world.map);
  cam.ready = false;
  clearTimeout(resultsTimer);
  $('#feed').innerHTML = '';
  $('#goal').textContent = t('goal', { n: m.limit, unit: m.unit });
  $('#scorebar').classList.toggle('ffa', m.mode === 'ffa');
  $('#scorebar').classList.toggle('noflags', m.mode !== 'ctf');
  $('#ffaBoard').classList.toggle('hidden', m.mode !== 'ffa');
  $('#results').classList.add('hidden');
}

const ui = {
  tick: (n) => {
    banner(String(n), t('getReady'), '#ffffff', 900, 'count');
    audio.tick(false);
  },
  go: () => {
    banner(t('go'), '', '#ffcc4d', 900, 'count');
    audio.tick(true);
    audio.say(t('say.fight'), true);
  },
  say: (text, urgent) => audio.say(text, urgent),
  toast: (text, color) => toast(text, color),
  banner: (title, sub, color, ms, kind) => banner(title, escapeHtml(sub), color, ms, kind),
  feed: (k, v, w) => v && addFeed(k, v, w),
  fanfare: () => audio.fanfare(),
};

function showResults(m) {
  $('#winTitle').textContent = t(`title.${m.title[0]}`, m.title[1]);
  $('#winTitle').style.color = m.color;
  $('#finalScore').innerHTML = m.score ? `<span class="r">${m.score[0]}</span><i>:</i><span class="b">${m.score[1]}</span>` : '';
  $('#table').innerHTML = `<thead><tr><th></th><th>${t('th.player')}</th>${m.flags ? `<th>${t('th.flags')}</th>` : ''}<th>${t('th.kos')}</th><th>${t('th.downs')}</th></tr></thead><tbody>${m.rows
    .map(
      ([name, color, team, bot, caps, kills, deaths, mvp]) => `<tr class="${team}">
        <td class="star">${mvp ? '⭐' : ''}</td>
        <td><span class="dotc" style="background:${color}"></span>${bot ? '🤖 ' : ''}${escapeHtml(name)}</td>
        ${m.flags ? `<td>${caps}</td>` : ''}<td>${kills}</td><td>${deaths}</td></tr>`,
    )
    .join('')}</tbody>`;
  $('#results').classList.remove('hidden');
  let left = 30;
  clearTimeout(resultsTimer);
  const tick = () => {
    $('#autoBack').textContent = t('backIn', { n: left });
    if (left-- > 0) resultsTimer = setTimeout(tick, 1000);
  };
  tick();
}

// ------------------------------------------------------------------- HUD

const domCache = {};
function setText(id, v) {
  if (domCache[id] === v) return;
  domCache[id] = v;
  document.getElementById(id).textContent = v;
}
function setClass(id, v) {
  const key = `${id}.class`;
  if (domCache[key] === v) return;
  domCache[key] = v;
  document.getElementById(id).className = v;
}

function updateHud() {
  const w = world;
  setText('scRed', String(w.score.red));
  setText('scBlue', String(w.score.blue));
  const t = w.timeLeft;
  setText('timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  setClass('timer', t <= 30 && w.phase === 'playing' ? 'timer hurry' : 'timer');
  if (w.flags) {
    setClass('flagRed', `flagico ${w.flags.red.state}`);
    setClass('flagBlue', `flagico ${w.flags.blue.state}`);
  }
  if (!w.teamMode) {
    const top = [...w.players.values()].sort((a, b) => (b.kills || 0) - (a.kills || 0)).slice(0, 3);
    const html = top
      .map((p, i) => `<div class="row"><b>${i + 1}</b><span style="color:${p.color}">${escapeHtml(p.name)}</span><i>${p.kills || 0}</i></div>`)
      .join('');
    if (domCache.ffa !== html) {
      domCache.ffa = html;
      $('#ffaBoard').innerHTML = html;
    }
  }
}

function addFeed(k, v, w) {
  const feed = $('#feed');
  const el = document.createElement('div');
  el.className = 'kf';
  const name = (p) => `<b style="color:${p.color}">${escapeHtml(p.name)}</b>`;
  el.innerHTML = k
    ? `${name(k)}<span class="wi" title="${w}">${WEAPON_ICON[w] || '✦'}</span>${name(v)}`
    : `${name(v)}<span class="wi">☠</span><em>${t('oops')}</em>`;
  feed.prepend(el);
  while (feed.children.length > 6) feed.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 5500);
  setTimeout(() => el.remove(), 6200);
}

let bannerTimer = null;
function banner(title, sub, color, ms = 1500, kind = '') {
  const el = $('#banner');
  el.className = '';
  void el.offsetWidth; // restart the animation
  el.className = `show ${kind}`;
  el.innerHTML = `<div class="bt" style="color:${color}">${escapeHtml(title)}</div>${sub ? `<div class="bs">${sub}</div>` : ''}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (el.className = ''), ms);
}

function toast(text, color = '#ffffff') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', color);
  el.textContent = text;
  const box = $('#toasts');
  box.classList.toggle('ingame', screen !== 'lobby');
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3200);
}

// ------------------------------------------------- keyboard + mouse player

const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
let kbGren = 0;
let kbLast = 0;

function sendKeyboardInput(now) {
  if (!lobby?.players.some((p) => p.kb) || now - kbLast < 15) return;
  kbLast = now;
  const k = (...codes) => codes.some((c) => keys.has(c));
  const mx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  const my = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp', 'Space') ? 1 : 0);
  let ax = 0;
  let ay = 0;
  const p = world?.players.get(KB_PID);
  if (p) {
    const d = renderer.dpr;
    const wx = (mouse.x * d - renderer.cw / 2) / cam.zoom + cam.x;
    const wy = (mouse.y * d - renderer.ch / 2) / cam.zoom + cam.y;
    const a = Math.atan2(wy - (p.y - PHYS.SHOULDER), wx - p.x);
    ax = Math.cos(a);
    ay = Math.sin(a);
  }
  const q = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  b[0] = 1;
  dv.setInt8(1, q(mx));
  dv.setInt8(2, q(my));
  dv.setInt8(3, q(ax));
  dv.setInt8(4, q(ay));
  b[5] = (mouse.down ? 1 : 0) | (p ? 2 : 0);
  b[6] = kbGren & 255;
  if (ws?.readyState === 1) ws.send(b);
}

addEventListener('keydown', (e) => {
  audio.unlock();
  keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'Enter':
      if (screen !== 'game') send({ t: 'start' });
      break;
    case 'Escape':
      if (screen !== 'lobby') send({ t: 'lobby' });
      break;
    case 'KeyM':
      toggleMusic();
      break;
    case 'KeyF':
      toggleFullscreen();
      break;
    case 'KeyV':
      audio.voiceOn = !audio.voiceOn;
      toast(t(audio.voiceOn ? 'voiceOn' : 'voiceOff'));
      break;
    case 'KeyK':
      send({ t: 'kb' });
      toast(t('kbHint'));
      break;
    case 'KeyG':
      kbGren++;
      break;
    case 'KeyL':
      send({ t: 'set', key: 'lang', dir: 1 });
      break;
    case 'KeyE':
      if (screen === 'game') send({ t: 'finish' });
      break;
  }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
$('#game').addEventListener('pointerdown', (e) => {
  if (e.button === 0) mouse.down = true;
  if (e.button === 2) kbGren++;
});
addEventListener('pointerup', () => (mouse.down = false));
addEventListener('contextmenu', (e) => {
  if (screen !== 'lobby') e.preventDefault();
});
addEventListener('pointerdown', () => {
  audio.unlock();
  setTimeout(() => $('#soundHint').classList.toggle('hidden', audio.ready), 200);
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function toggleMusic() {
  audio.unlock();
  audio.setMusic(!audio.musicOn);
  $('#musicBtn').classList.toggle('off', !audio.musicOn);
  toast(t(audio.musicOn ? 'musicOn' : 'musicOff'));
}

// ------------------------------------------------------------------ loop

let last = performance.now();
let acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (world && screen !== 'lobby') {
    world.update(dt, now);
    updateTVCamera(cam, world, renderer.cw, renderer.ch, dt);
    audio.listener = { x: cam.x, y: cam.y, halfW: renderer.cw / 2 / cam.zoom, halfH: renderer.ch / 2 / cam.zoom };
    renderer.frame(world, cam, dt, t);
    updateHud();
    sendKeyboardInput(now);
    let jet = 0;
    for (const p of world.players.values()) if (p.alive && p.jetting) jet++;
    const flames = world.projectiles.reduce((n, b) => n + (b.kind === 'flame' && b.age < 0.1 ? 1 : 0), 0);
    audio.setLoops(jet, Math.min(3, flames / 2));
  } else if (demo) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      demo.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 4) acc = 0;
    updateTVCamera(cam, demo, renderer.cw, renderer.ch, dt);
    renderer.frame(demo, cam, dt, t);
    audio.setLoops(0, 0);
  }
}

$('#soundHint').classList.toggle('hidden', audio.ready);
$('#musicBtn').classList.toggle('off', !audio.musicOn);
loadInfo();
connect();
requestAnimationFrame(loop);

// Handy for debugging from the console (and the screenshot script).
window.cc = {
  get world() { return world || demo; },
  renderer, cam, send,
  get lobby() { return lobby; },
};

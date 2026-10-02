// The game host: lobby, settings, match flow and the authoritative
// simulation. Runs inside the Node server so the match keeps going no matter
// which screens are open. Screens (TV/laptop) and phones that show the game
// receive snapshots; every phone receives its own HUD and vibrations.

import fs from 'node:fs';
import path from 'node:path';
import { MAPS } from '../public/js/maps.js';
import { Game, TEAM_COLOR, STEP, blankInput } from '../public/js/game.js';
import { makeBot, BOT_NAMES, BOT_NAMES_AR, SKILL } from '../public/js/bots.js';
import { WEAPONS, TOGGLES } from '../public/js/weapons.js';
import { encodeSnapshot } from '../public/js/protocol.js';

const MODE_ORDER = ['ctf', 'tdm', 'ffa'];
const LIMITS = { ctf: [3, 5, 10], tdm: [15, 25, 40], ffa: [10, 15, 25] };
const LIMIT_UNIT = { ctf: 'captures', tdm: 'kills', ffa: 'kills' };
const SKILLS = ['easy', 'normal', 'hard'];
const TIMES = [5, 10, 15];
const BOT_COLORS = ['#ffcc4d', '#5dff8a', '#ff7ae0', '#7df9ff', '#ff9f43', '#b28dff', '#a3ff5c', '#ffffff'];
export const KB_PID = 900;
const BOT_PID = 1000;
const DEFAULTS = { mode: 'ctf', map: 0, bots: 2, skill: 'easy', limit: 0, time: 1, assist: true, screen: 'tv', lang: 'en', voice: 'announcer', off: [] };
// Settings that only change what screens say or show, so they can change mid-match.
const LIVE_SETTINGS = ['lang', 'voice'];

export class Host {
  // net: { phone(pid, str), phones(str), screens(str), hasScreens() }
  constructor(net, settingsFile, voicesDir, familyDir) {
    this.net = net;
    this.settingsFile = settingsFile;
    this.voicesDir = voicesDir;
    this.familyDir = familyDir;
    this.packs = this.voicePacks();
    this.settings = { ...DEFAULTS, ...this.loadSettings() };
    if (!(this.settings.map >= 0 && this.settings.map < MAPS.length)) this.settings.map = 0;
    if (!Array.isArray(this.settings.off)) this.settings.off = [];
    this.settings.off = this.settings.off.filter((k) => TOGGLES.includes(k));
    this.lobby = new Map(); // pid -> { pid, name, color, team, connected, joinedAt, leftAt, keyboard, view }
    this.inputs = new Map(); // pid -> input object shared with the Game player
    this.viewers = new Set(); // phones that show the game themselves
    this.screen = 'lobby'; // lobby | game | results
    this.game = null;
    this.tick = 0;
    this.events = [];
    this.phoneEvents = [];
    this.hudCache = new Map();
    this.lastVibe = new Map();
    this.loop = null;
    this.timers = [];
    this.results = null;
    setInterval(() => this.cleanup(), 1000);
  }

  // ---------------------------------------------------------------- utils

  loadSettings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  saveSettings() {
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings));
    } catch {
      /* read-only folder: settings just won't persist */
    }
  }

  // Announcer voice packs: folders in public/voices with a manifest.json
  // (made by `npm run voices`). The built-in "announcer" pack comes first.
  voicePacks() {
    let ids = [];
    try {
      ids = fs.readdirSync(this.voicesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    ids.sort((a, b) => (a === 'announcer' ? -1 : b === 'announcer' ? 1 : a.localeCompare(b)));
    const packs = [];
    for (const id of ids) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(this.voicesDir, id, 'manifest.json'), 'utf8'));
        packs.push({ id, label: m.name || { en: id } });
      } catch {
        /* not a voice pack */
      }
    }
    return packs;
  }

  // Family touches kept off GitHub (public/family/family.json): team names, a
  // background picture and announcer lines that say the names. Read whenever
  // they are needed (it's tiny), so edits show up without a restart.
  family() {
    let conf;
    try {
      conf = JSON.parse(fs.readFileSync(path.join(this.familyDir, 'family.json'), 'utf8'));
    } catch {
      return null;
    }
    const clean = (v) => String(v ?? '').replace(/[<>&"']/g, '').trim().slice(0, 20);
    const team = (t) => (t && clean(t.en) ? { en: clean(t.en), ar: clean(t.ar) || clean(t.en) } : null);
    const red = team(conf.teams?.red);
    const blue = team(conf.teams?.blue);
    const out = { teams: red && blue ? { red, blue } : null, bg: null, voices: [] };
    const bg = path.basename(String(conf.background || 'background.jpg'));
    try {
      out.bg = `/family/${encodeURIComponent(bg)}?v=${Math.round(fs.statSync(path.join(this.familyDir, bg)).mtimeMs)}`;
    } catch {
      /* no picture yet */
    }
    try {
      for (const d of fs.readdirSync(path.join(this.familyDir, 'voices'), { withFileTypes: true })) {
        if (d.isDirectory() && fs.existsSync(path.join(this.familyDir, 'voices', d.name, 'manifest.json'))) out.voices.push(d.name);
      }
    } catch {
      /* no family voices */
    }
    return out;
  }

  voiceNow() {
    const v = this.settings.voice;
    return this.packs.some((p) => p.id === v) ? v : 'system';
  }

  toPhone(pid, obj) {
    this.net.phone(pid, typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  toEveryone(obj) {
    const str = JSON.stringify(obj);
    this.net.screens(str);
    this.net.phones(str);
  }

  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  ev(...a) {
    this.events.push(a);
  }

  // ---------------------------------------------------------- connections

  phoneJoined(pid, { name, color, team }) {
    let pl = this.lobby.get(pid);
    const fresh = !pl;
    if (!pl) {
      pl = { pid, joinedAt: performance.now(), team: null, view: 'auto' };
      this.lobby.set(pid, pl);
    }
    pl.name = name;
    pl.color = color;
    pl.connected = true;
    pl.leftAt = 0;
    if (team === 'red' || team === 'blue') pl.team = team;
    else if (!pl.team) pl.team = this.autoTeam(pid);
    if (!this.inputs.has(pid)) this.inputs.set(pid, blankInput());
    if (fresh) this.net.screens(JSON.stringify({ t: 'joined', name, color }));
    if (this.game && this.screen !== 'lobby') {
      const p = this.game.players.get(pid);
      if (p) {
        p.name = name;
        p.color = color;
        p.disconnected = false;
      } else this.addHuman(pl);
      this.sendRoster();
      this.toPhone(pid, this.matchMsg);
    }
    this.refreshLobby();
  }

  phoneLeft(pid) {
    const pl = this.lobby.get(pid);
    this.viewers.delete(pid);
    if (!pl) return;
    pl.connected = false;
    pl.leftAt = performance.now();
    Object.assign(this.inputs.get(pid) || {}, { mx: 0, my: 0, fire: false });
    this.refreshLobby();
  }

  phoneMessage(pid, m) {
    const pl = this.lobby.get(pid);
    const cap = this.captainPid();
    switch (m.t) {
      case 'team':
        if (pl && (m.team === 'red' || m.team === 'blue') && this.screen === 'lobby') {
          pl.team = m.team;
          this.refreshLobby();
        }
        break;
      case 'set':
        if (pid === cap && (this.screen === 'lobby' || LIVE_SETTINGS.includes(m.key))) this.changeSetting(m.key, 1);
        break;
      case 'weapon':
        if (pid === cap && this.screen === 'lobby') this.toggleWeapon(m.key);
        break;
      case 'start':
        if (pid === cap && this.screen === 'lobby') this.startMatch();
        break;
      case 'again':
        if (pid === cap && this.screen === 'results') this.startMatch();
        break;
      case 'lobby':
        if (pid === cap && this.screen !== 'lobby') this.toLobby();
        break;
      case 'view': {
        if (m.on) this.viewers.add(pid);
        else this.viewers.delete(pid);
        if (pl && pl.view !== m.pref) {
          pl.view = m.pref;
          this.refreshLobby();
        }
        if (m.on && this.game) this.sendMatchTo((s) => this.toPhone(pid, s));
        break;
      }
    }
  }

  // Stick packet: [1, mx, my, ax, ay, flags, grenadeCounter]
  phoneInput(pid, buf) {
    if (buf.length < 7 || buf[0] !== 1) return;
    const inp = this.inputs.get(pid);
    if (!inp) return;
    const s8 = (i) => (buf[i] > 127 ? buf[i] - 256 : buf[i]);
    inp.mx = s8(1) / 127;
    inp.my = s8(2) / 127;
    const ax = s8(3);
    const ay = s8(4);
    inp.aiming = !!(buf[5] & 2);
    if (inp.aiming && (ax || ay)) inp.aim = Math.atan2(ay, ax);
    inp.fire = !!(buf[5] & 1);
    inp.gren = buf[6];
  }

  // A screen (TV or laptop) connected: bring it up to date.
  screenHello(send) {
    send(JSON.stringify(this.lobbyMsg()));
    if (this.game) this.sendMatchTo(send);
    if (this.screen === 'results' && this.results) send(JSON.stringify(this.results));
  }

  screenMessage(m) {
    switch (m.t) {
      case 'set':
        if (this.screen === 'lobby' || LIVE_SETTINGS.includes(m.key)) this.changeSetting(m.key, m.dir === -1 ? -1 : 1);
        break;
      case 'weapon':
        if (this.screen === 'lobby') this.toggleWeapon(m.key);
        break;
      case 'start':
        if (this.screen !== 'game') this.startMatch();
        break;
      case 'lobby':
        if (this.screen !== 'lobby') this.toLobby();
        break;
      case 'kb':
        this.toggleKeyboardPlayer();
        break;
      case 'finish':
        if (this.game && this.game.phase === 'playing') this.game.finish();
        break;
    }
  }

  screenInput(buf) {
    this.phoneInput(KB_PID, buf);
  }

  // --------------------------------------------------------------- lobby

  captainPid() {
    let best = null;
    for (const pl of this.lobby.values()) {
      if (pl.connected && !pl.keyboard && (!best || pl.joinedAt < best.joinedAt)) best = pl;
    }
    return best ? best.pid : null;
  }

  autoTeam(pid) {
    const c = { red: 0, blue: 0 };
    for (const pl of this.lobby.values()) if (pl.pid !== pid && pl.connected && pl.team in c) c[pl.team]++;
    return c.red <= c.blue ? 'red' : 'blue';
  }

  gameTeamFor(pl) {
    const g = this.game;
    if (!g.teamMode) return 'ffa';
    const c = { red: 0, blue: 0 };
    for (const p of g.players.values()) if (!p.bot) c[p.team]++;
    if (c.red === c.blue) return pl.team;
    return c.red < c.blue ? 'red' : 'blue';
  }

  changeSetting(key, dir = 1) {
    const s = this.settings;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + dir + arr.length) % arr.length];
    switch (key) {
      case 'mode': s.mode = cyc(MODE_ORDER, s.mode); break;
      case 'map': s.map = (s.map + dir + MAPS.length) % MAPS.length; break;
      case 'bots': s.bots = (s.bots + dir + 9) % 9; break;
      case 'skill': s.skill = cyc(SKILLS, s.skill); break;
      case 'limit': s.limit = (s.limit + dir + 3) % 3; break;
      case 'time': s.time = (s.time + dir + 3) % 3; break;
      case 'assist': s.assist = !s.assist; break;
      case 'screen': s.screen = s.screen === 'tv' ? 'phone' : 'tv'; break;
      case 'lang': s.lang = s.lang === 'ar' ? 'en' : 'ar'; break;
      case 'voice':
        this.packs = this.voicePacks();
        s.voice = cyc([...this.packs.map((p) => p.id), 'system'], this.voiceNow());
        break;
      default: return;
    }
    this.saveSettings();
    this.refreshLobby();
  }

  // Weapons panel in the lobby: switch one weapon on/off, or 'all' back on.
  toggleWeapon(key) {
    const s = this.settings;
    if (key === 'all') s.off = [];
    else if (TOGGLES.includes(key)) s.off = s.off.includes(key) ? s.off.filter((k) => k !== key) : [...s.off, key];
    else return;
    this.saveSettings();
    this.refreshLobby();
  }

  // Raw values: each screen shows them in its own words (see i18n.js).
  settingsView() {
    const s = this.settings;
    const m = s.mode;
    return [
      { key: 'mode', v: m },
      { key: 'map', v: MAPS[s.map].id },
      { key: 'screen', v: s.screen },
      { key: 'bots', v: s.bots },
      { key: 'skill', v: s.skill },
      { key: 'limit', v: LIMITS[m][s.limit], unit: LIMIT_UNIT[m] },
      { key: 'time', v: TIMES[s.time] },
      { key: 'assist', v: s.assist },
      { key: 'lang', v: s.lang },
      { key: 'voice', v: this.voiceNow(), label: this.packs.find((p) => p.id === this.voiceNow())?.label },
      { key: 'weapons', v: TOGGLES.length - s.off.length, of: TOGGLES.length },
    ];
  }

  visiblePlayers() {
    const now = performance.now();
    return [...this.lobby.values()]
      .filter((p) => p.connected || now - p.leftAt < 8000)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  botSplit() {
    const c = { red: 0, blue: 0 };
    for (const pl of this.lobby.values()) if (pl.connected && pl.team in c) c[pl.team]++;
    const bots = { red: 0, blue: 0 };
    for (let i = 0; i < this.settings.bots; i++) bots[c.red + bots.red <= c.blue + bots.blue ? 'red' : 'blue']++;
    return bots;
  }

  lobbyMsg() {
    const players = this.visiblePlayers();
    return {
      t: 'lobby',
      screen: this.screen,
      captain: this.captainPid(),
      mode: this.settings.mode,
      map: MAPS[this.settings.map].id,
      screenMode: this.settings.screen,
      lang: this.settings.lang,
      voice: this.voiceNow(),
      family: this.family(),
      weapons: TOGGLES.map((key) => ({ key, on: !this.settings.off.includes(key) })),
      bots: this.settings.bots,
      botSplit: this.botSplit(),
      canStart: players.some((p) => p.connected) || this.settings.bots >= 2,
      players: players.map((p) => ({
        pid: p.pid, name: p.name, color: p.color, team: p.team, on: p.connected, kb: !!p.keyboard, view: p.view,
      })),
      settings: this.settingsView(),
    };
  }

  refreshLobby() {
    this.toEveryone(this.lobbyMsg());
  }

  toggleKeyboardPlayer() {
    if (this.lobby.has(KB_PID)) {
      this.lobby.delete(KB_PID);
      this.inputs.delete(KB_PID);
      this.game?.removePlayer(KB_PID);
    } else {
      const pl = { pid: KB_PID, name: 'Laptop', color: '#ffffff', keyboard: true, connected: true, joinedAt: performance.now(), leftAt: 0 };
      pl.team = this.autoTeam(KB_PID);
      this.lobby.set(KB_PID, pl);
      this.inputs.set(KB_PID, blankInput());
      if (this.game && this.screen !== 'lobby') this.addHuman(pl);
    }
    if (this.game) this.sendRoster();
    this.refreshLobby();
  }

  cleanup() {
    const now = performance.now();
    let changed = false;
    for (const pl of this.lobby.values()) {
      if (pl.connected || pl.keyboard) continue;
      if (now - pl.leftAt > (this.screen === 'lobby' ? 8000 : 60000)) {
        this.lobby.delete(pl.pid);
        this.inputs.delete(pl.pid);
        this.game?.removePlayer(pl.pid);
        changed = true;
      }
    }
    if (changed) {
      if (this.game) this.sendRoster();
      this.refreshLobby();
    }
  }

  // --------------------------------------------------------------- match

  addHuman(pl) {
    this.game.addPlayer({ pid: pl.pid, name: pl.name, color: pl.color, team: this.gameTeamFor(pl), input: this.inputs.get(pl.pid) });
  }

  startMatch() {
    const s = this.settings;
    const humans = [...this.lobby.values()].filter((pl) => pl.connected);
    if (!humans.length && s.bots < 2) {
      this.net.screens(JSON.stringify({ t: 'toast', key: 'needPlayers', color: '#ffcc4d' }));
      return;
    }
    this.clearTimers();
    const map = MAPS[s.map];
    const mode = s.mode;
    this.game = new Game(map, { mode, scoreLimit: LIMITS[mode][s.limit], timeLimit: TIMES[s.time] * 60, aimAssist: s.assist, off: s.off }, this.hooks());
    const g = this.game;
    for (const pl of humans) {
      const inp = this.inputs.get(pl.pid);
      inp.fire = false;
      g.addPlayer({ pid: pl.pid, name: pl.name, color: pl.color, team: mode === 'ffa' ? 'ffa' : pl.team, input: inp });
    }
    const perTeam = { red: 0, blue: 0 };
    const names = s.lang === 'ar' ? BOT_NAMES_AR : BOT_NAMES;
    const offset = Math.floor(Math.random() * names.length);
    for (let i = 0; i < s.bots; i++) {
      let team = 'ffa';
      if (mode !== 'ffa') {
        const c = { red: 0, blue: 0 };
        for (const p of g.players.values()) c[p.team]++;
        team = c.red <= c.blue ? 'red' : 'blue';
      }
      const n = team === 'ffa' ? i : perTeam[team]++;
      g.addPlayer({
        pid: BOT_PID + i,
        name: names[(offset + i) % names.length],
        color: BOT_COLORS[i % BOT_COLORS.length],
        team,
        bot: makeBot(s.skill, n % 3 === 1 ? 'defend' : 'attack'),
      });
    }
    this.tick = 0;
    this.pickupVer = -1; // send the (filtered) pickups with the very first snapshot
    this.events = [];
    this.phoneEvents = [];
    this.hudCache.clear();
    this.results = null;
    this.matchMsg = JSON.stringify({
      t: 'match', map: map.id, mode, limit: LIMITS[mode][s.limit], unit: LIMIT_UNIT[mode], screenMode: s.screen,
    });
    this.screen = 'game';
    this.net.screens(this.matchMsg);
    this.net.phones(this.matchMsg);
    this.sendRoster();
    this.refreshLobby();
    this.ev('sy', `intro.${mode}`, {}, 1);
    this.startLoop();
  }

  toLobby() {
    this.clearTimers();
    this.stopLoop();
    this.game = null;
    this.results = null;
    this.screen = 'lobby';
    this.refreshLobby();
  }

  rosterMsg() {
    return JSON.stringify({
      t: 'roster',
      players: [...this.game.players.values()].map((p) => [p.pid, p.name, p.color, p.team, p.bot ? 1 : 0]),
    });
  }

  sendRoster() {
    const str = this.rosterMsg();
    this.net.screens(str);
    for (const pid of this.viewers) this.toPhone(pid, str);
  }

  // Everything a new viewer needs to start drawing the current match.
  sendMatchTo(send) {
    send(this.matchMsg);
    send(this.rosterMsg());
    send(JSON.stringify(encodeSnapshot(this.game, this.tick, [], true)));
  }

  startLoop() {
    if (this.loop) return;
    this.nextT = performance.now();
    this.loop = setInterval(() => this.pump(), 4);
  }

  stopLoop() {
    clearInterval(this.loop);
    this.loop = null;
  }

  pump() {
    const now = performance.now();
    let n = 0;
    while (now >= this.nextT && n < 4) {
      this.stepOnce();
      this.nextT += STEP * 1000;
      n++;
    }
    if (now - this.nextT > 250) this.nextT = now;
  }

  stepOnce() {
    const g = this.game;
    if (!g) return;
    g.step(g.phase === 'ended' && g.endT < 2 ? STEP * 0.3 : STEP);
    this.tick++;
    const pickupsChanged = g.pickupVer !== this.pickupVer;
    this.pickupVer = g.pickupVer;
    // Screens sit on the same machine: send every tick.
    if (this.net.hasScreens()) {
      this.net.screens(JSON.stringify(encodeSnapshot(g, this.tick, this.events, pickupsChanged || this.tick % 30 === 0)));
    }
    // Phones get 30 per second over Wi-Fi.
    if (this.viewers.size) {
      for (const e of this.events) this.phoneEvents.push(e);
      this.phonePickups ||= pickupsChanged;
      if (this.tick % 2 === 0) {
        const str = JSON.stringify(encodeSnapshot(g, this.tick, this.phoneEvents, this.phonePickups || this.tick % 30 === 0));
        for (const pid of this.viewers) this.toPhone(pid, str);
        this.phoneEvents = [];
        this.phonePickups = false;
      }
    }
    this.events = [];
    if (this.tick % 6 === 0) this.sendHuds();
  }

  hooks() {
    const E = (...a) => this.events.push(a);
    const r = Math.round;
    return {
      shoot: (p, w, x, y, ang) => E('sh', p.pid, w, r(x), r(y), r(ang * 100) / 100),
      beam: (x0, y0, x1, y1, c) => E('bm', r(x0), r(y0), r(x1), r(y1), c),
      impact: (x, y, nx, ny, c, kind) => E('im', r(x), r(y), nx, ny, c, kind),
      hit: (o, amt, x, y, att, w, silent) => {
        E('ht', o.pid, r(amt * 10) / 10, r(x), r(y), silent ? 1 : 0);
        this.vibe(o.pid, [Math.min(70, 18 + amt)]);
      },
      shielded: (o, x, y) => E('sd', r(x), r(y)),
      explode: (x, y, rad, w) => E('ex', r(x), r(y), rad, w),
      kill: (k, v, w, special) => {
        E('kl', k ? k.pid : 0, v.pid, w);
        this.onKill(k, v, special);
      },
      spawn: (p) => E('sp', p.pid),
      jump: (p) => E('jp', p.pid),
      land: (p) => E('ld', p.pid),
      pickup: (p, k) => {
        E('pk', p.pid, k.kind, k.weapon || '', r(k.x), r(k.y));
        this.vibe(p.pid, [25]);
      },
      flag: (kind, team, p) => {
        E('fg', kind, team, p ? p.pid : 0);
        this.onFlag(kind, team, p);
      },
      throw: (p) => E('th', p.pid),
      bounce: (b, x, y) => {
        if (b.kind === 'grenade' || b.kind === 'hole') E('bn', r(x), r(y));
      },
      freeze: (p) => {
        E('fz', p.pid);
        this.vibe(p.pid, [60, 40, 120], true);
      },
      thaw: (p) => E('uf', p.pid),
      bonk: (x, y) => E('bk', r(x), r(y)),
      hole: (b) => E('ho', r(b.x), r(b.y)),
      empty: (p) => E('em', p.pid),
      pad: (p, pad) => E('pd', p.pid, r(pad.x), r(pad.y)),
      tele: (p, ox, oy, d) => E('tp', p.pid, r(ox), r(oy), r(d.x), r(d.y)),
      tick: (n) => E('tk', n),
      go: () => E('go'),
      end: (winner) => this.onEnd(winner),
    };
  }

  onKill(k, v, special) {
    this.vibe(v.pid, [90, 50, 180], true);
    if (!k) return;
    this.vibe(k.pid, [25, 40, 25], true);
    const r = Math.round;
    // Announcer lines travel as keys; every screen speaks its own language.
    if (special === 'first') {
      this.ev('sy', 'firstBlood', {}, 1);
      this.ev('ft', r(k.x), r(k.y - 120), 'firstBlood', '#ff6b6b');
    } else if (k.bot && SKILL[k.bot.skill]?.weak) {
      // Easy bots get no "on fire!" cheers: celebrate the kids, not the bots.
    } else if (k.multi >= 2) {
      const key = k.multi === 2 ? 'double' : k.multi === 3 ? 'triple' : 'unstoppable';
      this.ev('sy', key, {}, 1);
      this.ev('ft', r(k.x), r(k.y - 120), key, '#ffcc4d');
    } else if (k.streak === 5 || k.streak === 10) {
      const key = k.streak === 5 ? 'onFire' : 'legendary';
      this.ev('sy', key, { name: k.name }, 0);
      this.ev('ba', key, { name: k.name }, 'streakSub', { n: k.streak }, k.color, 1800);
    }
  }

  onFlag(kind, team, p) {
    switch (kind) {
      case 'taken':
        this.ev('sy', 'flagTaken', { team }, 0);
        this.ev('to', 'grabbed', { name: p.name, team }, TEAM_COLOR[team]);
        this.vibe(p.pid, [40, 40, 40], true);
        break;
      case 'captured':
        this.ev('sy', 'scores', { team: p.team }, 1);
        this.ev('ba', 'scores', { team: p.team }, 'scoresSub', { name: p.name }, TEAM_COLOR[p.team], 2200);
        this.vibe(p.pid, [100, 50, 100, 50, 300], true);
        break;
      case 'returned':
        this.ev('sy', 'flagReturned', { team }, 0);
        this.ev('to', p ? 'saved' : 'backHome', p ? { name: p.name, team } : { team }, TEAM_COLOR[team]);
        break;
      case 'dropped':
        this.ev('sy', 'flagDropped', { team }, 0);
        break;
    }
  }

  onEnd(winner) {
    const g = this.game;
    // title = [key, params], translated by each screen.
    let title;
    let color;
    if (winner === 'draw') {
      title = ['draw', {}];
      color = '#ffffff';
    } else if (winner === 'red' || winner === 'blue') {
      title = ['teamWins', { team: winner }];
      color = TEAM_COLOR[winner];
    } else {
      const p = g.players.get(winner);
      title = ['playerWins', { name: p?.name || '?' }];
      color = p?.color || '#ffcc4d';
    }
    this.ev('sy', title[0], title[1], 1);
    this.ev('ff');
    this.ev('ba', `title.${title[0]}`, title[1], '', {}, color, 2400);
    this.later(() => {
      if (this.game === g) this.showResults(g, title, color);
    }, 2600);
  }

  showResults(g, title, color) {
    const rows = [...g.players.values()].sort((a, b) => b.caps * 10 + b.kills - (a.caps * 10 + a.kills) || a.deaths - b.deaths);
    const mvp = rows[0];
    this.results = {
      t: 'results',
      title,
      color,
      score: g.teamMode ? [g.score.red, g.score.blue] : null,
      flags: !!g.flags,
      rows: rows.map((p) => [p.name, p.color, p.team, p.bot ? 1 : 0, p.caps, p.kills, p.deaths, p === mvp ? 1 : 0]),
    };
    this.net.screens(JSON.stringify(this.results));
    for (const p of g.players.values()) {
      if (p.bot || p.pid >= 256) continue;
      const won = g.winner === p.team || g.winner === p.pid;
      this.toPhone(p.pid, { t: 'end', title, color, won, k: p.kills, d: p.deaths, c: p.caps, mvp: p === mvp });
    }
    this.screen = 'results';
    this.refreshLobby();
    this.later(() => {
      if (this.screen === 'results' && this.game === g) this.toLobby();
    }, 30000);
  }

  // --------------------------------------------------------------- phones

  sendHuds() {
    const g = this.game;
    for (const p of g.players.values()) {
      if (p.bot || p.pid >= 256) continue;
      const m = {
        t: 'hud',
        hp: Math.max(0, Math.ceil(p.hp)),
        w: p.weapon,
        wn: WEAPONS[p.weapon].name,
        a: p.ammo === Infinity ? -1 : p.ammo,
        g: p.gren,
        h: p.holes,
        fz: p.frozenT > 0 ? 1 : 0,
        f: Math.round(p.fuel * 10),
        al: p.alive ? 1 : 0,
        rs: p.alive ? 0 : Math.max(1, Math.ceil(p.respawnT)),
        fl: p.carrying ? 1 : 0,
        pw: p.powerT > 0 ? 1 : 0,
        k: p.kills,
        d: p.deaths,
        tm: p.team,
        sc: g.teamMode ? [g.score.red, g.score.blue] : null,
        tl: Math.max(0, Math.ceil(g.timeLeft)),
        ph: g.phase,
      };
      const key = JSON.stringify(m);
      if (this.hudCache.get(p.pid) !== key) {
        this.hudCache.set(p.pid, key);
        this.toPhone(p.pid, key);
      }
    }
  }

  vibe(pid, pattern, force = false) {
    if (pid >= 256 || !this.lobby.has(pid)) return;
    const now = performance.now();
    if (!force && now - (this.lastVibe.get(pid) || 0) < 120) return;
    this.lastVibe.set(pid, now);
    this.toPhone(pid, { t: 'vibe', p: pattern });
  }
}

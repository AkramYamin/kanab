// Client-side copy of the match, rebuilt from server snapshots. Between
// snapshots everything keeps moving along its last known velocity, and when a
// new snapshot corrects a position the difference is blended away over a few
// frames instead of snapping.

import { PHYS } from './game.js';
import { WEAPONS } from './weapons.js';
import { decodePlayer, decodePickup, PKINDS, WKEYS, TEAMS, FLAG_STATES, PHASES } from './protocol.js';

const MAX_EXTRAP = 0.1;

function newPlayer(pid) {
  return {
    pid, name: '', color: '#ffffff', team: 'red', bot: false,
    x: 0, y: 0, sx: 0, sy: 0, ox: 0, oy: 0, vx: 0, vy: 0, t0: 0,
    aim: 0, facing: 1, onGround: false, onPlat: false, jetting: false, alive: false,
    hp: 100, prot: 0, powerT: 0, burnT: 0, chill: 0, frozenT: 0, swingT: 0, swingAng: 0, carrying: null, weapon: 'blaster', ammo: Infinity, gren: 0, fuel: 1,
    respawnT: 0, hitFlash: 0, muzzleT: 0, runPhase: 0, w: PHYS.W, h: PHYS.H,
    airT: 0, jumpAge: 9, jumpCd: 0, dropT: 0, fling: false, teleLock: false,
  };
}

export class World {
  constructor(map, match) {
    this.map = map;
    this.mode = match.mode;
    this.teamMode = match.mode !== 'ffa';
    this.limit = match.limit;
    this.unit = match.unit;
    this.players = new Map();
    this.projectiles = [];
    this.pickups = []; // arrive with the first snapshot (some weapons may be switched off)
    this.flags = match.mode === 'ctf' ? { red: this.flag('red'), blue: this.flag('blue') } : null;
    this.score = { red: 0, blue: 0 };
    this.phase = 'countdown';
    this.timeLeft = 0;
    this.localPid = null; // this phone's own player: moved by prediction instead
    this.snapAt = 0;
  }

  flag(team) {
    const h = this.map.flags[team];
    return { team, hx: h.x, hy: h.y, x: h.x, y: h.y, state: 'home', returnT: 0, carrier: 0 };
  }

  ensure(pid) {
    let p = this.players.get(pid);
    if (!p) {
      p = newPlayer(pid);
      this.players.set(pid, p);
    }
    return p;
  }

  setRoster(list) {
    const keep = new Set();
    for (const [pid, name, color, team, bot] of list) {
      Object.assign(this.ensure(pid), { name, color, team, bot: !!bot });
      keep.add(pid);
    }
    for (const pid of this.players.keys()) if (!keep.has(pid)) this.players.delete(pid);
  }

  // Apply one snapshot; returns its events for the caller to turn into effects.
  apply(s, now) {
    this.snapAt = now;
    this.phase = PHASES[s.ph];
    this.timeLeft = s.tl;
    this.score.red = s.sc[0];
    this.score.blue = s.sc[1];
    for (const a of s.P) {
      const p = this.players.get(a[0]);
      if (!p) continue;
      const wasAlive = p.alive;
      const px = p.x;
      const py = p.y;
      decodePlayer(a, p);
      if (p.pid === this.localPid) {
        p.t0 = now;
        continue;
      }
      // Keep what is on screen continuous: fold the correction into an offset.
      if (wasAlive && p.alive && Math.hypot(px - p.sx, py - p.sy) < 160) {
        p.ox = px - p.sx;
        p.oy = py - p.sy;
      } else {
        p.ox = 0;
        p.oy = 0;
      }
      p.x = p.sx + p.ox;
      p.y = p.sy + p.oy;
      p.t0 = now;
    }
    this.projectiles = s.B.map((b) => {
      const kind = PKINDS[b[1]];
      const wkey = b[2] >= 0 ? WKEYS[b[2]] : 'grenade';
      const active = b[10] === 1;
      return {
        id: b[0], kind, wkey, sx: b[3], sy: b[4], x: b[3], y: b[4], vx: b[5], vy: b[6], age0: b[7] / 100, age: b[7] / 100,
        team: TEAMS[b[8]], owner: b[9], active, color: WEAPONS[wkey]?.color || '#ffffff',
        grav: kind === 'grenade' || (kind === 'hole' && !active) ? 1500 : kind === 'bounce' ? WEAPONS.bouncer.gravity : 0,
      };
    });
    if (s.F && this.flags) {
      for (const [i, team] of ['red', 'blue'].entries()) {
        const [x, y, st, rt, carrier] = s.F[i];
        Object.assign(this.flags[team], { x, y, state: FLAG_STATES[st], returnT: rt / 10, carrier });
      }
    }
    if (s.K) this.pickups = s.K.map(decodePickup);
    return s.E || [];
  }

  // Advance visuals between snapshots.
  update(dt, now) {
    const e = Math.min((now - this.snapAt) / 1000, MAX_EXTRAP);
    const decay = Math.exp(-dt * 14);
    for (const p of this.players.values()) {
      p.hitFlash = Math.max(0, p.hitFlash - dt * 6);
      p.muzzleT -= dt;
      p.prot = Math.max(0, p.prot - dt);
      if (p.swingT > 0) p.swingT -= dt;
      if (p.pid === this.localPid || !p.alive) continue;
      p.ox *= decay;
      p.oy *= decay;
      const pe = Math.min((now - p.t0) / 1000, MAX_EXTRAP);
      p.x = p.sx + p.vx * pe + p.ox;
      p.y = p.sy + (p.onGround ? 0 : p.vy * pe + 0.5 * PHYS.GRAV * pe * pe) + p.oy;
    }
    for (const b of this.projectiles) {
      b.x = b.sx + b.vx * e;
      b.y = b.sy + b.vy * e + 0.5 * b.grav * e * e;
      b.age = b.age0 + e;
    }
    for (const k of this.pickups) {
      if (k.t > 0) k.t = Math.max(0, k.t - dt);
      if (k.temp !== undefined) k.temp -= dt;
    }
  }
}

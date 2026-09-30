// The match simulation. Runs at a fixed 60 steps per second on the laptop's
// Node server (and locally for the lobby demo and phone-side prediction).
// It knows nothing about drawing or sound: it reports what happened through
// `hooks` (shoot, hit, explode, kill, flag, ...) and the host turns those into
// events for screens, announcer lines and phone vibrations.

import { WEAPONS, GRENADE, HOLE, FREEZE, SWING } from './weapons.js';
import { clamp, rand, approach, angleDiff, segAABB, distToBox } from './util.js';
import { updateBot } from './bots.js';

export const PHYS = {
  // Soldiers are drawn from a 52-unit-tall model scaled up by SCALE.
  W: 30, H: 60, SHOULDER: 39, SCALE: 60 / 52,
  RUN: 390, ACC_GROUND: 3600, ACC_AIR: 1900, FLING_DRAG: 260,
  GRAV: 2050, JUMP: 790, MAX_FALL: 1150,
  JET: 3400, JET_MAX_UP: 580, FUEL_USE: 0.62, FUEL_REGEN: 1.2,
};

export const STEP = 1 / 60;
export const TEAM_COLOR = { red: '#ff4d5e', blue: '#3da5ff' };
export const other = (team) => (team === 'red' ? 'blue' : 'red');
export const blankInput = () => ({ mx: 0, my: 0, aim: 0, aiming: false, fire: false, gren: 0 });

const wallHit = { t: 0, nx: 0, ny: 0 };
const tmpHit = { t: 0, nx: 0, ny: 0 };

export class Game {
  constructor(map, settings, hooks = {}) {
    this.map = map;
    this.s = settings; // { mode, scoreLimit, timeLimit, aimAssist, demo }
    this.h = hooks;
    this.teamMode = settings.mode !== 'ffa';
    this.players = new Map();
    this.projectiles = [];
    this.pickups = map.pickups.map((k) => ({ ...k, t: 0 }));
    this.flags = settings.mode === 'ctf' ? { red: this.makeFlag('red'), blue: this.makeFlag('blue') } : null;
    this.score = { red: 0, blue: 0 };
    this.time = 0;
    this.timeLeft = settings.timeLimit;
    this.phase = settings.demo ? 'playing' : 'countdown';
    this.countdown = 3.2;
    this.lastTick = 4;
    this.winner = null;
    this.endT = 0;
    this.firstBlood = false;
    this.nextId = 1;
    this.pickupVer = 0;
  }

  emit(name, ...args) {
    const fn = this.h[name];
    if (fn) fn(...args);
  }

  isEnemy(a, b) {
    return a !== b && (!this.teamMode || a.team !== b.team);
  }

  // ------------------------------------------------------------------ players

  addPlayer({ pid, name, color, team, bot = null, input }) {
    const p = {
      pid, name, color, team, bot,
      x: 0, y: 0, vx: 0, vy: 0, w: PHYS.W, h: PHYS.H,
      onGround: false, onPlat: false, airT: 0, jumpCd: 0, jumpAge: 9, dropT: 0, fling: false, teleLock: false,
      facing: 1, aim: 0,
      hp: 100, alive: false, respawnT: 0, prot: 0,
      fuel: 1, jetting: false, weapon: 'blaster', ammo: Infinity, gren: GRENADE.start, fireCd: 0,
      burnT: 0, burnBy: null, powerT: 0, hitFlash: 0, muzzleT: 0, runPhase: 0,
      chill: 0, frozenT: 0, iceProt: 0, swingT: 0, swingAng: 0, swingHits: [], holes: 0,
      carrying: null, lastHitBy: null, lastHitT: -99,
      kills: 0, deaths: 0, caps: 0, returns: 0, streak: 0, multi: 0, lastKillT: -99,
      input: input || { mx: 0, my: 0, aim: 0, aiming: false, fire: false, gren: 0 },
    };
    p.lastGren = p.input.gren;
    this.players.set(pid, p);
    this.spawn(p);
    return p;
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    if (p.carrying) this.dropFlag(p);
    this.players.delete(pid);
  }

  pickSpawn(p) {
    const sp = this.map.spawns;
    const list = this.teamMode ? sp[p.team] : [...sp.red, ...sp.blue];
    let best = list[0];
    let bestScore = -Infinity;
    for (const s of list) {
      let d = 2500;
      for (const o of this.players.values()) {
        if (o.alive && this.isEnemy(p, o)) d = Math.min(d, Math.hypot(o.x - s.x, o.y - s.y));
      }
      const score = d + rand(0, 500);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  spawn(p) {
    const s = this.pickSpawn(p);
    Object.assign(p, {
      x: s.x + rand(-8, 8), y: s.y, vx: 0, vy: 0, onGround: true, airT: 0,
      hp: 100, alive: true, prot: 2, fuel: 1, weapon: 'blaster', ammo: Infinity,
      gren: GRENADE.start, burnT: 0, powerT: 0, carrying: null, streak: 0, fireCd: 0.25, hitFlash: 0,
      chill: 0, frozenT: 0, iceProt: 0, swingT: 0, holes: 0,
    });
    const left = p.x < this.map.W / 2;
    p.aim = left ? -0.05 : Math.PI + 0.05;
    p.facing = left ? 1 : -1;
    p.fling = false;
    p.teleLock = false;
    this.emit('spawn', p);
  }

  // --------------------------------------------------------------------- step

  step(dt) {
    this.time += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastTick && n > 0) {
        this.lastTick = n;
        this.emit('tick', n);
      }
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.emit('go');
      }
    } else if (this.phase === 'playing' && !this.s.demo) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.finish();
    } else if (this.phase === 'ended') {
      this.endT += dt;
    }

    for (const p of this.players.values()) if (p.bot) updateBot(this, p, dt);
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.updateProjectiles(dt);
    if (this.flags) this.updateFlags(dt);
    this.updatePickups(dt);
  }

  updatePlayer(p, dt) {
    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0 && this.phase !== 'ended') this.spawn(p);
      return;
    }
    const inp = p.input;
    const frozen = this.phase === 'countdown';
    p.prot = Math.max(0, p.prot - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt * 6);
    p.muzzleT -= dt;
    p.powerT = Math.max(0, p.powerT - dt);
    if (p.burnT > 0) {
      p.burnT -= dt;
      this.damage(p, 9 * dt, this.players.get(p.burnBy) || null, 'burn', 0, 0, true);
      if (!p.alive) return;
    }

    this.movePlayer(p, dt, frozen);
    // Safety net: a broken number must never leave a soldier stuck off-screen.
    if (!Number.isFinite(p.x + p.y + p.vx + p.vy)) {
      this.spawn(p);
      return;
    }
    if (p.y > this.map.H + 200) this.kill(p, null, 'fall');
    if (p.swingT > 0) this.updateSwing(p, dt);

    // Right stick: aim + fire. Nothing works from inside an ice block.
    const stuck = frozen || p.frozenT > 0;
    p.fireCd = Math.max(p.fireCd - dt, -dt);
    if (!stuck && inp.fire && p.fireCd <= 0 && this.phase !== 'ended') {
      this.fire(p);
    }
    if (inp.gren !== p.lastGren) {
      const presses = (inp.gren - p.lastGren) & 255;
      p.lastGren = inp.gren;
      if (!stuck && presses > 0 && (p.gren > 0 || p.holes > 0) && this.phase !== 'ended') this.throwGrenade(p);
    }
  }

  // Everything about moving one soldier: sticks, jump, jetpack, collisions,
  // jump pads and teleporters. Pure physics, so phones can run it too to
  // predict their own player without waiting for the network.
  movePlayer(p, dt, frozen) {
    const inp = p.input;
    // Frozen solid: no steering or aiming, and the ice block slides.
    const iced = p.frozenT > 0;
    if (iced) {
      p.frozenT -= dt;
      if (p.frozenT <= 0) {
        p.frozenT = 0;
        p.iceProt = FREEZE.immune;
        this.emit('thaw', p);
      }
    } else if (p.iceProt > 0) p.iceProt -= dt;
    if (p.chill > 0) p.chill = Math.max(0, p.chill - FREEZE.decay * dt);
    if (iced) frozen = true;
    if (inp.aiming && !iced) p.aim = inp.aim;
    p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;

    // Left stick: small dead zone, full speed at ~75% tilt (easy for small thumbs).
    let mx = inp.mx;
    mx = Math.abs(mx) < 0.18 ? 0 : Math.sign(mx) * Math.min(1, (Math.abs(mx) - 0.18) / 0.57);
    const up = !frozen && inp.my < -0.45;
    const down = !frozen && inp.my > 0.55 && inp.my > Math.abs(inp.mx) * 0.8;
    const w = WEAPONS[p.weapon];
    let speed = PHYS.RUN;
    if (w.slow && inp.fire) speed *= w.slow;
    if (p.powerT > 0) speed *= 1.12;
    if (p.chill > 0) speed *= 1 - 0.5 * p.chill;
    const target = frozen ? 0 : mx * speed;
    const pulled = this.projectiles.length > 0 && this.pull(p, dt);
    if (iced) {
      if (p.onGround) p.vx = approach(p.vx, 0, 320 * dt);
    } else if (pulled) {
      // Inside a black hole's reach the sticks only fight it weakly.
      p.vx = approach(p.vx, target, PHYS.ACC_AIR * 0.35 * dt);
    } else if (!p.onGround && p.fling && Math.abs(p.vx) > Math.abs(target) && (target === 0 || Math.sign(target) === Math.sign(p.vx))) {
      p.vx = approach(p.vx, target, PHYS.FLING_DRAG * dt);
    } else {
      p.vx = approach(p.vx, target, (p.onGround ? PHYS.ACC_GROUND : PHYS.ACC_AIR) * dt);
    }

    // Push up = jump; keep holding = jetpack.
    p.jumpCd -= dt;
    p.jumpAge += dt;
    p.jetting = false;
    if (up) {
      const coyote = p.onGround || (p.airT < 0.08 && p.jumpAge > 0.3);
      if (coyote && p.jumpCd <= 0) {
        p.vy = -PHYS.JUMP;
        p.onGround = false;
        p.jumpCd = 0.25;
        p.jumpAge = 0;
        this.emit('jump', p);
      } else if (!p.onGround && p.airT > 0.12 && p.jumpAge > 0.16 && p.fuel > 0) {
        if (p.vy > -PHYS.JET_MAX_UP) p.vy = Math.max(p.vy - PHYS.JET * dt, -PHYS.JET_MAX_UP);
        p.fuel = Math.max(0, p.fuel - PHYS.FUEL_USE * dt);
        p.jetting = true;
      }
    }
    if (p.onGround) p.fuel = Math.min(1, p.fuel + PHYS.FUEL_REGEN * dt);
    else if (!up) p.fuel = Math.min(1, p.fuel + 0.08 * dt);

    // Pull down on a thin platform = drop through it.
    if (down && p.onGround && p.onPlat) {
      p.dropT = 0.25;
      p.onGround = false;
    }
    p.dropT -= dt;
    p.vy = Math.min(p.vy + PHYS.GRAV * (down && !p.onGround ? 1.5 : 1) * (pulled ? 0.3 : 1) * dt, PHYS.MAX_FALL);

    const wasGround = p.onGround;
    const fallV = p.vy;
    this.moveX(p, p.vx * dt);
    this.moveY(p, p.vy * dt);
    if (p.onGround) {
      p.airT = 0;
      p.fling = false;
      if (!wasGround && fallV > 650) this.emit('land', p, fallV);
    } else {
      p.airT += dt;
    }
    if (this.map.pads.length) this.checkPads(p);
    if (this.map.teles.length) this.checkTeles(p);
  }

  // Active black holes drag enemies toward their center (almost weightless).
  pull(p, dt) {
    let any = false;
    for (const b of this.projectiles) {
      if (b.kind !== 'hole' || !b.active || b.dead) continue;
      if (b.owner === p.pid || (this.teamMode && b.team === p.team)) continue;
      const dx = b.x - p.x;
      const dy = b.y - (p.y - p.h / 2);
      const d = Math.hypot(dx, dy);
      if (d > HOLE.radius || d < 1) continue;
      const a = HOLE.pull * (0.25 + 0.75 * (1 - d / HOLE.radius)) * dt;
      p.vx += (dx / d) * a;
      p.vy += (dy / d) * a;
      if (d < 70) {
        const k = Math.exp(-5 * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.fling = true;
      any = true;
    }
    return any;
  }

  checkPads(p) {
    if (p.vy < 0) return;
    for (const pad of this.map.pads) {
      if (Math.abs(p.x - pad.x) < 34 && p.y >= pad.y - 4 && p.y <= pad.y + 1) {
        p.vx = pad.vx !== 0 ? pad.vx : p.vx * 0.2;
        p.vy = pad.vy;
        p.y = pad.y - 2;
        p.onGround = false;
        p.fling = true;
        p.jumpAge = 0;
        p.jumpCd = 0.3;
        p.airT = 0.2;
        this.emit('pad', p, pad);
        return;
      }
    }
  }

  // Step into a portal and come out of its partner. You have to walk out of
  // the portal before it will take you back.
  checkTeles(p) {
    let inside = null;
    for (const t of this.map.teles) {
      if (Math.abs(p.x - t.x) < 24 && p.y > t.y - 80 && p.y - p.h < t.y - 10) {
        inside = t;
        break;
      }
    }
    if (!inside) {
      p.teleLock = false;
      return;
    }
    if (p.teleLock) return;
    const d = this.map.teles[inside.to];
    const ox = p.x;
    const oy = p.y;
    p.x = d.x;
    p.y = d.y - 0.5;
    if (p.vy > 0) p.vy = 0;
    p.teleLock = true;
    this.emit('tele', p, ox, oy, d);
  }

  // Where does a launch from (x, y) with this velocity come down? Used by the
  // bots to learn jump pads.
  simulateLaunch(x, y, vx, vy) {
    const p = {
      x, y, vx, vy, w: PHYS.W, h: PHYS.H, onGround: false, onPlat: false, airT: 0.2, jumpCd: 1, jumpAge: 0,
      dropT: 0, fling: true, teleLock: true, fuel: 0, aim: 0, facing: 1, weapon: 'blaster', powerT: 0,
      input: { mx: 0, my: 0, aim: 0, aiming: false, fire: false, gren: 0 },
    };
    const pads = this.map.pads;
    const shots = this.projectiles;
    this.map.pads = [];
    this.projectiles = [];
    for (let i = 0; i < 400 && !p.onGround; i++) this.movePlayer(p, STEP, false);
    this.map.pads = pads;
    this.projectiles = shots;
    return p.onGround ? { x: p.x, y: p.y } : null;
  }

  moveX(p, dx) {
    if (!dx) return;
    p.x += dx;
    const hw = p.w / 2;
    for (const s of this.map.solids) {
      if (p.x + hw > s.x && p.x - hw < s.x + s.w && p.y > s.y && p.y - p.h < s.y + s.h) {
        p.x = dx > 0 ? s.x - hw : s.x + s.w + hw;
        p.vx = 0;
      }
    }
    if (p.x < hw) { p.x = hw; p.vx = 0; }
    if (p.x > this.map.W - hw) { p.x = this.map.W - hw; p.vx = 0; }
  }

  moveY(p, dy) {
    const prevBottom = p.y;
    p.y += dy;
    p.onGround = false;
    p.onPlat = false;
    const hw = p.w / 2;
    for (const s of this.map.solids) {
      if (p.x + hw > s.x && p.x - hw < s.x + s.w && p.y > s.y && p.y - p.h < s.y + s.h) {
        if (dy > 0) {
          p.y = s.y;
          p.onGround = true;
        } else {
          p.y = s.y + s.h + p.h;
        }
        p.vy = 0;
      }
    }
    if (dy >= 0 && p.dropT <= 0) {
      for (const pl of this.map.plats) {
        if (p.x + hw > pl.x && p.x - hw < pl.x + pl.w && prevBottom <= pl.y + 0.5 && p.y >= pl.y) {
          p.y = pl.y;
          p.vy = 0;
          p.onGround = true;
          p.onPlat = true;
        }
      }
    }
    if (p.y - p.h < 0) {
      p.y = p.h;
      if (p.vy < 0) p.vy = 0;
    }
  }

  // ------------------------------------------------------------------ weapons

  // Gentle aim assist for human players: bends the shot toward an enemy that
  // is already close to the crosshair. Makes the game fair for 8-year-olds.
  assist(p, ang, w) {
    const sx = p.x;
    const sy = p.y - PHYS.SHOULDER;
    let bestD = w.kind === 'rail' ? 0.14 : 0.2;
    let best = null;
    for (const o of this.players.values()) {
      if (!o.alive || !this.isEnemy(p, o)) continue;
      const tx = o.x;
      const ty = o.y - o.h * 0.5;
      if (Math.hypot(tx - sx, ty - sy) > 1500) continue;
      const a = Math.atan2(ty - sy, tx - sx);
      const d = Math.abs(angleDiff(ang, a));
      if (d < bestD && this.los(sx, sy, tx, ty)) {
        bestD = d;
        best = a;
      }
    }
    return best === null ? ang : ang + angleDiff(ang, best) * 0.75;
  }

  fire(p) {
    const key = p.weapon;
    const w = WEAPONS[key];
    let ang = p.aim;
    if (!p.bot && this.s.aimAssist) ang = this.assist(p, ang, w);
    const sx = p.x;
    const sy = p.y - PHYS.SHOULDER;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const len = w.len * PHYS.SCALE;
    p.muzzleT = 0.06;
    p.fireCd += 1 / w.rate;

    if (w.kind === 'rail') {
      this.fireRail(p, sx, sy, ang, w);
    } else if (w.kind === 'melee') {
      this.swing(p, ang, w);
    } else {
      const n = w.pellets || 1;
      for (let i = 0; i < n; i++) {
        const a = ang + (Math.random() - 0.5) * 2 * (w.spread || 0);
        const sp = w.speed * (n > 1 ? rand(0.85, 1.1) : 1);
        const b = {
          id: this.nextId++, kind: w.kind, wkey: key, owner: p.pid, team: p.team,
          x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: w.life, age: 0, dmg: w.dmg, knock: w.knock || 0,
          gravity: w.gravity || 0, drag: w.drag || 0, bounces: w.bounces || 0, color: w.color,
        };
        // Travel from the shoulder to the barrel tip at once so point-blank
        // shots and guns poking into walls behave.
        this.moveProjectile(b, Math.cos(a) * len, Math.sin(a) * len);
        if (!b.dead) this.projectiles.push(b);
      }
    }
    if (w.recoil) {
      p.vx -= cos * w.recoil;
      if (!p.onGround) {
        p.vy -= sin * w.recoil * 0.8;
        p.fling = true;
      }
    }
    this.emit('shoot', p, key, sx + cos * len, sy + sin * len, ang);
    if (p.ammo !== Infinity && --p.ammo <= 0) {
      p.weapon = 'blaster';
      p.ammo = Infinity;
      this.emit('empty', p);
    }
  }

  fireRail(p, sx, sy, ang, w) {
    const ex = sx + Math.cos(ang) * 3200;
    const ey = sy + Math.sin(ang) * 3200;
    let t = 1;
    const hitWall = this.raySolids(sx, sy, ex, ey, wallHit);
    if (hitWall) t = wallHit.t;
    const hx = sx + (ex - sx) * t;
    const hy = sy + (ey - sy) * t;
    for (const o of this.players.values()) {
      if (!o.alive || !this.isEnemy(p, o)) continue;
      if (segAABB(sx, sy, hx, hy, o.x - o.w / 2 - 4, o.y - o.h - 4, o.x + o.w / 2 + 4, o.y, tmpHit)) {
        this.damage(o, w.dmg, p, 'rail', Math.cos(ang) * w.knock, Math.sin(ang) * w.knock - 120, false, o.x, o.y - o.h / 2);
      }
    }
    const len = w.len * PHYS.SCALE;
    this.emit('beam', sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, hx, hy, w.color, p);
    if (hitWall) this.emit('impact', hx, hy, wallHit.nx, wallHit.ny, w.color, 'rail');
  }

  // Hammer: lunge along the aim, then a big hitbox in front for a moment.
  swing(p, ang, w) {
    p.swingT = SWING;
    p.swingAng = ang;
    p.swingHits.length = 0;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    p.vx = c * w.dash;
    if (s < -0.3) p.vy = Math.min(p.vy, s * w.dash * 0.75);
    else if (s > 0.5 && !p.onGround) p.vy = Math.max(p.vy, s * w.dash);
    else if (p.onGround) p.vy = Math.min(p.vy, -280); // a little leap
    p.onGround = false;
    p.fling = true;
  }

  updateSwing(p, dt) {
    p.swingT -= dt;
    const w = WEAPONS.hammer;
    const c = Math.cos(p.swingAng);
    const s = Math.sin(p.swingAng);
    const hx = p.x + c * 46;
    const hy = p.y - PHYS.SHOULDER + s * 46;
    for (const o of this.players.values()) {
      if (!o.alive || !this.isEnemy(p, o) || p.swingHits.includes(o.pid)) continue;
      const l = o.x - o.w / 2;
      const r = o.x + o.w / 2;
      if (distToBox(hx, hy, l, o.y - o.h, r, o.y) > w.reach) continue;
      p.swingHits.push(o.pid);
      const bx = clamp(hx, l, r);
      const by = clamp(hy, o.y - o.h, o.y);
      // Hitting an ice block shatters it for extra damage.
      const shatter = o.frozenT > 0;
      if (shatter) o.frozenT = 0.001;
      const ky = Math.min(s, 0) * w.knock * 0.5 - 480;
      if (this.damage(o, w.dmg * (shatter ? 1.5 : 1), p, 'hammer', c * w.knock, ky, false, bx, by)) this.emit('bonk', bx, by);
    }
  }

  throwGrenade(p) {
    const hole = p.holes > 0;
    if (hole) p.holes--;
    else p.gren--;
    const a = p.aim;
    const sp = GRENADE.speed;
    this.projectiles.push({
      id: this.nextId++, kind: hole ? 'hole' : 'grenade', wkey: hole ? 'hole' : 'grenade', owner: p.pid, team: p.team,
      x: p.x, y: p.y - PHYS.SHOULDER,
      vx: Math.cos(a) * sp + p.vx * 0.4, vy: Math.sin(a) * sp - 180 + p.vy * 0.3,
      life: hole ? HOLE.fuse : GRENADE.fuse, age: 0, gravity: 1500, drag: 0.15, spin: 0,
    });
    this.emit('throw', p);
  }

  raySolids(x0, y0, x1, y1, out) {
    let found = false;
    let best = 2;
    for (const s of this.map.solids) {
      if (segAABB(x0, y0, x1, y1, s.x, s.y, s.x + s.w, s.y + s.h, tmpHit) && tmpHit.t < best) {
        best = tmpHit.t;
        out.t = tmpHit.t;
        out.nx = tmpHit.nx;
        out.ny = tmpHit.ny;
        found = true;
      }
    }
    return found;
  }

  los(x0, y0, x1, y1) {
    return !this.raySolids(x0, y0, x1, y1, tmpHit);
  }

  moveProjectile(b, dx, dy) {
    const x1 = b.x + dx;
    const y1 = b.y + dy;
    let wallT = 2;
    let nx = 0;
    let ny = 0;
    if (this.raySolids(b.x, b.y, x1, y1, wallHit)) {
      wallT = wallHit.t;
      nx = wallHit.nx;
      ny = wallHit.ny;
    }
    const lob = b.kind === 'grenade' || b.kind === 'hole';
    if (lob && dy > 0) {
      for (const pl of this.map.plats) {
        if (b.y <= pl.y && y1 >= pl.y) {
          const t = (pl.y - b.y) / dy;
          const px = b.x + dx * t;
          if (px >= pl.x && px <= pl.x + pl.w && t < wallT) {
            wallT = t;
            nx = 0;
            ny = -1;
          }
        }
      }
    }

    if (!lob) {
      let target = null;
      let tBest = Math.min(wallT, 1);
      for (const o of this.players.values()) {
        if (!o.alive || o.pid === b.owner) continue;
        if (this.teamMode && o.team === b.team) continue;
        if (segAABB(b.x, b.y, x1, y1, o.x - o.w / 2 - 3, o.y - o.h - 3, o.x + o.w / 2 + 3, o.y, tmpHit) && tmpHit.t <= tBest) {
          tBest = tmpHit.t;
          target = o;
        }
      }
      if (target) {
        this.projectileHitsPlayer(b, target, b.x + dx * tBest, b.y + dy * tBest);
        return;
      }
    }

    if (wallT <= 1) {
      const hx = b.x + dx * wallT;
      const hy = b.y + dy * wallT;
      if (nx === 0 && ny === 0) {
        // Started inside a wall.
        b.x = hx;
        b.y = hy;
        if (lob) { b.vx = 0; b.vy = 0; } else if (b.kind === 'rocket') this.explodeProjectile(b);
        else b.dead = true;
        return;
      }
      if (lob || b.kind === 'bounce') {
        const grenade = lob;
        const rest = grenade ? 0.45 : 0.92;
        b.x = hx + nx * 0.6;
        b.y = hy + ny * 0.6;
        if (nx) b.vx = -b.vx * rest;
        if (ny) {
          b.vy = -b.vy * rest;
          if (grenade) {
            b.vx *= 0.72;
            if (Math.abs(b.vy) < 70) b.vy = 0;
          }
        }
        if (!grenade && --b.bounces < 0) {
          b.dead = true;
          this.emit('impact', hx, hy, nx, ny, b.color, b.kind);
        } else if (Math.abs(b.vx) + Math.abs(b.vy) > 120) {
          this.emit('bounce', b, hx, hy);
        }
        return;
      }
      b.x = hx + nx * 4;
      b.y = hy + ny * 4;
      if (b.kind === 'rocket') this.explodeProjectile(b);
      else {
        b.dead = true;
        this.emit('impact', hx, hy, nx, ny, b.color, b.kind);
      }
      return;
    }
    b.x = x1;
    b.y = y1;
  }

  projectileHitsPlayer(b, o, hx, hy) {
    b.x = hx;
    b.y = hy;
    if (b.kind === 'rocket') {
      this.explodeProjectile(b);
      return;
    }
    const owner = this.players.get(b.owner) || null;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const hurt = this.damage(o, b.dmg, owner, b.wkey, (b.vx / sp) * b.knock, (b.vy / sp) * b.knock - b.knock * 0.3, false, hx, hy);
    if (hurt && b.kind === 'flame') {
      o.burnT = WEAPONS.flamer.burn;
      o.burnBy = b.owner;
    }
    if (hurt && b.kind === 'ice') this.chill(o, WEAPONS.freeze.chill, owner);
    b.dead = true;
  }

  // Freeze ray hits fill a meter; when it is full the target turns to ice.
  chill(o, amount, by) {
    if (!o.alive || o.frozenT > 0 || o.iceProt > 0) return;
    o.chill = Math.min(1, o.chill + amount);
    if (o.chill < 1) return;
    o.chill = 0;
    o.frozenT = FREEZE.time;
    o.jetting = false;
    o.burnT = 0;
    this.emit('freeze', o, by);
  }

  // Bees turn toward the nearest enemy they can see.
  steerBee(b, dt) {
    b.seekT = (b.seekT || 0) - dt;
    if (b.seekT <= 0) {
      b.seekT = 0.1;
      b.target = null;
      let best = WEAPONS.bees.seek;
      for (const o of this.players.values()) {
        if (!o.alive || o.pid === b.owner || (this.teamMode && o.team === b.team)) continue;
        const d = Math.hypot(o.x - b.x, o.y - o.h / 2 - b.y);
        if (d < best && this.los(b.x, b.y, o.x, o.y - o.h / 2)) {
          best = d;
          b.target = o;
        }
      }
    }
    const o = b.target;
    if (!o || !o.alive) return;
    const cur = Math.atan2(b.vy, b.vx);
    const want = Math.atan2(o.y - o.h / 2 - b.y, o.x - b.x);
    const turn = WEAPONS.bees.turn * dt;
    const a = cur + clamp(angleDiff(cur, want), -turn, turn);
    const sp = Math.hypot(b.vx, b.vy);
    b.vx = Math.cos(a) * sp;
    b.vy = Math.sin(a) * sp;
  }

  // A black hole grenade's fuse ran out: float up a little and start pulling.
  openHole(b) {
    b.active = true;
    b.vx = 0;
    b.vy = 0;
    b.gravity = 0;
    b.life = HOLE.life;
    const rise = this.raySolids(b.x, b.y, b.x, b.y - 70, wallHit) ? Math.max(0, wallHit.t * 70 - 24) : 46;
    b.y -= rise;
    this.emit('hole', b);
  }

  explodeProjectile(b) {
    b.dead = true;
    if (b.kind === 'grenade') this.explode(b.x, b.y, b.owner, 'grenade', GRENADE.dmg, GRENADE.radius);
    else this.explode(b.x, b.y, b.owner, 'rocket', WEAPONS.rocket.dmg, WEAPONS.rocket.radius);
  }

  explode(x, y, ownerPid, wkey, maxDmg, radius) {
    const owner = this.players.get(ownerPid) || null;
    for (const o of this.players.values()) {
      if (!o.alive) continue;
      const d = distToBox(x, y, o.x - o.w / 2, o.y - o.h, o.x + o.w / 2, o.y);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const cx = o.x;
      const cy = o.y - o.h / 2;
      let dx = cx - x;
      let dy = cy - y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const blocked = !this.los(x, y, cx, cy) && !this.los(x, y, cx, o.y - o.h + 4);
      const push = 950 * f * (blocked ? 0.4 : 1);
      const dmg = maxDmg * (0.2 + 0.8 * f) * (blocked ? 0.3 : 1);
      this.damage(o, dmg, owner, wkey, dx * push, dy * push - 260 * f, false, cx, cy);
    }
    this.emit('explode', x, y, radius, wkey);
  }

  updateProjectiles(dt) {
    for (const b of this.projectiles) {
      if (b.dead) continue;
      b.age += dt;
      b.life -= dt;
      if (b.active) {
        // A hovering black hole: pulling happens in movePlayer. Then it pops.
        if (b.life <= 0) {
          b.dead = true;
          this.explode(b.x, b.y, b.owner, 'hole', HOLE.dmg, HOLE.blast);
        }
        continue;
      }
      if (b.kind === 'bee' && b.age > 0.12) this.steerBee(b, dt);
      if (b.gravity) b.vy += b.gravity * dt;
      if (b.drag) {
        const f = Math.exp(-b.drag * dt);
        b.vx *= f;
        b.vy *= f;
      }
      if (b.kind === 'rocket') {
        const sp = Math.hypot(b.vx, b.vy);
        const max = WEAPONS.rocket.maxSpeed;
        if (sp > 1 && sp < max) {
          const k = Math.min(max, sp + 1100 * dt) / sp;
          b.vx *= k;
          b.vy *= k;
        }
      }
      this.moveProjectile(b, b.vx * dt, b.vy * dt);
      if (!b.dead && b.life <= 0) {
        if (b.kind === 'hole') this.openHole(b);
        else if (b.kind === 'grenade' || b.kind === 'rocket') this.explodeProjectile(b);
        else b.dead = true;
      }
    }
    let j = 0;
    for (const b of this.projectiles) if (!b.dead) this.projectiles[j++] = b;
    this.projectiles.length = j;
  }

  // ------------------------------------------------------------ damage / kill

  damage(o, amount, attacker, wkey, kx, ky, silent = false, hx, hy) {
    if (!o.alive) return false;
    if (this.phase === 'ended' || this.phase === 'countdown') return false;
    if (attacker && attacker !== o && !this.isEnemy(attacker, o)) return false; // no friendly fire
    if (o.prot > 0) {
      if (!silent) this.emit('shielded', o, hx ?? o.x, hy ?? o.y - o.h / 2);
      return false;
    }
    o.vx += kx;
    o.vy += ky;
    if (Math.abs(kx) > 200 || ky < -300) o.fling = true;
    if (attacker === o) return false; // rocket-jumping is free
    amount *= attacker && attacker.powerT > 0 ? 2 : 1;
    if (amount <= 0) return false;
    o.hp -= amount;
    o.hitFlash = 1;
    if (attacker) {
      o.lastHitBy = attacker.pid;
      o.lastHitT = this.time;
    }
    this.emit('hit', o, amount, hx ?? o.x, hy ?? o.y - o.h / 2, attacker, wkey, silent);
    if (o.hp <= 0) this.kill(o, attacker, wkey);
    return true;
  }

  kill(v, killer, wkey) {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.streak = 0;
    v.burnT = 0;
    v.jetting = false;
    v.respawnT = this.s.mode === 'ctf' ? 3 : 2.5;
    if (!killer || killer === v) {
      const last = this.players.get(v.lastHitBy);
      if (last && last !== v && this.time - v.lastHitT < 4) killer = last;
      else killer = null;
    }
    if (v.carrying) this.dropFlag(v);
    if (v.weapon !== 'blaster' && v.ammo > 0) {
      this.pickups.push({
        kind: 'weapon', weapon: v.weapon, ammo: v.ammo, x: v.x, y: this.surfaceBelow(v.x, v.y - 12),
        t: 0, temp: 12, respawn: 0,
      });
      this.pickupVer++;
    }
    let special = null;
    if (killer) {
      killer.kills++;
      killer.streak++;
      killer.multi = this.time - killer.lastKillT < 3.5 ? killer.multi + 1 : 1;
      killer.lastKillT = this.time;
      if (this.s.mode === 'tdm') this.score[killer.team]++;
      if (!this.firstBlood && !this.s.demo) {
        this.firstBlood = true;
        special = 'first';
      }
    }
    this.emit('kill', killer, v, wkey, special);
    this.checkWin();
  }

  // --------------------------------------------------------------- CTF flags

  makeFlag(team) {
    const h = this.map.flags[team];
    return { team, hx: h.x, hy: h.y, x: h.x, y: h.y, vy: 0, state: 'home', carrier: null, returnT: 0 };
  }

  dropFlag(p) {
    const f = this.flags?.[p.carrying];
    p.carrying = null;
    if (!f) return;
    f.state = 'dropped';
    f.carrier = null;
    f.x = clamp(p.x, 20, this.map.W - 20);
    f.y = Math.min(p.y, this.map.H - 10) - 10;
    f.vy = -250;
    f.returnT = 15;
    this.emit('flag', 'dropped', f.team, p);
  }

  returnFlag(f, by) {
    f.state = 'home';
    f.x = f.hx;
    f.y = f.hy;
    f.carrier = null;
    if (by !== undefined) this.emit('flag', 'returned', f.team, by);
  }

  touches(p, x, y, reach) {
    return Math.abs(p.x - x) < p.w / 2 + reach && p.y > y - 70 && p.y - p.h < y + 4;
  }

  updateFlags(dt) {
    const flags = [this.flags.red, this.flags.blue];
    for (const f of flags) {
      if (f.state === 'carried') {
        const c = this.players.get(f.carrier);
        if (!c || !c.alive) this.returnFlag(f, null);
        else {
          f.x = c.x;
          f.y = c.y;
        }
      } else if (f.state === 'dropped') {
        f.vy = Math.min(f.vy + PHYS.GRAV * dt, 900);
        const ground = this.surfaceBelow(f.x, f.y);
        const ny = f.y + f.vy * dt;
        if (ny >= ground) {
          f.y = ground;
          f.vy = 0;
        } else f.y = ny;
        f.returnT -= dt;
        if (f.returnT <= 0) this.returnFlag(f, null);
      }
    }
    if (this.phase !== 'playing') return;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const f of flags) {
        if (f.state === 'carried' || !this.touches(p, f.x, f.y, 16)) continue;
        if (f.team !== p.team) {
          if (!p.carrying) {
            f.state = 'carried';
            f.carrier = p.pid;
            p.carrying = f.team;
            this.emit('flag', 'taken', f.team, p);
          }
        } else if (f.state === 'dropped') {
          p.returns++;
          this.returnFlag(f, p);
        } else if (p.carrying) {
          const enemy = this.flags[p.carrying];
          p.carrying = null;
          this.returnFlag(enemy);
          p.caps++;
          this.score[p.team]++;
          this.emit('flag', 'captured', enemy.team, p);
          this.checkWin();
        }
      }
    }
  }

  surfaceBelow(x, y) {
    let best = this.map.H;
    for (const s of this.map.solids) if (x >= s.x && x <= s.x + s.w && s.y >= y - 0.5 && s.y < best) best = s.y;
    for (const pl of this.map.plats) if (x >= pl.x && x <= pl.x + pl.w && pl.y >= y - 0.5 && pl.y < best) best = pl.y;
    return best;
  }

  // ------------------------------------------------------------------ pickups

  updatePickups(dt) {
    let removed = false;
    for (const k of this.pickups) {
      if (k.temp !== undefined) {
        k.temp -= dt;
        if (k.temp <= 0) {
          k.dead = true;
          removed = true;
          continue;
        }
      }
      if (k.t > 0) {
        k.t -= dt;
        if (k.t <= 0) this.pickupVer++;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || !this.touches(p, k.x, k.y, 14)) continue;
        if (!this.applyPickup(p, k)) continue;
        this.emit('pickup', p, k);
        this.pickupVer++;
        if (k.temp !== undefined) {
          k.dead = true;
          removed = true;
        } else k.t = k.respawn;
        break;
      }
    }
    if (removed) {
      this.pickups = this.pickups.filter((k) => !k.dead);
      this.pickupVer++;
    }
  }

  applyPickup(p, k) {
    switch (k.kind) {
      case 'weapon': {
        const full = WEAPONS[k.weapon].ammo;
        if (p.weapon === k.weapon && p.ammo >= full) return false;
        p.weapon = k.weapon;
        p.ammo = k.ammo ?? full;
        p.fireCd = Math.min(p.fireCd, 0.12);
        return true;
      }
      case 'health':
        if (p.hp >= 100) return false;
        p.hp = Math.min(100, p.hp + 50);
        p.burnT = 0;
        return true;
      case 'grenades':
        if (p.gren >= GRENADE.max) return false;
        p.gren = Math.min(GRENADE.max, p.gren + 2);
        return true;
      case 'power':
        p.powerT = 12;
        return true;
      case 'hole':
        if (p.holes >= HOLE.max) return false;
        p.holes = HOLE.max;
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- score

  checkWin() {
    if (this.phase !== 'playing') return;
    const lim = this.s.scoreLimit;
    if (this.s.demo) {
      if (this.score.red >= lim || this.score.blue >= lim) this.score = { red: 0, blue: 0 };
      return;
    }
    if (this.teamMode) {
      if (this.score.red >= lim) this.finish('red');
      else if (this.score.blue >= lim) this.finish('blue');
    } else {
      for (const p of this.players.values()) if (p.kills >= lim) return this.finish(p.pid);
    }
  }

  leader() {
    let best = null;
    let tie = false;
    for (const p of this.players.values()) {
      if (!best || p.kills > best.kills) {
        best = p;
        tie = false;
      } else if (p.kills === best.kills) tie = true;
    }
    return best && !tie ? best.pid : 'draw';
  }

  finish(winner) {
    if (this.phase === 'ended') return;
    if (winner === undefined) {
      if (this.teamMode) {
        const { red, blue } = this.score;
        winner = red > blue ? 'red' : blue > red ? 'blue' : 'draw';
      } else winner = this.leader();
    }
    this.phase = 'ended';
    this.winner = winner;
    this.endT = 0;
    for (const p of this.players.values()) p.jetting = false;
    this.emit('end', winner);
  }
}

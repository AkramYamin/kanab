// Compact snapshot format shared by the server (encode) and the screens /
// phones (decode). Arrays instead of objects keep a full frame of the match
// to a couple of kilobytes of JSON.

import { WEAPONS } from './weapons.js';

export const WKEYS = Object.keys(WEAPONS);
export const PKINDS = ['bullet', 'rocket', 'grenade', 'flame', 'bounce'];
export const PICKUP_KINDS = ['weapon', 'health', 'grenades', 'power'];
export const FLAG_STATES = ['home', 'carried', 'dropped'];
export const PHASES = ['countdown', 'playing', 'ended'];
export const TEAMS = ['red', 'blue', 'ffa'];

const r1 = (v) => Math.round(v * 10) / 10;
const r = Math.round;

// Player: [pid, x, y, vx, vy, aim, flags, hp, weapon, ammo, gren, fuel,
//          carrying, respawnT, prot, airT, jumpAge, jumpCd, dropT, kills]
export function encodePlayer(p) {
  let f = 0;
  if (p.alive) f |= 1;
  if (p.onGround) f |= 2;
  if (p.jetting) f |= 4;
  if (p.onPlat) f |= 8;
  if (p.burnT > 0) f |= 16;
  if (p.powerT > 0) f |= 32;
  if (p.fling) f |= 64;
  if (p.teleLock) f |= 128;
  return [
    p.pid, r1(p.x), r1(p.y), r(p.vx), r(p.vy), r(p.aim * 1000) / 1000, f, Math.max(0, Math.ceil(p.hp)),
    WKEYS.indexOf(p.weapon), p.ammo === Infinity ? -1 : p.ammo, p.gren, r(p.fuel * 100),
    p.carrying === 'red' ? 1 : p.carrying === 'blue' ? 2 : 0, r1(Math.max(0, p.respawnT)), r1(p.prot),
    r(Math.min(p.airT, 9) * 1000), r(Math.min(p.jumpAge, 9) * 1000), r(p.jumpCd * 1000), r(p.dropT * 1000), p.kills,
  ];
}

export function decodePlayer(a, p) {
  p.pid = a[0];
  p.sx = a[1];
  p.sy = a[2];
  p.vx = a[3];
  p.vy = a[4];
  p.aim = a[5];
  const f = a[6];
  p.alive = !!(f & 1);
  p.onGround = !!(f & 2);
  p.jetting = !!(f & 4);
  p.onPlat = !!(f & 8);
  p.burnT = f & 16 ? 1 : 0;
  p.powerT = f & 32 ? 1 : 0;
  p.fling = !!(f & 64);
  p.teleLock = !!(f & 128);
  p.hp = a[7];
  p.weapon = WKEYS[a[8]] || 'blaster';
  p.ammo = a[9] < 0 ? Infinity : a[9];
  p.gren = a[10];
  p.fuel = a[11] / 100;
  p.carrying = a[12] === 1 ? 'red' : a[12] === 2 ? 'blue' : null;
  p.respawnT = a[13];
  p.prot = a[14];
  p.airT = a[15] / 1000;
  p.jumpAge = a[16] / 1000;
  p.jumpCd = a[17] / 1000;
  p.dropT = a[18] / 1000;
  p.kills = a[19];
  p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;
  return p;
}

// Projectile: [id, kind, weapon, x, y, vx, vy, age*100, team]
export function encodeProjectile(b) {
  return [b.id, PKINDS.indexOf(b.kind), WKEYS.indexOf(b.wkey), r1(b.x), r1(b.y), r(b.vx), r(b.vy), r(b.age * 100), TEAMS.indexOf(b.team)];
}

// Pickup: [kind, x, y, weapon, respawnLeft*10, respawnTotal, tempLeft*10 | -1]
export function encodePickup(k) {
  return [
    PICKUP_KINDS.indexOf(k.kind), k.x, r(k.y), k.weapon ? WKEYS.indexOf(k.weapon) : -1,
    Math.max(0, Math.ceil(k.t * 10)), k.respawn, k.temp === undefined ? -1 : Math.ceil(k.temp * 10),
  ];
}

export function decodePickup(a) {
  return {
    kind: PICKUP_KINDS[a[0]], x: a[1], y: a[2], weapon: a[3] >= 0 ? WKEYS[a[3]] : undefined,
    t: a[4] / 10, respawn: a[5], temp: a[6] < 0 ? undefined : a[6] / 10,
  };
}

// Flag: [x, y, state, returnT*10, carrierPid]
export function encodeFlag(f) {
  return [r1(f.x), r1(f.y), FLAG_STATES.indexOf(f.state), Math.ceil(f.returnT * 10), f.carrier || 0];
}

export function encodeSnapshot(game, tick, events, withPickups) {
  const s = {
    t: 'snap',
    k: tick,
    ph: PHASES.indexOf(game.phase),
    tl: Math.max(0, Math.ceil(game.timeLeft)),
    sc: [game.score.red, game.score.blue],
    P: [...game.players.values()].map(encodePlayer),
    B: game.projectiles.map(encodeProjectile),
    E: events,
  };
  if (game.flags) s.F = [encodeFlag(game.flags.red), encodeFlag(game.flags.blue)];
  if (withPickups) s.K = game.pickups.map(encodePickup);
  return s;
}

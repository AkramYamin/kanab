// Computer players. They produce the same input a phone does (sticks + fire
// + grenade), so the game treats bots and humans exactly alike.
//
// Navigation: the map is split into a grid of 30-unit cells. A cell is
// "passable" if a soldier fits there. Because everyone has a jetpack, bots
// path-find through the air too, but air cells cost more so they prefer to
// walk along floors and platforms.

import { WEAPONS } from './weapons.js';
import { angleDiff, rand, clamp, pick } from './util.js';
import { PHYS } from './game.js';

const CELL = 30;

export const SKILL = {
  easy: { react: 0.75, aimErr: 0.3, turn: 3.2, fireCone: 0.35, gren: 0.05, view: 900, lead: 0.3 },
  normal: { react: 0.42, aimErr: 0.13, turn: 6, fireCone: 0.22, gren: 0.12, view: 1300, lead: 0.7 },
  hard: { react: 0.2, aimErr: 0.05, turn: 11, fireCone: 0.12, gren: 0.2, view: 1800, lead: 1 },
};

export const BOT_NAMES = [
  'Bolt', 'Sparky', 'Gizmo', 'Turbo', 'Pixel', 'Widget', 'Nova', 'Zippy',
  'Rusty', 'Chip', 'Dynamo', 'Blinky', 'Sprocket', 'Echo', 'Bleep', 'Orbit',
];

export const BOT_NAMES_AR = [
  'برق', 'شرارة', 'صقر', 'تيربو', 'بكسل', 'رعد', 'نجم', 'سهم',
  'فهد', 'شهاب', 'دينامو', 'قمر', 'موج', 'صدى', 'ليث', 'مدار',
];

export function makeBot(skill, role) {
  return {
    skill, role, goal: null, path: null, pathI: 0, replanT: 0, thinkT: 0,
    targetPid: null, reactT: 0, aim: null, aimErr: 0, errT: 0, grenT: rand(2, 4),
    stuckT: 0, lastX: 0, lastY: 0, wiggleT: 0, wiggleDir: 1, blockT: 0, patrol: null,
  };
}

// ---------------------------------------------------------------- nav grid

const navCache = new WeakMap();

export function getNav(map, game) {
  let nav = navCache.get(map);
  if (!nav) {
    nav = buildNav(map, game);
    navCache.set(map, nav);
  }
  return nav;
}

function buildNav(map, game) {
  const cols = Math.ceil(map.W / CELL);
  const rows = Math.ceil(map.H / CELL);
  const n = cols * rows;
  const pass = new Uint8Array(n);
  const stand = new Uint8Array(n);
  const hw = PHYS.W / 2 - 1;
  const ph = PHYS.H + 2;
  const surfaces = [...map.solids, ...map.plats];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fx = c * CELL + CELL / 2;
      const fy = (r + 1) * CELL;
      if (fy - ph < 0 || fx - hw < 0 || fx + hw > map.W || fy > map.H) continue;
      let ok = true;
      for (const s of map.solids) {
        if (fx + hw > s.x && fx - hw < s.x + s.w && fy > s.y && fy - ph < s.y + s.h) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const i = r * cols + c;
      pass[i] = 1;
      for (const s of surfaces) {
        if (s.y >= fy && s.y < fy + CELL && fx + 6 > s.x && fx - 6 < s.x + s.w) {
          stand[i] = 1;
          break;
        }
      }
    }
  }
  const nav = {
    cols, rows, pass, stand, special: new Map(),
    g: new Float32Array(n), came: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), gen: 0,
  };
  // Shortcuts the grid can't see: teleporters and where each jump pad lands.
  const link = (a, b, cost) => {
    if (a < 0 || b < 0 || a === b) return;
    if (!nav.special.has(a)) nav.special.set(a, []);
    nav.special.get(a).push([b, cost]);
  };
  for (const t of map.teles) {
    const d = map.teles[t.to];
    link(nearCell(nav, t.x, t.y), nearCell(nav, d.x, d.y), 3);
  }
  if (game) {
    for (const pad of map.pads) {
      const land = game.simulateLaunch(pad.x, pad.y - 2, pad.vx, pad.vy);
      if (land) link(nearCell(nav, pad.x, pad.y), nearCell(nav, land.x, land.y), (Math.hypot(land.x - pad.x, land.y - pad.y) / CELL) * 0.4);
    }
  }
  return nav;
}

const nodeX = (nav, i) => (i % nav.cols) * CELL + CELL / 2;
const nodeY = (nav, i) => (((i / nav.cols) | 0) + 1) * CELL;
const adjacent = (nav, a, b) =>
  Math.abs((a % nav.cols) - (b % nav.cols)) <= 1 && Math.abs(((a / nav.cols) | 0) - ((b / nav.cols) | 0)) <= 1;

function nearCell(nav, x, y) {
  const { cols, rows } = nav;
  const c0 = clamp(Math.floor(x / CELL), 0, cols - 1);
  const r0 = clamp(Math.round(y / CELL) - 1, 0, rows - 1);
  let best = -1;
  let bestD = Infinity;
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const i = r * cols + c;
      if (!nav.pass[i]) continue;
      const d = dr * dr + dc * dc + (nav.stand[i] ? 0 : 1.5);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

// Tiny binary heap keyed by f-score.
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.v.length; }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (v.length) {
      let i = 0;
      const n = v.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.41], [-1, 1, 1.41], [1, -1, 1.41], [-1, -1, 1.41],
];

export function astar(nav, start, goal) {
  const gen = ++nav.gen;
  const { cols, rows, pass, stand, g, came, stamp, closed, special } = nav;
  const gc = goal % cols;
  const gr = (goal / cols) | 0;
  // Teleporters make the straight-line guess too optimistic to be exact, but
  // shaving it keeps A* fast and the paths good.
  const hfn = (i) => {
    const dc = Math.abs((i % cols) - gc);
    const dr = Math.abs(((i / cols) | 0) - gr);
    return (Math.max(dc, dr) + 0.41 * Math.min(dc, dr)) * (special.size ? 0.6 : 1);
  };
  const open = new Heap();
  const relax = (cur, ni, cost) => {
    if (closed[ni] === gen) return;
    const ng = g[cur] + cost;
    if (stamp[ni] !== gen || ng < g[ni]) {
      stamp[ni] = gen;
      g[ni] = ng;
      came[ni] = cur;
      open.push(ng + hfn(ni), ni);
    }
  };
  g[start] = 0;
  stamp[start] = gen;
  came[start] = -1;
  open.push(hfn(start), start);
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goal) break;
    if (++expanded > 15000) return null;
    const c = cur % cols;
    const r = (cur / cols) | 0;
    for (const [dc, dr, base] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (!pass[ni]) continue;
      if (dc && dr && (!pass[r * cols + nc] || !pass[nr * cols + c])) continue;
      relax(cur, ni, base * (stand[ni] ? 1 : 1.8) + (dr < 0 ? 0.8 : 0));
    }
    const extra = special.get(cur);
    if (extra) for (const [ni, cost] of extra) relax(cur, ni, cost);
  }
  if (closed[goal] !== gen) return null;
  const path = [];
  for (let i = goal; i !== -1; i = came[i]) path.push(i);
  return path.reverse();
}

// ------------------------------------------------------------------ brains

function nearestPickup(g, p, kinds, maxD) {
  let best = null;
  let bestD = maxD;
  for (const k of g.pickups) {
    if (k.t > 0 || !kinds.includes(k.kind)) continue;
    if (k.kind === 'health' && p.hp >= 100) continue;
    if (k.kind === 'grenades' && p.gren >= 3) continue;
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function think(g, p, b, sk) {
  // Who can I see?
  let seen = null;
  let seenD = sk.view;
  let closest = null;
  let closestD = Infinity;
  for (const o of g.players.values()) {
    if (!o.alive || !g.isEnemy(p, o)) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < closestD) {
      closestD = d;
      closest = o;
    }
    if (d < seenD && g.los(p.x, p.y - PHYS.SHOULDER, o.x, o.y - PHYS.H / 2)) {
      seenD = d;
      seen = o;
    }
  }
  const newTarget = seen ? seen.pid : null;
  if (newTarget !== b.targetPid) {
    b.targetPid = newTarget;
    b.reactT = sk.react * rand(0.7, 1.3);
  }

  // Where do I go?
  let goal = null;
  if (p.hp < 40) goal = nearestPickup(g, p, ['health'], 900);
  const flags = g.flags;
  if (!goal && flags) {
    const mine = flags[p.team];
    const theirs = flags[p.team === 'red' ? 'blue' : 'red'];
    if (p.carrying) goal = { x: mine.hx, y: mine.hy };
    else if (mine.state === 'carried') {
      const c = g.players.get(mine.carrier);
      if (c) goal = { x: c.x, y: c.y };
    } else if (mine.state === 'dropped' && (b.role === 'defend' || Math.hypot(mine.x - p.x, mine.y - p.y) < 800)) {
      goal = { x: mine.x, y: mine.y };
    }
    if (!goal && b.role === 'attack') {
      if (theirs.state === 'carried') {
        const c = g.players.get(theirs.carrier);
        if (c && c !== p) goal = { x: c.x + rand(-90, 90), y: c.y };
      } else goal = { x: theirs.x, y: theirs.y };
    }
    if (!goal && b.role === 'defend') {
      if (seen && Math.hypot(seen.x - mine.hx, seen.y - mine.hy) < 700) goal = { x: seen.x, y: seen.y };
      else {
        if (!b.patrol || Math.random() < 0.12) {
          b.patrol = { x: clamp(mine.hx + rand(-300, 300), 40, g.map.W - 40), y: mine.hy - rand(0, 220) };
        }
        goal = b.patrol;
      }
    }
  }
  if (!goal && p.weapon === 'blaster') goal = nearestPickup(g, p, ['weapon'], 650);
  if (!goal) goal = closest ? { x: closest.x, y: closest.y } : { x: g.map.W / 2, y: g.map.H / 2 };
  if (!p.carrying) {
    const near = nearestPickup(g, p, p.weapon === 'blaster' ? ['weapon', 'health', 'grenades', 'power'] : ['health', 'power', 'grenades'], 200);
    if (near) goal = near;
  }
  const moved = !b.goal || Math.hypot(goal.x - b.goal.x, goal.y - b.goal.y) > 90;
  b.goal = goal;
  if (moved) b.replanT = 0;
}

function plan(g, p, b) {
  const nav = getNav(g.map, g);
  const s = nearCell(nav, p.x, p.y);
  const e = nearCell(nav, b.goal.x, b.goal.y);
  b.path = s >= 0 && e >= 0 ? astar(nav, s, e) || [] : [];
  b.pathI = 0;
}

function steer(g, p, b, inp, dt) {
  let tx = b.goal.x;
  let ty = b.goal.y;
  const path = b.path;
  if (path && path.length) {
    const nav = getNav(g.map, g);
    // Snap to the nearest upcoming node: copes with teleports, pads and falls.
    let best = b.pathI;
    let bestD = Infinity;
    const end = Math.min(path.length - 1, b.pathI + 12);
    for (let k = b.pathI; k <= end; k++) {
      const d = Math.abs(nodeX(nav, path[k]) - p.x) + Math.abs(nodeY(nav, path[k]) - p.y) * 0.8;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    b.pathI = best;
    // Reached this node: move on, unless the next step is a portal or pad
    // (then stand on it and let it carry us).
    if (bestD < 40 && b.pathI < path.length - 1 && adjacent(nav, path[b.pathI], path[b.pathI + 1])) b.pathI++;
    let look = b.pathI;
    for (let k = 0; k < 2 && look < path.length - 1 && adjacent(nav, path[look], path[look + 1]); k++) look++;
    tx = nodeX(nav, path[look]);
    ty = nodeY(nav, path[look]);
  }
  const dx = tx - p.x;
  const dy = ty - p.y;
  let mx = Math.abs(dx) > 12 ? Math.sign(dx) * (Math.abs(dx) > 50 ? 1 : 0.55) : 0;
  let my = 0;
  if (dy < -26) my = -1;
  else if (dy > 30 && p.onGround && p.onPlat && Math.abs(dx) < 90) my = 1;

  // Bumping into a wall: hop.
  if (mx !== 0 && Math.abs(p.vx) < 40) b.blockT += dt;
  else b.blockT = 0;
  if (b.blockT > 0.12) my = -1;

  // Stuck for a while: wiggle and re-plan.
  b.stuckT += dt;
  if (b.stuckT > 1.3) {
    const far = Math.hypot(b.goal.x - p.x, b.goal.y - p.y) > 80;
    if (far && Math.hypot(p.x - b.lastX, p.y - b.lastY) < 30) {
      b.wiggleT = 0.6;
      b.wiggleDir = pick([-1, 1]);
      b.replanT = 0;
    }
    b.stuckT = 0;
    b.lastX = p.x;
    b.lastY = p.y;
  }
  if (b.wiggleT > 0) {
    b.wiggleT -= dt;
    mx = b.wiggleDir;
    my = -1;
  }
  inp.mx = mx;
  inp.my = my;
}

function combat(g, p, b, sk, inp, dt) {
  const t = b.targetPid != null ? g.players.get(b.targetPid) : null;
  const w = WEAPONS[p.weapon];
  const cur = b.aim ?? p.aim;
  inp.aiming = true;
  if (t && t.alive) {
    const sx = p.x;
    const sy = p.y - PHYS.SHOULDER;
    let tx = t.x;
    let ty = t.y - PHYS.H / 2;
    const dist = Math.hypot(tx - sx, ty - sy);
    const speed = w.kind === 'rail' ? Infinity : w.speed || 1000;
    const lead = Math.min(dist / speed, 0.6) * sk.lead;
    tx += t.vx * lead;
    ty += t.vy * lead * 0.5;
    if (w.kind === 'rocket') ty = t.y - 8;
    b.errT -= dt;
    if (b.errT <= 0) {
      b.errT = rand(0.3, 0.8);
      b.aimErr = rand(-1, 1) * sk.aimErr;
    }
    const desired = Math.atan2(ty - sy, tx - sx) + b.aimErr;
    const d = angleDiff(cur, desired);
    b.aim = cur + clamp(d, -sk.turn * dt, sk.turn * dt);
    inp.aim = b.aim;
    b.reactT -= dt;
    const range = w.kind === 'flame' ? 380 : w.pellets > 1 ? 650 : 1500;
    inp.fire = b.reactT <= 0 && Math.abs(d) < sk.fireCone && dist < range;
    b.grenT -= dt;
    if (b.grenT <= 0) {
      b.grenT = rand(1.5, 3);
      if (dist < 520 && p.gren > 0 && Math.random() < sk.gren * 2) inp.gren = (inp.gren + 1) & 255;
    }
  } else {
    inp.fire = false;
    const desired = inp.mx > 0 ? -0.08 : inp.mx < 0 ? Math.PI + 0.08 : cur;
    b.aim = cur + clamp(angleDiff(cur, desired), -4 * dt, 4 * dt);
    inp.aim = b.aim;
  }
}

export function updateBot(g, p, dt) {
  const b = p.bot;
  const inp = p.input;
  if (!p.alive || g.phase === 'ended') {
    inp.mx = inp.my = 0;
    inp.fire = false;
    b.path = null;
    b.aim = null;
    return;
  }
  const sk = SKILL[b.skill] || SKILL.normal;
  b.thinkT -= dt;
  if (b.thinkT <= 0 || !b.goal) {
    b.thinkT = rand(0.25, 0.45);
    think(g, p, b, sk);
  }
  b.replanT -= dt;
  if (b.replanT <= 0 || !b.path) {
    b.replanT = rand(0.45, 0.75);
    plan(g, p, b);
  }
  steer(g, p, b, inp, dt);
  combat(g, p, b, sk, inp, dt);
}

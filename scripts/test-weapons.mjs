// Checks the special weapons do what they say, on a flat test map:
//   node scripts/test-weapons.mjs
import { Game, STEP } from '../public/js/game.js';
import { WEAPONS, FREEZE } from '../public/js/weapons.js';

const map = {
  W: 3000, H: 1200, solids: [{ x: 0, y: 1000, w: 3000, h: 200 }], plats: [], pads: [], teles: [], pickups: [], props: [], backs: [],
  spawns: { red: [{ x: 500, y: 1000 }], blue: [{ x: 1500, y: 1000 }] }, flags: {},
};
function setup(aw, dist = 300) {
  const ev = [];
  const g = new Game(map, { mode: 'tdm', scoreLimit: 99, timeLimit: 999, aimAssist: true, demo: true }, new Proxy({}, { get: (_, k) => (...a) => ev.push([k, ...a]) }));
  const A = g.addPlayer({ pid: 1, name: 'A', color: '#f00', team: 'red' });
  const B = g.addPlayer({ pid: 2, name: 'B', color: '#00f', team: 'blue' });
  Object.assign(A, { x: 500, y: 1000, prot: 0, weapon: aw, ammo: WEAPONS[aw]?.ammo ?? Infinity, fireCd: 0 });
  Object.assign(B, { x: 500 + dist, y: 1000, prot: 0 });
  return { g, A, B, ev };
}
const run = (g, sec, fn) => { for (let i = 0; i < sec * 60; i++) { fn?.(i * STEP); g.step(STEP); } };
let fails = 0;
const check = (ok, msg) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) fails++; };

console.log('Freeze Ray');
{
  const { g, A, B, ev } = setup('freeze', 300);
  let frozenAt = null;
  run(g, 3, (t) => {
    A.input.aiming = true; A.input.aim = Math.atan2(-30, 300); A.input.fire = frozenAt === null;
    if (B.frozenT > 0 && frozenAt === null) frozenAt = t;
    B.hp = 100;
  });
  check(frozenAt !== null && frozenAt < 1.5, `B froze after ${frozenAt?.toFixed(2)} s of firing`);
  check(ev.some((e) => e[0] === 'freeze') && ev.some((e) => e[0] === 'thaw'), 'freeze and thaw events fired');
  check(B.frozenT === 0 && B.iceProt >= 0, `B thawed (frozenT=${B.frozenT.toFixed(2)})`);
}
{
  const { g, A, B } = setup('freeze', 300);
  B.frozenT = FREEZE.time;
  const x0 = B.x;
  run(g, 0.8, () => { B.input.mx = 1; B.input.my = -1; B.input.fire = true; B.input.aiming = true; B.input.aim = Math.PI; });
  check(Math.abs(B.x - x0) < 5 && B.onGround, `frozen B cannot run or jump (moved ${Math.abs(B.x - x0).toFixed(1)})`);
  check(g.projectiles.length === 0, 'frozen B cannot shoot');
  run(g, 1.2, () => { B.input.mx = 1; });
  check(B.x - x0 > 50, `after thawing B runs again (moved ${(B.x - x0).toFixed(0)})`);
}

console.log('Bee Swarm');
{
  const { g, A, B, ev } = setup('bees', 600);
  B.y = 1000;
  let hits = 0;
  run(g, 2.5, (t) => {
    A.input.aiming = true; A.input.aim = -Math.PI / 2 + 0.25; // shooting almost straight up
    A.input.fire = t < 0.05;
    B.hp = 100;
  });
  hits = ev.filter((e) => e[0] === 'hit' && e[6] === 'bees').length;
  check(hits >= 2, `bees fired upward curved and hit a target 600 px away ${hits}/3 times`);
}

console.log('Big Hammer');
{
  const { g, A, B, ev } = setup('hammer', 70);
  const bx0 = B.x;
  let maxX = B.x;
  run(g, 1.2, (t) => {
    A.input.aiming = true; A.input.aim = 0; A.input.fire = t < 0.02;
    maxX = Math.max(maxX, B.x);
  });
  check(ev.some((e) => e[0] === 'bonk'), 'bonk event fired');
  check(B.hp <= 100 - WEAPONS.hammer.dmg + 1, `hit for ${100 - B.hp} damage`);
  check(maxX - bx0 > 250, `B launched ${(maxX - bx0).toFixed(0)} px`);
}
{
  const { g, A, B } = setup('hammer', 70);
  B.frozenT = 1;
  run(g, 0.3, (t) => { A.input.aiming = true; A.input.aim = 0; A.input.fire = t < 0.02; });
  check(B.frozenT === 0 && 100 - B.hp > WEAPONS.hammer.dmg, `hammer shatters ice for ${100 - B.hp} damage`);
}

console.log('Black Hole');
{
  const { g, A, B, ev } = setup('blaster', 380);
  A.holes = 2;
  A.gren = 0;
  const ax0 = A.x;
  let minD = Infinity;
  let pulled = false;
  run(g, 3.5, (t) => {
    A.input.aiming = true; A.input.aim = -0.35;
    if (t < 0.01) A.input.gren = (A.input.gren + 1) & 255;
    const h = g.projectiles.find((b) => b.kind === 'hole' && b.active);
    if (h) { pulled = true; minD = Math.min(minD, Math.hypot(h.x - B.x, h.y - (B.y - 30))); }
    B.input.mx = 1; // tries to run away
  });
  check(A.holes === 1, 'throwing uses a black hole first');
  check(ev.some((e) => e[0] === 'hole'), 'hole opened');
  check(pulled && minD < 90, `B was dragged to ${minD.toFixed(0)} px from the center while running away`);
  check(ev.some((e) => e[0] === 'explode' && e[4] === 'hole'), 'hole popped');
  check(B.hp < 100 || !B.alive, `pop hurt B (hp ${B.hp.toFixed(0)})`);
  check(Math.abs(A.x - ax0) < 5, `thrower is not pulled (moved ${Math.abs(A.x - ax0).toFixed(1)})`);
}
{
  // Teammates are not pulled.
  const { g, A, B } = setup('blaster', 380);
  B.team = 'red';
  A.holes = 1;
  const x0 = B.x;
  run(g, 3, (t) => { A.input.aiming = true; A.input.aim = -0.35; if (t < 0.01) A.input.gren = (A.input.gren + 1) & 255; });
  check(Math.abs(B.x - x0) < 5, `teammate stays put (moved ${Math.abs(B.x - x0).toFixed(1)})`);
}
console.log('Weapons switched off in the lobby');
{
  const { MAPS } = await import('../public/js/maps.js');
  const count = (g, w) => g.pickups.filter((k) => k.weapon === w).length;
  for (const map of MAPS) {
    const all = new Game(map, { mode: 'ctf', scoreLimit: 3, timeLimit: 600 });
    const g = new Game(map, { mode: 'ctf', scoreLimit: 3, timeLimit: 600, off: ['rocket', 'bees', 'hole'] });
    const mirrored = g.pickups.every((k) => g.pickups.some((o) => o.x === map.W - k.x && o.y === k.y && o.weapon === k.weapon));
    check(count(all, 'bees') === 1 && count(g, 'bees') === 0 && count(g, 'rocket') === 0 && !g.pickups.some((k) => k.kind === 'hole'),
      `${map.id}: one bee swarm normally; rockets, bees and black holes gone when switched off`);
    check(g.pickups.filter((k) => k.kind === 'weapon').length === all.pickups.filter((k) => k.kind === 'weapon').length && mirrored,
      `${map.id}: their spots get other weapons, the same on both sides`);
  }
  const map = MAPS[0];
  const hammers = new Game(map, { mode: 'ctf', scoreLimit: 3, timeLimit: 600, off: ['shotgun', 'minigun', 'rail', 'rocket', 'flamer', 'bouncer', 'freeze', 'bees'] });
  check(hammers.pickups.filter((k) => k.kind === 'weapon').every((k) => k.weapon === 'hammer'), 'only the hammer on: every weapon spot is a hammer');
  const none = new Game(map, { mode: 'ctf', scoreLimit: 3, timeLimit: 600, off: ['shotgun', 'minigun', 'rail', 'rocket', 'flamer', 'bouncer', 'freeze', 'bees', 'hammer'] });
  check(!none.pickups.some((k) => k.kind === 'weapon') && none.pickups.some((k) => k.kind === 'health'), 'everything off: blaster only, health still there');
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);

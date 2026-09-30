// Sanity checks for every map: things sit on the ground, jump pads land
// somewhere sensible, bots can reach everything, and a bot-only CTF match
// actually produces captures.
//
//   node scripts/check-maps.mjs [mapId] [--quick]

import { MAPS } from '../public/js/maps.js';
import { Game, PHYS, STEP } from '../public/js/game.js';
import { makeBot, getNav, astar } from '../public/js/bots.js';

const only = process.argv.find((a) => !a.startsWith('-') && MAPS.some((m) => m.id === a));
const quick = process.argv.includes('--quick');
let problems = 0;
const warn = (...a) => {
  problems++;
  console.log('  ✗', ...a);
};

for (const map of MAPS) {
  if (only && map.id !== only) continue;
  console.log(`\n■ ${map.name} (${map.W}×${map.H})`);
  const g = new Game(map, { mode: 'ctf', scoreLimit: 99, timeLimit: 999, aimAssist: true });

  const blocked = (x, y) =>
    map.solids.some((s) => x + PHYS.W / 2 > s.x && x - PHYS.W / 2 < s.x + s.w && y > s.y && y - PHYS.H < s.y + s.h);
  const grounded = (x, y) => Math.abs(g.surfaceBelow(x, y - 1) - y) < 0.6;
  const points = [
    ...map.spawns.red.map((p, i) => ['spawn' + i, p.x, p.y]),
    ['flag', map.flags.red.x, map.flags.red.y],
    ...map.pickups.map((k) => [`${k.kind}${k.weapon ? ':' + k.weapon : ''}`, k.x, k.y]),
    ...map.pads.map((p, i) => ['pad' + i, p.x, p.y]),
    ...map.teles.map((t, i) => ['tele' + i, t.x, t.y]),
  ];
  for (const [name, x, y] of points) {
    if (!grounded(x, y)) warn(`${name} at ${x},${y} is not standing on a surface`);
    if (blocked(x, y)) warn(`${name} at ${x},${y} is inside a wall`);
  }

  for (const [i, pad] of map.pads.entries()) {
    const land = g.simulateLaunch(pad.x, pad.y - 2, pad.vx, pad.vy);
    const txt = land ? `lands at ${Math.round(land.x)},${Math.round(land.y)} (rise ${Math.round(pad.y - land.y)})` : 'never lands!';
    if (!land || Math.abs(land.y - pad.y) < 40) warn(`pad${i} at ${pad.x},${pad.y}: ${txt}`);
    else console.log(`  • pad${i} at ${pad.x},${pad.y}: ${txt}`);
  }

  const nav = getNav(map, g);
  const cell = (x, y) => {
    const c = Math.floor(x / 30);
    const r = Math.round(y / 30) - 1;
    for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0]]) {
      const i = (r + dr) * nav.cols + (c + dc);
      if (nav.pass[i]) return i;
    }
    return -1;
  };
  const from = cell(map.spawns.red[0].x, map.spawns.red[0].y);
  const targets = [...points, ['blue flag', map.flags.blue.x, map.flags.blue.y], ...map.spawns.blue.map((p, i) => ['bspawn' + i, p.x, p.y])];
  let reach = 0;
  for (const [name, x, y] of targets) {
    const to = cell(x, y);
    if (to < 0 || !astar(nav, from, to)) warn(`bots cannot reach ${name} at ${x},${y}`);
    else reach++;
  }
  console.log(`  • bots can reach ${reach}/${targets.length} spots  (${map.pads.length} pads, ${map.teles.length / 2} teleporter pairs, ${nav.special.size} shortcuts)`);

  if (quick) continue;
  const ev = { caps: 0, kills: 0, pads: 0, teles: 0, freezes: 0, bonks: 0, holes: 0 };
  const byWeapon = {};
  const sim = new Game(map, { mode: 'ctf', scoreLimit: 99, timeLimit: 999, aimAssist: true }, {
    flag: (k) => k === 'captured' && ev.caps++,
    kill: (k, v, w) => {
      ev.kills++;
      byWeapon[w] = (byWeapon[w] || 0) + 1;
    },
    pad: () => ev.pads++,
    tele: () => ev.teles++,
    freeze: () => ev.freezes++,
    bonk: () => ev.bonks++,
    hole: () => ev.holes++,
  });
  for (let i = 0; i < 8; i++) {
    sim.addPlayer({ pid: 1000 + i, name: 'b' + i, color: '#fff', team: i % 2 ? 'blue' : 'red', bot: makeBot('easy', i < 2 ? 'defend' : 'attack') });
  }
  const t0 = performance.now();
  const visits = new Map();
  for (let i = 0; i < 60 * 180; i++) {
    sim.step(STEP);
    if (i % 60 === 0) {
      for (const p of sim.players.values()) {
        const key = `${p.pid}:${Math.round(p.x / 60)},${Math.round(p.y / 60)}`;
        visits.set(key, (visits.get(key) || 0) + 1);
      }
    }
  }
  const camping = [...visits].filter(([, n]) => n > 45).map(([k]) => k);
  console.log(
    `  • 3 min bot CTF: ${ev.caps} captures, ${ev.kills} knockouts, ${ev.pads} pad jumps, ${ev.teles} teleports — ${Math.round(performance.now() - t0)} ms`,
  );
  const kinds = Object.entries(byWeapon).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ');
  console.log(`  • ${ev.freezes} freezes, ${ev.bonks} hammer bonks, ${ev.holes} black holes; knockouts by: ${kinds}`);
  if (ev.caps === 0) warn('no flag captures in 3 minutes');
  if (camping.length) console.log(`  • spots where a bot spent 45+ s: ${camping.join(' ')}`);
}
console.log(problems ? `\n${problems} problem(s) found.` : '\nAll maps look good.');
process.exit(problems ? 1 : 0);

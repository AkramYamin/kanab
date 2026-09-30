// Turns the server's event list into particles, sounds and UI, the same way
// on the TV and on phones. `ui` hooks are optional per screen.

import { TELE_COLORS } from './maps.js';
import { WEAPONS, SWING } from './weapons.js';
import { t } from './i18n.js';

function pickupLabel(kind, weapon) {
  if (kind === 'weapon') return WEAPONS[weapon] ? t(`w.${weapon}`) : '';
  return t(`pk.${kind}`);
}

export function playEvents(events, world, R, A, ui = {}) {
  // A hidden tab doesn't draw, so effects would pile up until it comes back.
  if (typeof document !== 'undefined' && document.hidden) return;
  const P = (pid) => world.players.get(pid);
  for (const e of events) {
    switch (e[0]) {
      case 'sh': {
        const p = P(e[1]);
        if (p) {
          p.muzzleT = 0.06;
          if (e[2] === 'hammer') {
            p.swingT = SWING;
            p.swingAng = e[5];
          }
          R.muzzle(p, e[2], e[3], e[4], e[5]);
        }
        A?.shoot(e[2], e[3]);
        break;
      }
      case 'bm':
        R.beam(e[1], e[2], e[3], e[4], e[5]);
        break;
      case 'im':
        R.impact(e[1], e[2], e[3], e[4], e[5], e[6]);
        A?.impact(e[1]);
        break;
      case 'ht': {
        const p = P(e[1]);
        if (p) {
          p.hitFlash = 1;
          R.hit(p, e[2], e[3], e[4], e[5]);
        }
        if (!e[5]) A?.hit(e[3]);
        ui.hit?.(e[1], e[2]);
        break;
      }
      case 'sd':
        R.shielded(e[1], e[2]);
        A?.shield(e[1]);
        break;
      case 'ex':
        R.explosion(e[1], e[2], e[3], e[4]);
        A?.explode(e[1], true, e[4]);
        break;
      case 'fz': {
        const p = P(e[1]);
        if (p) {
          R.freezeFx(p, t('ft.frozen'));
          A?.freeze(p.x);
        }
        break;
      }
      case 'uf': {
        const p = P(e[1]);
        if (p) {
          R.thawFx(p);
          A?.thaw(p.x);
        }
        break;
      }
      case 'bk':
        R.bonk(e[1], e[2], t('ft.bonk'));
        A?.bonk(e[1]);
        break;
      case 'ho':
        R.holeFx(e[1], e[2]);
        A?.hole(e[1]);
        break;
      case 'kl': {
        const k = P(e[1]);
        const v = P(e[2]);
        if (v) {
          R.death(v);
          A?.death(v.x);
        }
        if (k) A?.killDing();
        ui.feed?.(k, v, e[3]);
        break;
      }
      case 'sp': {
        const p = P(e[1]);
        if (p) {
          R.spawnFx(p);
          A?.spawn(p.x);
        }
        break;
      }
      case 'jp': {
        const p = P(e[1]);
        if (p) {
          R.dust(p.x, p.y, 2);
          A?.jump(p.x);
        }
        break;
      }
      case 'ld': {
        const p = P(e[1]);
        if (p) {
          R.dust(p.x, p.y, 4, 1.2);
          A?.land(p.x);
        }
        break;
      }
      case 'pk':
        R.pickupFx({ kind: e[2], weapon: e[3] || undefined, x: e[4], y: e[5] }, ui.me === e[1] && pickupLabel(e[2], e[3]));
        A?.pickup(e[2], e[4]);
        break;
      case 'fg':
        A?.flag(e[1]);
        break;
      case 'th': {
        const p = P(e[1]);
        if (p) A?.throw(p.x);
        break;
      }
      case 'bn':
        A?.clink(e[1]);
        break;
      case 'em': {
        const p = P(e[1]);
        if (p) A?.empty(p.x);
        break;
      }
      case 'pd':
        R.padFx(e[2], e[3]);
        A?.pad(e[2]);
        break;
      case 'tp': {
        const t = world.map.teles.find((q) => q.x === e[4] && q.y === e[5]);
        R.teleFx(e[2], e[3], e[4], e[5], TELE_COLORS[t ? t.color : 0]);
        A?.tele(e[2]);
        break;
      }
      case 'tk':
        ui.tick?.(e[1]);
        break;
      case 'go':
        ui.go?.();
        break;
      // Words arrive as keys and are shown/spoken in this screen's language.
      case 'sy':
        ui.say?.(t(`say.${e[1]}`, e[2]), !!e[3], e[1], e[2]);
        break;
      case 'to':
        ui.toast?.(t(`to.${e[1]}`, e[2]), e[3]);
        break;
      case 'ba': {
        const title = e[1].startsWith('title.') ? t(e[1], e[2]) : t(`ba.${e[1]}`, e[2]);
        ui.banner?.(title, e[3] ? t(`ba.${e[3]}`, e[4]) : '', e[5], e[6]);
        break;
      }
      case 'ft':
        R.banner(e[1], e[2], t(`ft.${e[3]}`), e[4]);
        break;
      case 'ff':
        ui.fanfare?.();
        break;
    }
  }
}

// Effects for a locally simulated Game (the lobby demo): same visuals, no sound.
export function demoHooks(R) {
  return {
    shoot: (p, w, x, y, ang) => R.muzzle(p, w, x, y, ang),
    beam: (x0, y0, x1, y1, c) => R.beam(x0, y0, x1, y1, c),
    impact: (x, y, nx, ny, c, kind) => R.impact(x, y, nx, ny, c, kind),
    hit: (o, amt, x, y, att, w, silent) => R.hit(o, amt, x, y, silent),
    shielded: (o, x, y) => R.shielded(x, y),
    explode: (x, y, r, w) => R.explosion(x, y, r, w),
    freeze: (p) => R.freezeFx(p),
    thaw: (p) => R.thawFx(p),
    bonk: (x, y) => R.bonk(x, y),
    hole: (b) => R.holeFx(b.x, b.y),
    kill: (k, v) => R.death(v),
    spawn: (p) => R.spawnFx(p),
    pickup: (p, k) => R.pickupFx(k),
    pad: (p, pad) => R.padFx(pad.x, pad.y),
    tele: (p, ox, oy, d) => R.teleFx(ox, oy, d.x, d.y, TELE_COLORS[d.color]),
  };
}

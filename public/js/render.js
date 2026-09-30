// Canvas renderer with a moving, zooming camera.
// Sky and distant scenery are pre-painted once per map and slide with a
// little parallax; the level itself is drawn as crisp vector shapes every
// frame so it stays sharp at any zoom. Names and numbers are drawn in screen
// space so they stay readable when the TV camera zooms far out.

import { PHYS, TEAM_COLOR } from './game.js';
import { WEAPONS } from './weapons.js';
import { TELE_COLORS } from './maps.js';
import { TAU, rand, clamp, seeded, rgba, hexToRgb, pick } from './util.js';

// Rubik covers Latin and Arabic, so player names in either script look right.
const FONT = "'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif";

// --------------------------------------------------------------- helpers

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const h = (i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

const glowCache = new Map();
function glow(color) {
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, rgba(color, 1));
    grd.addColorStop(0.22, rgba(color, 0.65));
    grd.addColorStop(0.55, rgba(color, 0.18));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
  }
  return c;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const TEAM_STYLE = {
  red: { body: '#e8434f', dark: '#8f1f2b', light: '#ff9aa0' },
  blue: { body: '#2f8cf0', dark: '#174a86', light: '#9cd0ff' },
};
const ffaStyles = new Map();
function styleFor(p) {
  if (TEAM_STYLE[p.team]) return TEAM_STYLE[p.team];
  let s = ffaStyles.get(p.color);
  if (!s) {
    s = { body: p.color, dark: mixHex(p.color, '#000000', 0.5), light: mixHex(p.color, '#ffffff', 0.45) };
    ffaStyles.set(p.color, s);
  }
  return s;
}

// Plain bullets are tinted by team so you can tell who is shooting at whom.
const TRACER = { red: '#ffa294', blue: '#94d6ff', ffa: '#fff0a0' };
const bulletColor = (b) => (b.kind === 'bullet' ? TRACER[b.team] || '#ffffff' : b.color);

const PICKUP_COLOR = { health: '#5dff8a', grenades: '#b8f060', power: '#ffcc33' };
const PAD_COLOR = '#7dffb0';

// ------------------------------------------------------------- particles

const ADDITIVE = { glow: 1, spark: 1, ring: 1 };

class Particles {
  constructor() {
    this.list = [];
  }
  add(o) {
    if (this.list.length > 2400) return null;
    o.age = 0;
    o.add = !!ADDITIVE[o.type];
    this.list.push(o);
    return o;
  }
  clear() {
    this.list.length = 0;
  }
  update(dt, map) {
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.grav) p.vy += p.grav * dt;
      if (p.drag) {
        const f = Math.exp(-p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      const ox = p.x;
      const oy = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.collide && map && solidAt(map, p.x, p.y)) {
        p.x = ox;
        p.y = oy;
        p.vy *= -0.35;
        p.vx *= 0.55;
        p.vr *= 0.5;
      }
      L[j++] = p;
    }
    L.length = j;
  }
}

function solidAt(map, x, y) {
  for (const s of map.solids) if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
  for (const pl of map.plats) if (x >= pl.x && x <= pl.x + pl.w && y >= pl.y && y <= pl.y + 8) return true;
  return false;
}

// ----------------------------------------------------------- scenery art

function paintSky(theme, cw, ch) {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, ch);
  theme.sky.forEach((col, i) => sky.addColorStop(i / (theme.sky.length - 1), col));
  g.fillStyle = sky;
  g.fillRect(0, 0, cw, ch);
  const rnd = seeded(1234);
  for (let i = 0; i < 180 * theme.stars; i++) {
    const x = rnd() * cw;
    const y = rnd() * ch * 0.55;
    g.fillStyle = `rgba(255,255,255,${((0.2 + rnd() * 0.5) * (1 - y / (ch * 0.55))).toFixed(3)})`;
    g.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const cel = theme.celestial;
  const cx = cel.x * cw;
  const cy = cel.y * ch;
  const r = cel.r * ch;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.4;
  g.drawImage(glow(cel.color), cx - r * 4, cy - r * 4, r * 8, r * 8);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = cel.color;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();
  if (cel.kind === 'moon') {
    g.fillStyle = 'rgba(150,160,200,0.3)';
    for (const [dx, dy, s] of [[-0.3, -0.2, 0.2], [0.25, 0.15, 0.14], [-0.05, 0.35, 0.11]]) {
      g.beginPath();
      g.arc(cx + dx * r, cy + dy * r, s * r, 0, TAU);
      g.fill();
    }
  }
  return c;
}

// Distant scenery strip for one parallax layer, in world units scaled by RES.
function paintLayer(map, L) {
  const RES = 0.45;
  const x0 = -map.W * 0.7;
  const x1 = map.W * 1.7;
  const top = L.base * map.H - L.amp - 80;
  const bottom = map.H * 1.8;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0) * RES);
  c.height = Math.ceil((bottom - top) * RES);
  const g = c.getContext('2d');
  g.scale(RES, RES);
  g.translate(-x0, -top);
  const rnd = seeded(L.seed * 977);
  const baseY = L.base * map.H;
  g.fillStyle = L.color;
  if (L.kind === 'city') {
    let x = x0;
    while (x < x1) {
      const bw = 90 + rnd() * 160;
      const bh = L.amp * (0.35 + rnd() * 0.65);
      const ty = baseY - bh + L.amp * 0.3;
      g.fillStyle = L.color;
      g.fillRect(x, ty, bw - 8, bottom - ty);
      if (rnd() < 0.3) g.fillRect(x + bw * 0.45, ty - 40, 4, 40);
      g.fillStyle = rgba(L.windows, 0.35);
      for (let wy = ty + 18; wy < baseY + 300; wy += 30) {
        for (let wx = x + 12; wx < x + bw - 22; wx += 22) if (rnd() < 0.1) g.fillRect(wx, wy, 9, 12);
      }
      x += bw;
    }
    return { canvas: c, x0, top, RES, par: L.par };
  }
  g.beginPath();
  g.moveTo(x0, bottom);
  const peaks = [];
  if (L.kind === 'mesas') {
    let x = x0;
    while (x < x1) {
      const w = 260 + rnd() * 420;
      const h = L.amp * (0.35 + rnd() * 0.65);
      const slope = 50 + rnd() * 70;
      g.lineTo(x, baseY);
      g.lineTo(x + slope, baseY - h);
      g.lineTo(x + w - slope, baseY - h);
      g.lineTo(x + w, baseY);
      x += w + rnd() * 160;
      g.lineTo(x, baseY);
    }
  } else if (L.kind === 'mountains') {
    let x = x0;
    while (x < x1) {
      const y = baseY - L.amp * (0.45 + rnd() * 0.55);
      g.lineTo(x, y);
      peaks.push([x, y]);
      x += 140 + rnd() * 160;
      g.lineTo(x, baseY - L.amp * (0.1 + rnd() * 0.25));
      x += 90 + rnd() * 110;
    }
  } else {
    const p1 = rnd() * 10;
    const p2 = rnd() * 10;
    for (let x = x0; x <= x1; x += 30) {
      g.lineTo(x, baseY - (Math.sin(x * 0.003 + p1) * 0.5 + Math.sin(x * 0.0081 + p2) * 0.3 + 0.7) * L.amp * 0.75);
    }
  }
  g.lineTo(x1, bottom);
  g.closePath();
  g.fill();
  if (L.snow) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [px, py] of peaks) {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + 55, py + 70);
      g.lineTo(px + 22, py + 60);
      g.lineTo(px - 10, py + 80);
      g.lineTo(px - 45, py + 62);
      g.closePath();
      g.fill();
    }
  }
  if (L.trees) {
    const tr = seeded(L.seed * 31);
    for (let x = x0; x < x1; x += 60 + tr() * 110) {
      const y = baseY - L.amp * (0.25 + tr() * 0.3);
      const s = 30 + tr() * 40;
      g.beginPath();
      g.arc(x, y - s, s * 0.7, 0, TAU);
      g.fill();
      g.fillRect(x - 4, y - s, 8, s + 40);
    }
  }
  return { canvas: c, x0, top, RES, par: L.par };
}

// Small tiles that give each style of wall its surface texture.
function makeTile(style) {
  const c = document.createElement('canvas');
  const rnd = seeded(77);
  if (style === 'building') {
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, 2, 96);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const lit = rnd();
        g.fillStyle = lit < 0.2 ? 'rgba(255,211,107,0.45)' : lit < 0.3 ? 'rgba(95,242,255,0.35)' : 'rgba(0,0,0,0.25)';
        g.fillRect(12 + k * 28, 14 + r * 30, 14, 18);
      }
    }
    return c;
  }
  if (style === 'stone') {
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 3;
    for (let r = 0; r < 2; r++) {
      g.beginPath();
      g.moveTo(0, r * 32 + 1.5);
      g.lineTo(128, r * 32 + 1.5);
      g.stroke();
      for (let x = (r % 2) * 32; x < 128; x += 64) {
        g.beginPath();
        g.moveTo(x + 1.5, r * 32);
        g.lineTo(x + 1.5, r * 32 + 32);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(90,150,70,0.35)';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(rnd() * 128, rnd() * 64, 4 + rnd() * 8, 2 + rnd() * 3, 0, 0, TAU);
      g.fill();
    }
    return c;
  }
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (style === 'ice') {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rnd() - 0.5) * 60;
        y += rnd() * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c;
  }
  // rock
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rnd() < 0.55 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 256, 3 + rnd() * 10, 2 + rnd() * 4, 0, 0, TAU);
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.1)';
  g.lineWidth = 2;
  for (let y = 40; y < 256; y += 70) {
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 32; x <= 256; x += 32) g.lineTo(x, y + (rnd() - 0.5) * 8);
    g.stroke();
  }
  return c;
}

// Top edges of walls that are not covered by another wall.
function exposedTops(map) {
  const out = [];
  for (const b of map.solids) {
    let spans = [[b.x, b.x + b.w]];
    for (const o of map.solids) {
      if (o === b || o.y >= b.y || o.y + o.h < b.y) continue;
      const next = [];
      for (const [a, z] of spans) {
        if (o.x + o.w <= a || o.x >= z) next.push([a, z]);
        else {
          if (o.x > a) next.push([a, o.x]);
          if (o.x + o.w < z) next.push([o.x + o.w, z]);
        }
      }
      spans = next;
    }
    for (const [a, z] of spans) out.push({ x0: a, x1: z, y: b.y });
  }
  return out;
}

function paintVignette(cw, ch, strength) {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.4, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(0,0,0,${strength})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, cw, ch);
  return c;
}

// ------------------------------------------------------------ weapons art

export function drawWeapon(ctx, key, t) {
  switch (key) {
    case 'blaster':
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(4, 2, 5, 8);
      ctx.fillStyle = '#d7dee8';
      rr(ctx, 0, -4.5, 25, 9, 3);
      ctx.fill();
      ctx.fillStyle = '#8b98ab';
      ctx.fillRect(23, -2.5, 11, 5);
      ctx.fillStyle = '#6ff7ff';
      ctx.fillRect(6, -6, 11, 2.5);
      break;
    case 'shotgun':
      ctx.fillStyle = '#8a5a35';
      rr(ctx, -8, -3, 16, 7, 2);
      ctx.fill();
      ctx.fillStyle = '#3c4250';
      ctx.fillRect(6, -4.5, 20, 8);
      ctx.fillStyle = '#6b7384';
      ctx.fillRect(24, -3.5, 18, 3.5);
      ctx.fillRect(24, 0.5, 18, 2.5);
      ctx.fillStyle = '#a9713f';
      ctx.fillRect(24, 2.5, 11, 4);
      break;
    case 'minigun':
      ctx.fillStyle = '#4a5160';
      rr(ctx, -4, -8, 24, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#ffae5c';
      ctx.fillRect(0, -2, 14, 3);
      ctx.fillStyle = '#9aa3b2';
      for (let i = 0; i < 3; i++) ctx.fillRect(18, -5.5 + i * 4, 28, 2.8);
      ctx.fillStyle = '#2d323d';
      ctx.fillRect(28 + ((t * 60) % 6), -7, 3, 14);
      ctx.fillRect(40, -7, 3, 14);
      break;
    case 'rail':
      ctx.fillStyle = '#2a2440';
      rr(ctx, -6, -5.5, 46, 10, 4);
      ctx.fill();
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(2, -2, 40, 3.5);
      ctx.fillStyle = '#f3e8ff';
      ctx.fillRect(2, -1, 40, 1.2);
      ctx.fillStyle = '#e9d5ff';
      ctx.fillRect(42, -3.5, 10, 7);
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(2, 4, 5, 7);
      break;
    case 'rocket':
      ctx.fillStyle = '#56613f';
      rr(ctx, -12, -7.5, 52, 14, 5);
      ctx.fill();
      ctx.fillStyle = '#2b301f';
      ctx.fillRect(38, -8.5, 8, 16);
      ctx.fillStyle = '#ff5a3d';
      ctx.fillRect(6, -7.5, 5, 14);
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(4, 6, 5, 7);
      break;
    case 'flamer':
      ctx.fillStyle = '#e67e22';
      rr(ctx, -4, 3, 20, 9, 4);
      ctx.fill();
      ctx.fillStyle = '#4a4f5c';
      ctx.fillRect(-2, -4, 32, 8);
      ctx.fillStyle = '#2e323b';
      ctx.fillRect(28, -5.5, 14, 11);
      break;
    case 'bouncer':
      ctx.fillStyle = '#2e4d3a';
      rr(ctx, -4, -6.5, 30, 13, 6);
      ctx.fill();
      ctx.fillStyle = '#1f3327';
      ctx.fillRect(25, -4.5, 13, 9);
      ctx.fillStyle = '#7dff6b';
      ctx.beginPath();
      ctx.arc(12, 0, 4.5, 0, TAU);
      ctx.fill();
      break;
  }
}

function drawFlagCloth(ctx, x, top, color, t, dir, sc = 1) {
  const w = 46 * sc;
  const h = 30 * sc;
  const seg = 8;
  ctx.beginPath();
  ctx.moveTo(x, top);
  for (let i = 1; i <= seg; i++) {
    const u = i / seg;
    ctx.lineTo(x + dir * u * w, top + Math.sin(t * 7 - u * 5) * 4 * u * sc);
  }
  for (let i = seg; i >= 0; i--) {
    const u = i / seg;
    ctx.lineTo(x + dir * u * w, top + h + Math.sin(t * 7 - u * 5 - 0.6) * 5 * u * sc);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const ex = x + dir * w * 0.45;
  const ey = top + h * 0.5 + Math.sin(t * 7 - 2.2) * 2 * sc;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 ? 4 : 9) * sc;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r);
  }
  ctx.fill();
}

// -------------------------------------------------------------- renderer

export class Renderer {
  // opts: { maxDpr, maxWidth, nameSize, textScale, vignette }
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { maxDpr: 2, maxWidth: 2880, nameSize: 17, textScale: 1, vignette: 0.38, ...opts };
    this.fx = new Particles();
    this.texts = [];
    this.beams = [];
    this.shake = 0;
    this.flash = 0;
    this.map = null;
    this.t = 0;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.view = { x0: 0, x1: 0, y0: 0, y1: 0 };
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const cssW = r.width || innerWidth;
    const cssH = r.height || innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr);
    if (cssW * dpr > this.opts.maxWidth) dpr = this.opts.maxWidth / cssW;
    this.dpr = dpr;
    this.cw = Math.max(1, Math.round(cssW * dpr));
    this.ch = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.sky = null;
    this.vignette = null;
  }

  setMap(map) {
    if (this.map === map) return;
    this.map = map;
    this.sky = null;
    this.layers = map.theme.layers.map((L) => paintLayer(map, L));
    this.tops = exposedTops(map);
    this.tile = makeTile(map.theme.solid.style);
    this.pattern = null;
    this.grads = new Map();
    this.fx.clear();
    this.texts.length = 0;
    this.beams.length = 0;
  }

  // World units -> canvas pixels for the current frame.
  sx(x) {
    return (x - this.cam.x) * this.cam.zoom + this.cw / 2;
  }

  sy(y) {
    return (y - this.cam.y) * this.cam.zoom + this.ch / 2;
  }

  inView(x, y, m = 120) {
    const v = this.view;
    return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
  }

  // ------------------------------------------------------------ effects

  muzzle(p, wkey, x, y, ang) {
    const w = WEAPONS[wkey];
    const fx = this.fx;
    fx.add({ type: 'glow', x, y, vx: 0, vy: 0, life: 0.07, size: wkey === 'flamer' ? 26 : 50, color: w.color });
    if (wkey !== 'flamer') {
      for (let i = 0; i < 2; i++) {
        const a = ang + rand(-0.3, 0.3);
        const sp = rand(300, 650);
        fx.add({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.05, 0.1), w: 2.5, color: '#fff3c4', drag: 8 });
      }
    }
    if (w.shell) {
      fx.add({
        type: 'chunk', x: p.x, y: p.y - PHYS.SHOULDER, vx: -p.facing * rand(80, 170) + p.vx * 0.5, vy: rand(-340, -200),
        grav: 1700, life: 0.9, sw: 4, sh: 2, color: wkey === 'shotgun' ? '#e05a3a' : '#ffcf5c', rot: rand(TAU), vr: rand(-20, 20), collide: true,
      });
    }
    if (wkey === 'shotgun' || wkey === 'rocket') {
      for (let i = 0; i < 2; i++) {
        fx.add({ type: 'smoke', x, y, vx: Math.cos(ang) * rand(40, 140), vy: Math.sin(ang) * rand(40, 140) - 30, life: rand(0.35, 0.6), size: rand(8, 12), grow: 2, color: '#d9d4e0', alpha: 0.3, drag: 2 });
      }
    }
  }

  impact(x, y, nx, ny, color, kind) {
    const n = kind === 'rail' ? 12 : 4;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + rand(-1.2, 1.2);
      const sp = rand(150, kind === 'rail' ? 700 : 420);
      this.fx.add({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.1, 0.25), w: 2, color, drag: 5, grav: 500 });
    }
    this.fx.add({ type: 'glow', x, y, vx: 0, vy: 0, life: 0.12, size: kind === 'rail' ? 70 : 24, color });
  }

  hit(o, amount, x, y, silent) {
    const st = styleFor(o);
    if (!silent) {
      for (let i = 0; i < 3; i++) {
        const a = rand(TAU);
        const sp = rand(120, 340);
        this.fx.add({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.1, 0.22), w: 2.5, color: st.light, drag: 6 });
      }
      for (let i = 0; i < 2; i++) {
        this.fx.add({ type: 'chunk', x, y, vx: rand(-160, 160), vy: rand(-260, -60), grav: 1400, life: rand(0.35, 0.6), sw: 3.5, sh: 3.5, color: st.body, rot: 0, vr: 0 });
      }
    }
    // Merge hits landing within half a second so a minigun doesn't paint the sky.
    const t = this.texts.find((tx) => tx.pid === o.pid && this.t - tx.born < 0.5);
    if (t) {
      t.amount += amount;
      t.age = 0;
      t.x = o.x;
      t.y = Math.min(t.y, o.y - o.h - 30);
    } else {
      this.texts.push({ pid: o.pid, born: this.t, amount, x: o.x + rand(-10, 10), y: o.y - o.h - 30, vy: -70, age: 0, life: 0.9, color: '#ffffff', size: 20 });
    }
  }

  shielded(x, y) {
    for (let i = 0; i < 4; i++) {
      const a = rand(TAU);
      this.fx.add({ type: 'spark', x, y, vx: Math.cos(a) * 250, vy: Math.sin(a) * 250, life: 0.15, w: 2, color: '#bfe6ff', drag: 6 });
    }
  }

  explosion(x, y, r) {
    const fx = this.fx;
    if (this.inView(x, y, 200)) {
      this.shake = Math.min(18, this.shake + r * 0.075);
      this.flash = Math.min(0.25, this.flash + 0.1);
    }
    fx.add({ type: 'glow', x, y, vx: 0, vy: 0, life: 0.3, size: r * 3.2, color: '#fff2c0' });
    fx.add({ type: 'glow', x, y, vx: 0, vy: 0, life: 0.5, size: r * 2.2, color: '#ff7a2d' });
    fx.add({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.4, size: r * 1.3, w: 12, color: '#ffd9a0' });
    for (let i = 0; i < 22; i++) {
      const a = rand(TAU);
      const sp = rand(350, 1100);
      fx.add({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.55), w: 3, color: pick(['#ffe08a', '#ff9a3d', '#ffffff']), drag: 3.2, grav: 700 });
    }
    for (let i = 0; i < 7; i++) {
      const a = rand(TAU);
      const sp = rand(40, 240);
      fx.add({ type: 'glow', x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: rand(0.3, 0.5), size: rand(50, 90), color: '#ff8a2d', drag: 3 });
    }
    const smoke = this.map?.theme.smoke || '#4a4452';
    for (let i = 0; i < 8; i++) {
      fx.add({ type: 'smoke', x: x + rand(-25, 25), y: y + rand(-25, 25), vx: rand(-150, 150), vy: rand(-220, -40), life: rand(0.7, 1.3), size: rand(20, 38), grow: 1.3, color: smoke, alpha: 0.45, drag: 1.6 });
    }
    const rock = this.map?.theme.solid.fill[0] || '#555';
    for (let i = 0; i < 6; i++) {
      fx.add({ type: 'chunk', x, y, vx: rand(-500, 500), vy: rand(-740, -200), grav: 1800, life: 1.2, sw: rand(4, 9), sh: rand(4, 8), color: rock, rot: rand(TAU), vr: rand(-12, 12), collide: true });
    }
  }

  death(p) {
    const st = styleFor(p);
    const x = p.x;
    const y = p.y - p.h / 2;
    const fx = this.fx;
    if (this.inView(x, y)) this.shake = Math.min(18, this.shake + 3);
    fx.add({ type: 'glow', x, y, vx: 0, vy: 0, life: 0.35, size: 170, color: st.light });
    fx.add({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.45, size: 90, w: 8, color: st.light });
    const cols = [st.body, st.dark, p.color, '#3d4658'];
    for (let i = 0; i < 14; i++) {
      fx.add({
        type: 'chunk', x: x + rand(-8, 8), y: y + rand(-14, 14), vx: rand(-420, 420) + p.vx * 0.4, vy: rand(-720, -180),
        grav: 1800, life: rand(1, 1.5), sw: rand(4, 9), sh: rand(4, 8), color: pick(cols), rot: rand(TAU), vr: rand(-14, 14), collide: true,
      });
    }
    fx.add({ type: 'chunk', x, y: p.y - p.h, vx: rand(-200, 200), vy: -800, grav: 1800, life: 1.6, sw: 16, sh: 12, color: st.body, rot: 0, vr: rand(-16, 16), collide: true });
    for (let i = 0; i < 10; i++) {
      const a = rand(TAU);
      const sp = rand(200, 600);
      fx.add({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.4), w: 3, color: p.color, drag: 4 });
    }
  }

  spawnFx(p) {
    const st = styleFor(p);
    this.fx.add({ type: 'ring', x: p.x, y: p.y - p.h / 2, vx: 0, vy: 0, life: 0.5, size: 70, w: 5, color: st.light });
    this.fx.add({ type: 'glow', x: p.x, y: p.y - p.h / 2, vx: 0, vy: 0, life: 0.4, size: 130, color: st.light });
    for (let i = 0; i < 8; i++) {
      this.fx.add({ type: 'spark', x: p.x + rand(-16, 16), y: p.y, vx: 0, vy: rand(-500, -200), life: rand(0.2, 0.4), w: 2.5, color: st.light, drag: 3 });
    }
  }

  dust(x, y, n = 4, big = 1) {
    const col = this.map?.themeId === 'frost' ? '#ffffff' : '#c7b8c9';
    for (let i = 0; i < n; i++) {
      this.fx.add({ type: 'smoke', x: x + rand(-12, 12), y: y - 4, vx: rand(-140, 140) * big, vy: rand(-80, -10), life: rand(0.3, 0.55), size: rand(5, 9) * big, grow: 1.6, color: col, alpha: 0.35, drag: 4 });
    }
  }

  padFx(x, y) {
    this.fx.add({ type: 'ring', x, y: y - 6, vx: 0, vy: 0, life: 0.35, size: 60, w: 6, color: PAD_COLOR });
    for (let i = 0; i < 10; i++) {
      this.fx.add({ type: 'spark', x: x + rand(-28, 28), y: y - 4, vx: rand(-40, 40), vy: rand(-700, -300), life: rand(0.2, 0.4), w: 2.5, color: PAD_COLOR, drag: 3 });
    }
  }

  teleFx(x0, y0, x1, y1, color) {
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      this.fx.add({ type: 'glow', x, y: y - 44, vx: 0, vy: 0, life: 0.4, size: 160, color });
      this.fx.add({ type: 'ring', x, y: y - 44, vx: 0, vy: 0, life: 0.4, size: 70, w: 6, color });
      for (let i = 0; i < 10; i++) {
        const a = rand(TAU);
        this.fx.add({ type: 'spark', x, y: y - 44, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 0.3, w: 2.5, color, drag: 4 });
      }
    }
  }

  // label: text to float above the pickup (or nothing).
  pickupFx(k, label) {
    const color = k.kind === 'weapon' ? WEAPONS[k.weapon].color : PICKUP_COLOR[k.kind];
    this.fx.add({ type: 'ring', x: k.x, y: k.y - 30, vx: 0, vy: 0, life: 0.4, size: 60, w: 5, color });
    for (let i = 0; i < 10; i++) {
      const a = rand(TAU);
      this.fx.add({ type: 'spark', x: k.x, y: k.y - 30, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 0.3, w: 2.5, color, drag: 5 });
    }
    if (label) this.texts.push({ label, x: k.x, y: k.y - 80, vy: -45, age: 0, life: 1.2, color, size: 18 });
  }

  beam(x0, y0, x1, y1, color) {
    this.beams.push({ x0, y0, x1, y1, color, age: 0, life: 0.4 });
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.min(30, len / 50);
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      this.fx.add({ type: 'glow', x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, vx: rand(-40, 40), vy: rand(-60, 20), life: rand(0.3, 0.5), size: rand(10, 18), color });
    }
  }

  banner(x, y, label, color) {
    this.texts.push({ label, x, y, vy: -30, age: 0, life: 1.6, color, size: 26 });
  }

  // -------------------------------------------------------------- frame

  frame(world, cam, dt, t, overlay) {
    if (!this.map) return;
    if (!this.sky) {
      this.sky = paintSky(this.map.theme, this.cw, this.ch);
      this.vignette = paintVignette(this.cw, this.ch, this.opts.vignette);
    }
    this.t = t;
    const z = cam.zoom;
    this.cam = cam;
    this.view = {
      x0: cam.x - this.cw / 2 / z, x1: cam.x + this.cw / 2 / z,
      y0: cam.y - this.ch / 2 / z, y1: cam.y + this.ch / 2 / z,
    };
    for (const p of world.players.values()) if (p.onGround) p.runPhase = (p.runPhase || 0) + Math.abs(p.vx) * dt * 0.052;
    this.emitContinuous(world);
    this.fx.update(dt, this.map);
    for (const tx of this.texts) {
      tx.age += dt;
      tx.y += tx.vy * dt;
    }
    this.texts = this.texts.filter((tx) => tx.age < tx.life);
    for (const b of this.beams) b.age += dt;
    this.beams = this.beams.filter((b) => b.age < b.life);
    this.shake = Math.max(0, this.shake - dt * 45);
    this.flash = Math.max(0, this.flash - dt * 1.4);

    const ctx = this.ctx;
    const sh = this.shake;
    const jx = sh ? rand(-sh, sh) : 0;
    const jy = sh ? rand(-sh, sh) : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.sky, 0, 0);
    this.drawLayers(ctx, cam);

    ctx.setTransform(z, 0, 0, z, this.cw / 2 - cam.x * z + jx * z, this.ch / 2 - cam.y * z + jy * z);
    this.drawLevel(ctx, t);
    if (world.flags) for (const f of [world.flags.red, world.flags.blue]) this.drawFlagBase(ctx, f, t);
    this.drawPads(ctx, t);
    this.drawTeles(ctx, t);
    this.drawPickups(ctx, world, t);
    if (world.flags) {
      for (const f of [world.flags.red, world.flags.blue]) if (f.state !== 'carried') this.drawFlag(ctx, f, t);
    }
    for (const p of world.players.values()) if (p.alive && this.inView(p.x, p.y)) this.drawSoldier(ctx, p, t);
    this.drawProjectiles(ctx, world);
    this.drawParticles(ctx);
    this.drawBeams(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawNames(ctx, world);
    this.drawTexts(ctx);
    if (overlay) overlay(ctx, this);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0);
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,220,180,${this.flash.toFixed(3)})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawLayers(ctx, cam) {
    const map = this.map;
    const fit = Math.min(this.cw / map.W, this.ch / map.H);
    for (const L of this.layers) {
      const ls = fit * Math.pow(Math.max(1, cam.zoom / fit), L.par);
      const lcx = map.W / 2 + (cam.x - map.W / 2) * L.par;
      const lcy = map.H / 2 + (cam.y - map.H / 2) * L.par;
      const s = ls / L.RES;
      ctx.setTransform(s, 0, 0, s, this.cw / 2 + (L.x0 - lcx) * ls, this.ch / 2 + (L.top - lcy) * ls);
      ctx.drawImage(L.canvas, 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = map.theme.haze;
    ctx.fillRect(0, 0, this.cw, this.ch);
  }

  drawLevel(ctx, t) {
    const map = this.map;
    const th = map.theme;
    const v = this.view;
    const vis = (x, y, w, h) => x < v.x1 + 50 && x + w > v.x0 - 50 && y < v.y1 + 50 && y + h > v.y0 - 50;
    if (!this.pattern) this.pattern = ctx.createPattern(this.tile, 'repeat');

    // Beyond the map edges (odd screen shapes): solid bedrock, not sky.
    ctx.fillStyle = mixHex(th.solid.fill[1], '#000000', 0.35);
    if (v.y1 > map.H) ctx.fillRect(v.x0 - 60, map.H, v.x1 - v.x0 + 120, v.y1 - map.H + 60);
    if (v.x0 < 0) ctx.fillRect(v.x0 - 60, v.y0 - 60, -v.x0 + 60, v.y1 - v.y0 + 120);
    if (v.x1 > map.W) ctx.fillRect(map.W, v.y0 - 60, v.x1 - map.W + 60, v.y1 - v.y0 + 120);

    ctx.fillStyle = th.back;
    for (const b of map.backs) if (vis(b.x, b.y, b.w, b.h)) ctx.fillRect(b.x, b.y, b.w, b.h);
    for (const pr of map.props) if (pr.kind === 'column' && vis(pr.x - 40, pr.y - pr.arg, 80, pr.arg)) this.drawProp(ctx, pr, t);

    for (const s of map.solids) {
      if (!vis(s.x, s.y, s.w, s.h)) continue;
      let grd = this.grads.get(s);
      if (!grd) {
        grd = ctx.createLinearGradient(0, s.y, 0, s.y + Math.min(s.h, 420));
        grd.addColorStop(0, th.solid.fill[0]);
        grd.addColorStop(1, th.solid.fill[1]);
        this.grads.set(s, grd);
      }
      ctx.fillStyle = grd;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = this.pattern;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    ctx.strokeStyle = th.solid.rim;
    ctx.lineWidth = 3;
    for (const s of map.solids) if (vis(s.x, s.y, s.w, s.h)) ctx.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);

    const top = th.solid.top;
    for (const e of this.tops) {
      if (!vis(e.x0, e.y - 10, e.x1 - e.x0, 20)) continue;
      const w = e.x1 - e.x0;
      switch (th.solid.topStyle) {
        case 'neon':
          ctx.fillStyle = rgba(top, 0.22);
          ctx.fillRect(e.x0, e.y - 4, w, 10);
          ctx.fillStyle = top;
          ctx.fillRect(e.x0, e.y - 1, w, 3.5);
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillRect(e.x0, e.y, w, 1.2);
          break;
        case 'snow':
          ctx.fillStyle = '#ffffff';
          rr(ctx, e.x0 - 2, e.y - 7, w + 4, 14, 6);
          ctx.fill();
          ctx.fillStyle = 'rgba(120,170,210,0.4)';
          ctx.fillRect(e.x0, e.y + 6, w, 2);
          break;
        case 'grass':
          ctx.fillStyle = mixHex(top, '#000000', 0.3);
          ctx.fillRect(e.x0, e.y, w, 10);
          ctx.fillStyle = top;
          ctx.beginPath();
          ctx.moveTo(e.x0, e.y - 3);
          ctx.lineTo(e.x1, e.y - 3);
          ctx.lineTo(e.x1, e.y + 5);
          for (let x = e.x1; x > e.x0; x -= 14) ctx.quadraticCurveTo(x - 7, e.y + 11, Math.max(e.x0, x - 14), e.y + 5);
          ctx.closePath();
          ctx.fill();
          break;
        default:
          ctx.fillStyle = mixHex(top, '#000000', 0.35);
          ctx.fillRect(e.x0, e.y, w, 9);
          ctx.fillStyle = top;
          ctx.fillRect(e.x0, e.y - 2, w, 5);
      }
    }

    const pc = th.plat;
    for (const p of map.plats) {
      if (!vis(p.x, p.y - 10, p.w, 40)) continue;
      if (pc.neon) {
        ctx.fillStyle = rgba(pc.top, 0.18);
        rr(ctx, p.x - 5, p.y - 5, p.w + 10, 26, 9);
        ctx.fill();
      }
      ctx.fillStyle = pc.body;
      rr(ctx, p.x, p.y, p.w, 16, 6);
      ctx.fill();
      ctx.strokeStyle = pc.edge;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = pc.top;
      rr(ctx, p.x + 2, p.y - 1, p.w - 4, 4, 2);
      ctx.fill();
      if (th.solid.topStyle === 'snow') {
        ctx.fillStyle = '#ffffff';
        rr(ctx, p.x - 1, p.y - 5, p.w + 2, 7, 3);
        ctx.fill();
      }
    }
    for (const pr of map.props) if (pr.kind !== 'column' && vis(pr.x - 60, pr.y - 170, 120, 180)) this.drawProp(ctx, pr, t);
  }

  drawProp(ctx, pr, t) {
    const { x, y } = pr;
    const th = this.map.theme;
    switch (pr.kind) {
      case 'column': {
        const h = pr.arg;
        ctx.fillStyle = mixHex(th.solid.fill[1], '#000000', 0.25);
        ctx.fillRect(x - 30, y - h, 60, h);
        ctx.fillStyle = mixHex(th.solid.fill[1], '#000000', 0.4);
        ctx.fillRect(x - 38, y - h, 76, 16);
        ctx.fillRect(x - 38, y - 16, 76, 16);
        break;
      }
      case 'banner': {
        const color = pr.side < 0 ? TEAM_COLOR.red : pr.side > 0 ? TEAM_COLOR.blue : '#ffcc4d';
        const dir = pr.side > 0 ? -1 : 1;
        ctx.fillStyle = '#d8d8e0';
        ctx.fillRect(x - 2, y - 120, 4, 120);
        ctx.fillStyle = color;
        const sway = Math.sin(t * 2 + x) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y - 116);
        ctx.lineTo(x + dir * (30 + sway), y - 112);
        ctx.lineTo(x + dir * (26 + sway), y - 78);
        ctx.lineTo(x + dir * (16 + sway), y - 70);
        ctx.lineTo(x, y - 76);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'lamp':
      case 'torch': {
        const torch = pr.kind === 'torch';
        ctx.fillStyle = torch ? '#5a4030' : '#3a3f55';
        ctx.fillRect(x - 3, y - (torch ? 60 : 110), 6, torch ? 60 : 110);
        const ly = y - (torch ? 66 : 114);
        const color = torch ? '#ffae4d' : th.solid.topStyle === 'neon' ? '#ff9af0' : '#ffe2a8';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = torch ? 0.5 + Math.sin(t * 13 + x) * 0.08 : 0.45;
        ctx.drawImage(glow(color), x - 50, ly - 50, 100, 100);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, ly, torch ? 7 : 8, 0, TAU);
        ctx.fill();
        break;
      }
      case 'antenna':
        ctx.fillStyle = '#6a7090';
        ctx.fillRect(x - 2, y - 130, 4, 130);
        ctx.fillRect(x - 16, y - 100, 32, 3);
        if (Math.sin(t * 3 + x) > 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(glow('#ff3b3b'), x - 14, y - 144, 28, 28);
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      case 'crate':
        ctx.fillStyle = '#9a6b3e';
        ctx.fillRect(x - 22, y - 44, 44, 44);
        ctx.strokeStyle = '#5a3a1e';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - 20.5, y - 42.5, 41, 41);
        ctx.beginPath();
        ctx.moveTo(x - 20, y - 42);
        ctx.lineTo(x + 20, y - 2);
        ctx.stroke();
        break;
      case 'cactus':
        ctx.fillStyle = '#4f7d4a';
        rr(ctx, x - 9, y - 90, 18, 90, 9);
        ctx.fill();
        rr(ctx, x - 30, y - 64, 12, 34, 6);
        ctx.fill();
        rr(ctx, x - 30, y - 40, 26, 12, 6);
        ctx.fill();
        rr(ctx, x + 18, y - 76, 12, 30, 6);
        ctx.fill();
        rr(ctx, x + 4, y - 52, 26, 12, 6);
        ctx.fill();
        break;
      case 'pine':
        ctx.fillStyle = '#2f5a52';
        for (let i = 0; i < 3; i++) {
          const w = 46 - i * 12;
          const ty = y - 30 - i * 34;
          ctx.beginPath();
          ctx.moveTo(x - w, ty);
          ctx.lineTo(x, ty - 50);
          ctx.lineTo(x + w, ty);
          ctx.fill();
        }
        ctx.fillStyle = '#5a4030';
        ctx.fillRect(x - 5, y - 30, 10, 30);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(x - 12, y - 148);
        ctx.lineTo(x, y - 164);
        ctx.lineTo(x + 12, y - 148);
        ctx.fill();
        break;
      case 'palm':
        ctx.strokeStyle = '#7a5a3a';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 14, y - 80, x + 4, y - 150);
        ctx.stroke();
        ctx.fillStyle = '#3f8a4a';
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.62 + Math.sin(t * 1.5 + i) * 0.04;
          ctx.save();
          ctx.translate(x + 4, y - 150);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.ellipse(40, 0, 44, 10, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        break;
    }
  }

  drawPads(ctx, t) {
    for (const pad of this.map.pads) {
      if (!this.inView(pad.x, pad.y)) continue;
      ctx.fillStyle = '#2b3140';
      rr(ctx, pad.x - 34, pad.y - 9, 68, 9, 3);
      ctx.fill();
      ctx.fillStyle = PAD_COLOR;
      ctx.fillRect(pad.x - 28, pad.y - 10, 56, 3);
      // Chevrons drifting in the launch direction.
      const a = Math.atan2(pad.vy, pad.vx || 0.0001);
      ctx.save();
      ctx.translate(pad.x, pad.y - 14);
      ctx.rotate(a + Math.PI / 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = PAD_COLOR;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.6 + i / 3) % 1;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        const yy = -k * 50;
        ctx.beginPath();
        ctx.moveTo(-14, yy + 8);
        ctx.lineTo(0, yy - 4);
        ctx.lineTo(14, yy + 8);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawTeles(ctx, t) {
    for (const tp of this.map.teles) {
      if (!this.inView(tp.x, tp.y)) continue;
      const color = TELE_COLORS[tp.color] || TELE_COLORS[0];
      const cx = tp.x;
      const cy = tp.y - 46;
      ctx.fillStyle = '#2b3140';
      rr(ctx, cx - 32, tp.y - 7, 64, 7, 3);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + Math.sin(t * 3 + tp.x) * 0.08;
      ctx.drawImage(glow(color), cx - 60, cy - 70, 120, 140);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 24, 42, 0, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 2; i++) {
        const a = t * (i ? -2.4 : 3) + i * 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 14 - i * 5, 30 - i * 10, 0, a, a + 2.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  emitContinuous(world) {
    const fx = this.fx;
    for (const p of world.players.values()) {
      if (!p.alive || !this.inView(p.x, p.y)) continue;
      if (p.jetting) {
        const nx = p.x - p.facing * 15;
        const ny = p.y - 24;
        fx.add({ type: 'glow', x: nx + rand(-2, 2), y: ny, vx: rand(-40, 40) + p.vx * 0.2, vy: rand(300, 480), life: rand(0.12, 0.2), size: rand(18, 26), color: '#ff7a2d' });
        fx.add({ type: 'glow', x: nx, y: ny, vx: rand(-20, 20), vy: rand(250, 400), life: 0.1, size: 14, color: '#ffd27a' });
      }
      if (p.burnT > 0 && Math.random() < 0.7) {
        fx.add({ type: 'glow', x: p.x + rand(-12, 12), y: p.y - rand(8, 50), vx: rand(-20, 20), vy: rand(-160, -60), life: rand(0.2, 0.35), size: rand(16, 24), color: pick(['#ff9a3d', '#ffd27a', '#ff5a2d']) });
      }
      if (p.powerT > 0 && Math.random() < 0.25) {
        fx.add({ type: 'spark', x: p.x + rand(-16, 16), y: p.y - rand(0, 52), vx: 0, vy: -120, life: 0.4, w: 2, color: '#ffe066' });
      }
    }
    for (const b of world.projectiles) {
      if (!this.inView(b.x, b.y)) continue;
      if (b.kind === 'rocket') {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const bx = b.x - (b.vx / sp) * 12;
        const by = b.y - (b.vy / sp) * 12;
        fx.add({ type: 'glow', x: bx, y: by, vx: 0, vy: 0, life: 0.12, size: 30, color: '#ffb35c' });
        if (Math.random() < 0.6) fx.add({ type: 'smoke', x: bx, y: by, vx: rand(-25, 25), vy: rand(-40, 0), life: rand(0.4, 0.7), size: 6, grow: 2.2, color: '#ddd6e6', alpha: 0.35, drag: 1.5 });
      } else if (b.kind === 'bounce') {
        fx.add({ type: 'glow', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.16, size: 16, color: '#7dff6b' });
      }
    }
  }

  drawFlagBase(ctx, f, t) {
    if (!this.inView(f.hx, f.hy)) return;
    const color = TEAM_COLOR[f.team];
    const home = f.state === 'home';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = home ? 0.55 + 0.2 * Math.sin(t * 3) : 0.25;
    ctx.translate(f.hx, f.hy);
    ctx.scale(1, 0.3);
    ctx.drawImage(glow(color), -90, -90, 180, 180);
    ctx.restore();
    ctx.fillStyle = TEAM_STYLE[f.team].dark;
    rr(ctx, f.hx - 36, f.hy - 5, 72, 7, 3);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(f.hx - 34, f.hy - 5, 68, 2);
    if (!home) {
      ctx.strokeStyle = rgba(color, 0.6);
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(f.hx - 10, f.hy - 82, 20, 76);
      ctx.setLineDash([]);
    }
  }

  drawFlag(ctx, f, t) {
    if (!this.inView(f.x, f.y)) return;
    const color = TEAM_COLOR[f.team];
    const dir = f.team === 'red' ? 1 : -1;
    if (f.state === 'dropped') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 8);
      ctx.drawImage(glow(color), f.x - 60, f.y - 100, 120, 120);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y - 104, 11, -Math.PI / 2, -Math.PI / 2 + TAU * (f.returnT / 15));
      ctx.stroke();
    }
    ctx.strokeStyle = '#e9e9ef';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x, f.y - 84);
    ctx.stroke();
    ctx.fillStyle = '#ffd35c';
    ctx.beginPath();
    ctx.arc(f.x, f.y - 86, 4, 0, TAU);
    ctx.fill();
    drawFlagCloth(ctx, f.x, f.y - 82, color, t, dir);
  }

  drawPickups(ctx, world, t) {
    for (const k of world.pickups) {
      if (!this.inView(k.x, k.y)) continue;
      const bob = Math.sin(t * 3 + k.x * 0.01) * 5;
      const cx = k.x;
      const cy = k.y - 32 + bob;
      const color = k.kind === 'weapon' ? WEAPONS[k.weapon].color : PICKUP_COLOR[k.kind];
      if (k.temp === undefined) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(k.x, k.y - 1, 18, 4, 0, 0, TAU);
        ctx.fill();
      }
      if (k.t > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k.t / k.respawn));
        ctx.stroke();
        continue;
      }
      if (k.temp !== undefined && k.temp < 3 && Math.sin(t * 20) < 0) continue;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.12 * Math.sin(t * 4 + k.x);
      ctx.drawImage(glow(color), cx - 40, cy - 40, 80, 80);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(cx, cy);
      if (k.kind === 'weapon') {
        const w = WEAPONS[k.weapon];
        ctx.scale(1.15, 1.15);
        ctx.translate(-w.len / 2, 0);
        drawWeapon(ctx, k.weapon, t);
      } else if (k.kind === 'health') {
        ctx.fillStyle = '#ffffff';
        rr(ctx, -13, -13, 26, 26, 7);
        ctx.fill();
        ctx.fillStyle = '#ff4d5e';
        ctx.fillRect(-3.5, -9, 7, 18);
        ctx.fillRect(-9, -3.5, 18, 7);
      } else if (k.kind === 'grenades') {
        for (const dx of [-7, 7]) {
          ctx.fillStyle = '#4d6b3c';
          ctx.beginPath();
          ctx.arc(dx, 2, 7.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#c9d1a9';
          ctx.fillRect(dx - 2, -9, 4, 5);
        }
      } else if (k.kind === 'power') {
        ctx.rotate(t * 1.5);
        ctx.fillStyle = '#ffcc33';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 7 : 16;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.fill();
        ctx.rotate(-t * 1.5);
        ctx.fillStyle = '#5a3a00';
        ctx.font = `800 11px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2×', 0, 1);
      }
      ctx.restore();
    }
  }

  drawLeg(ctx, hx, hy, a, k, color) {
    const L = 11;
    const kx = hx + Math.sin(a) * L;
    const ky = hy + Math.cos(a) * L;
    const b = a - k;
    const fx = kx + Math.sin(b) * L;
    const fy = ky + Math.cos(b) * L;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = '#1b1f29';
    rr(ctx, fx - 4, fy - 3, 11, 5.5, 2);
    ctx.fill();
  }

  drawSoldier(ctx, p, t) {
    const st = styleFor(p);
    const f = p.facing;
    const fl = p.hitFlash;
    const body = fl > 0 ? mixHex(st.body, '#ffffff', fl * 0.75) : st.body;
    const dark = fl > 0 ? mixHex(st.dark, '#ffffff', fl * 0.5) : st.dark;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(PHYS.SCALE, PHYS.SCALE);
    if (p.onGround) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 1, 17, 4, 0, 0, TAU);
      ctx.fill();
    }
    if (p.powerT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      const sz = 120 + Math.sin(t * 10) * 12;
      ctx.drawImage(glow('#ffc233'), -sz / 2, -28 - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Body (drawn facing right, mirrored when facing left).
    ctx.save();
    ctx.scale(f, 1);
    let a1;
    let a2;
    let k1;
    let k2;
    if (p.onGround && Math.abs(p.vx) > 25) {
      const ph = p.runPhase || 0;
      const dirSign = Math.sign(p.vx) === f ? 1 : -1;
      a1 = Math.sin(ph) * 0.85 * dirSign;
      a2 = -a1;
      k1 = Math.max(0, Math.cos(ph));
      k2 = Math.max(0, -Math.cos(ph));
    } else if (!p.onGround) {
      if (p.jetting) { a1 = 0.15; a2 = -0.2; k1 = 0.3; k2 = 0.4; } else { a1 = 0.6; a2 = -0.25; k1 = 1.1; k2 = 0.55; }
    } else { a1 = 0.1; a2 = -0.1; k1 = 0.06; k2 = 0.06; }
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.drawLeg(ctx, -2, -21, a2, k2, mixHex(dark, '#000000', 0.25));
    ctx.fillStyle = '#3d4658';
    rr(ctx, -19, -44, 10, 22, 3);
    ctx.fill();
    ctx.fillStyle = '#252b38';
    ctx.fillRect(-18, -24, 8, 5);
    ctx.fillStyle = body;
    ctx.fillRect(-17, -41, 6, 3);
    ctx.fillStyle = body;
    rr(ctx, -10, -45, 20, 27, 6);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-10, -25, 20, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    rr(ctx, -5, -42, 10, 8, 3);
    ctx.fill();
    this.drawLeg(ctx, 2, -21, a1, k1, dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(1, -53, 10.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-7, -64, 11, 3.5);
    ctx.fillStyle = p.color;
    rr(ctx, 1, -57, 11, 7.5, 3.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(4, -55.5, 4, 2);
    ctx.restore();

    if (p.carrying) {
      const fc = TEAM_COLOR[p.carrying];
      const px = -f * 13;
      ctx.strokeStyle = '#e9e9ef';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, -26);
      ctx.lineTo(px, -92);
      ctx.stroke();
      drawFlagCloth(ctx, px, -92, fc, t * 1.6, -f, 0.72);
    }

    // Arm + weapon, rotated to the aim.
    ctx.save();
    ctx.translate(f * 1, -34);
    ctx.rotate(p.aim);
    if (f < 0) ctx.scale(1, -1);
    if (p.muzzleT > 0) ctx.translate(-3, 0);
    ctx.lineCap = 'round';
    ctx.strokeStyle = mixHex(dark, '#000000', 0.2);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(15, 4);
    ctx.stroke();
    drawWeapon(ctx, p.weapon, t);
    ctx.strokeStyle = body;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-4, 1);
    ctx.lineTo(8, 3);
    ctx.stroke();
    ctx.fillStyle = '#2a2f3a';
    ctx.beginPath();
    ctx.arc(9, 3, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (p.prot > 0) {
      const a = 0.35 + 0.25 * Math.sin(t * 14);
      ctx.strokeStyle = rgba(st.light, a);
      ctx.fillStyle = rgba(st.light, 0.08);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, -28, 40, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Screen space: fixed pixel size whatever the zoom.
  drawNames(ctx, world) {
    const d = this.dpr;
    const size = Math.round(this.opts.nameSize * d);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const p of world.players.values()) {
      if (!p.alive || !this.inView(p.x, p.y, 40)) continue;
      const x = this.sx(p.x);
      const y = this.sy(p.y - p.h - 8) - size * 0.9;
      const label = p.bot ? `🤖 ${p.name}` : p.name;
      ctx.globalAlpha = p.bot ? 0.8 : 1;
      ctx.lineWidth = 4 * d;
      ctx.strokeStyle = 'rgba(8,10,20,0.7)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(label, x, y);
      ctx.globalAlpha = 1;
      const hw = size * 1.2;
      const frac = clamp(p.hp / 100, 0, 1);
      ctx.fillStyle = 'rgba(8,10,20,0.6)';
      rr(ctx, x - hw - 1.5 * d, y + 4 * d, hw * 2 + 3 * d, 6 * d, 3 * d);
      ctx.fill();
      ctx.fillStyle = frac > 0.6 ? '#5dff8a' : frac > 0.3 ? '#ffd35c' : '#ff4d5e';
      rr(ctx, x - hw, y + 5.5 * d, hw * 2 * frac, 3 * d, 1.5 * d);
      ctx.fill();
      if (!p.bot && p.prot > 0) {
        // Bouncing arrow so a kid can spot "that's me!" right after spawning.
        const ay = y - size * 1.4 - Math.abs(Math.sin(this.t * 7)) * 10 * d;
        const s = size * 0.7;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = 'rgba(8,10,20,0.7)';
        ctx.lineWidth = 3 * d;
        ctx.beginPath();
        ctx.moveTo(x - s, ay - s);
        ctx.lineTo(x + s, ay - s);
        ctx.lineTo(x, ay + s * 0.4);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
    }
  }

  drawProjectiles(ctx, world) {
    ctx.lineCap = 'round';
    for (const b of world.projectiles) {
      if (!this.inView(b.x, b.y)) continue;
      switch (b.kind) {
        case 'bullet': {
          const color = bulletColor(b);
          const k = b.wkey === 'shotgun' ? 0.014 : 0.022;
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = color;
          ctx.lineWidth = b.wkey === 'minigun' ? 3 : 3.8;
          ctx.beginPath();
          ctx.moveTo(b.x - b.vx * k, b.y - b.vy * k);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(b.x - b.vx * k * 0.4, b.y - b.vy * k * 0.4);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.drawImage(glow(color), b.x - 10, b.y - 10, 20, 20);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'rocket': {
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(Math.atan2(b.vy, b.vx));
          ctx.fillStyle = '#e8e8ee';
          rr(ctx, -12, -4, 20, 8, 3);
          ctx.fill();
          ctx.fillStyle = '#ff5a3d';
          ctx.beginPath();
          ctx.moveTo(8, -4);
          ctx.lineTo(15, 0);
          ctx.lineTo(8, 4);
          ctx.fill();
          ctx.fillStyle = '#6b7384';
          ctx.fillRect(-12, -7, 5, 14);
          ctx.restore();
          break;
        }
        case 'grenade': {
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.age * 12 * Math.sign(b.vx || 1));
          ctx.fillStyle = '#3f5c33';
          ctx.beginPath();
          ctx.arc(0, 0, 6.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#c9d1a9';
          ctx.fillRect(-2, -10, 4, 4);
          ctx.restore();
          if (Math.sin(b.age * (8 + b.age * 22)) > 0) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(glow('#ff3b3b'), b.x - 14, b.y - 14, 28, 28);
            ctx.globalCompositeOperation = 'source-over';
          }
          break;
        }
        case 'flame': {
          const k = clamp(b.age / 0.5, 0, 1);
          const col = k < 0.3 ? '#ffe08a' : k < 0.65 ? '#ff9a3d' : '#ff4b2d';
          const sz = 16 + k * 64;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - k * 0.8;
          ctx.drawImage(glow(col), b.x - sz / 2, b.y - sz / 2, sz, sz);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'bounce':
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(glow('#7dff6b'), b.x - 20, b.y - 20, 40, 40);
          ctx.drawImage(glow('#ffffff'), b.x - 7, b.y - 7, 14, 14);
          ctx.globalCompositeOperation = 'source-over';
          break;
      }
    }
  }

  drawParticles(ctx) {
    const L = this.fx.list;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (p.add || !this.inView(p.x, p.y)) continue;
      const k = p.age / p.life;
      if (p.type === 'smoke') {
        ctx.globalAlpha = (1 - k) * (p.alpha ?? 0.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + k * (p.grow || 0)), 0, TAU);
        ctx.fill();
      } else {
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.fillStyle = p.color;
        if (p.rot) {
          const c = Math.cos(p.rot);
          const s = Math.sin(p.rot);
          const cur = ctx.getTransform();
          ctx.transform(c, s, -s, c, p.x, p.y);
          ctx.fillRect(-p.sw / 2, -p.sh / 2, p.sw, p.sh);
          ctx.setTransform(cur);
        } else ctx.fillRect(p.x - p.sw / 2, p.y - p.sh / 2, p.sw, p.sh);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p.add || !this.inView(p.x, p.y, 200)) continue;
      const k = p.age / p.life;
      if (p.type === 'glow') {
        const sz = p.size * (1 - k * 0.4);
        ctx.globalAlpha = (1 - k) * (1 - k * 0.3);
        ctx.drawImage(glow(p.color), p.x - sz / 2, p.y - sz / 2, sz, sz);
      } else if (p.type === 'spark') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.w * (1 - k * 0.6);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (p.type === 'ring') {
        const e = 1 - (1 - k) * (1 - k);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.w * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.15 + 0.85 * e), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawBeams(ctx) {
    if (!this.beams.length) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of this.beams) {
      const a = 1 - b.age / b.life;
      const line = (color, w) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(b.x0, b.y0);
        ctx.lineTo(b.x1, b.y1);
        ctx.stroke();
      };
      line(rgba(b.color, 0.22 * a), 22 * a + 2);
      line(rgba(b.color, 0.7 * a), 8 * a + 1);
      line(`rgba(255,255,255,${a.toFixed(3)})`, 2.5 * a + 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawTexts(ctx) {
    const d = this.dpr * this.opts.textScale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const tx of this.texts) {
      if (!this.inView(tx.x, tx.y, 60)) continue;
      const k = tx.age / tx.life;
      const pop = 1 + 0.45 * Math.max(0, 1 - tx.age * 7);
      ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
      ctx.font = `800 ${Math.round(tx.size * pop * d)}px ${FONT}`;
      const label = tx.label ?? Math.max(1, Math.round(tx.amount));
      // Keep long messages ("FIRST BLOOD!") fully on screen near the edges.
      const half = ctx.measureText(label).width / 2 + 8 * d;
      const x = clamp(this.sx(tx.x), half, Math.max(half, this.cw - half));
      const y = this.sy(tx.y);
      ctx.lineWidth = 5 * d;
      ctx.strokeStyle = 'rgba(10,8,20,0.75)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = tx.color;
      ctx.fillText(label, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // Arrows on the screen edge pointing at things out of view (phone view).
  drawArrows(ctx, targets) {
    const d = this.dpr;
    const m = 34 * d;
    const top = 76 * d; // stay below the phone's top HUD bar
    for (const tg of targets) {
      const x = this.sx(tg.x);
      const y = this.sy(tg.y);
      if (x > m && x < this.cw - m && y > top && y < this.ch - m) continue;
      const cx = this.cw / 2;
      const cy = (top + this.ch - m) / 2;
      const hy = (this.ch - m - top) / 2;
      const ang = Math.atan2(y - cy, x - cx);
      const k = Math.min((cx - m) / Math.max(Math.abs(Math.cos(ang)), 1e-6), hy / Math.max(Math.abs(Math.sin(ang)), 1e-6));
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * k, cy + Math.sin(ang) * k);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = 'rgba(8,10,20,0.65)';
      ctx.beginPath();
      ctx.arc(0, 0, 20 * d, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = tg.color;
      ctx.lineWidth = 2.5 * d;
      ctx.stroke();
      ctx.rotate(ang);
      ctx.fillStyle = tg.color;
      ctx.beginPath();
      ctx.moveTo(30 * d, 0);
      ctx.lineTo(20 * d, -8 * d);
      ctx.lineTo(20 * d, 8 * d);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
      ctx.font = `800 ${Math.round(15 * d)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tg.icon, 0, 1 * d);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

export function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Segment (x0,y0)->(x1,y1) against the box [l,t,r,b] (slab method).
// On a hit, fills out.t (0..1 along the segment) and the surface normal.
export function segAABB(x0, y0, x1, y1, l, t, r, b, out) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < l || x0 > r) return false;
  } else {
    let t1 = (l - x0) / dx;
    let t2 = (r - x0) / dx;
    let n = -1;
    if (t1 > t2) {
      const s = t1; t1 = t2; t2 = s;
      n = 1;
    }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y0 < t || y0 > b) return false;
  } else {
    let t1 = (t - y0) / dy;
    let t2 = (b - y0) / dy;
    let n = -1;
    if (t1 > t2) {
      const s = t1; t1 = t2; t2 = s;
      n = 1;
    }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  out.t = tmin;
  out.nx = nx;
  out.ny = ny;
  return true;
}

// Distance from a point to the closest point of a box.
export function distToBox(px, py, l, t, r, b) {
  const dx = px < l ? l - px : px > r ? px - r : 0;
  const dy = py < t ? t - py : py > b ? py - b : 0;
  return Math.hypot(dx, dy);
}

// Tiny deterministic RNG so level art looks the same every time.
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const rgbCache = new Map();
export function hexToRgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, (m) => m + m) : h, 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const bl = Math.round(A[2] + (B[2] - A[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

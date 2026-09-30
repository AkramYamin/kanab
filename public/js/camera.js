// Two cameras. zoom is in device pixels per world unit; (x, y) is the world
// point at the center of the screen.
//   TV:    frames every living player, zooming out as they spread apart.
//   Phone: follows one soldier and looks a little ahead of where they aim.

import { clamp } from './util.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.ready = false;
  }

  clampTo(map, cw, ch) {
    const vw = cw / this.zoom;
    const vh = ch / this.zoom;
    this.x = vw >= map.W ? map.W / 2 : clamp(this.x, vw / 2, map.W - vw / 2);
    this.y = vh >= map.H ? map.H / 2 : clamp(this.y, vh / 2, map.H - vh / 2);
  }

  snap(x, y, zoom) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.ready = true;
  }

  ease(tx, ty, tz, dt, rateXY, rateZoom) {
    const k = 1 - Math.exp(-rateXY * dt);
    const kz = 1 - Math.exp(-rateZoom * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(tz) - Math.log(this.zoom)) * kz);
  }
}

// Keep every living player on screen with a comfortable margin.
export function updateTVCamera(cam, world, cw, ch, dt) {
  const map = world.map;
  const fit = Math.min(cw / map.W, ch / map.H);
  const closest = ch / 1000; // never zoom in past ~1000 world units tall
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of world.players.values()) {
    if (!p.alive) continue;
    x0 = Math.min(x0, p.x - 220);
    x1 = Math.max(x1, p.x + 220);
    y0 = Math.min(y0, p.y - 230);
    y1 = Math.max(y1, p.y + 110);
  }
  let tx = map.W / 2;
  let ty = map.H / 2;
  let tz = fit;
  if (x0 < x1) {
    tx = (x0 + x1) / 2;
    ty = (y0 + y1) / 2;
    tz = clamp(Math.min(cw / (x1 - x0), ch / (y1 - y0)), fit, Math.max(fit, closest));
  }
  if (!cam.ready) cam.snap(tx, ty, tz);
  // Zoom out quickly (nobody leaves the screen), zoom in gently.
  else cam.ease(tx, ty, tz, dt, 2.6, tz < cam.zoom ? 4 : 1.1);
  cam.clampTo(map, cw, ch);
}

export function updateFollowCamera(cam, p, map, cw, ch, dt, viewH = 820) {
  const zoom = Math.max(ch / viewH, cw / map.W, ch / map.H);
  const vw = cw / zoom;
  const vh = ch / zoom;
  let tx = p.x;
  let ty = p.y - 60;
  if (p.aiming) {
    tx += Math.cos(p.aim) * Math.min(vw * 0.12, 200);
    ty += Math.sin(p.aim) * 80;
  }
  if (!cam.ready) cam.snap(tx, ty, zoom);
  else cam.ease(tx, ty, zoom, dt, 10, 4);
  // Never let your own soldier drift toward the edge (jump pads are fast).
  cam.x = clamp(cam.x, p.x - vw * 0.28, p.x + vw * 0.28);
  cam.y = clamp(cam.y, p.y - 30 - vh * 0.22, p.y - 30 + vh * 0.22);
  cam.clampTo(map, cw, ch);
}

// Every sound effect is synthesized with the Web Audio API: no files to load,
// no licensing questions. Sounds are panned left/right by where they happen on
// screen, and fade with distance from what the camera shows. The announcer
// plays a recorded voice pack (public/voices, made with AI by
// `npm run voices`) and falls back to the browser's built-in speech voices.

import { clamp } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Announcer lines and their clip names in a voice pack: "scores" for the red
// team is scores_red.mp3. Lines about a player use a clip without the name.
export const VOICE_LINES = {
  plain: ['intro.ctf', 'intro.tdm', 'intro.ffa', 'fight', 'firstBlood', 'double', 'triple', 'unstoppable', 'draw'],
  team: ['flagTaken', 'scores', 'flagReturned', 'flagDropped', 'teamWins'],
  named: ['onFire', 'legendary', 'playerWins'],
};
export function clipName(key, params = {}) {
  const base = key.replace('.', '_');
  return params.team === 'red' || params.team === 'blue' ? `${base}_${params.team}` : base;
}

class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false; // demo game behind the lobby plays silently
    this.musicOn = true;
    this.voiceOn = true;
    this.last = {};
    this.voice = null;
    // What the camera shows, in world units: { x, y, halfW, halfH }.
    this.listener = null;
    this.lang = 'en';
    this.falloff = 0.6; // how fast off-screen sounds fade (phones use more)
    this.pack = 'system';
    this.clips = new Map(); // clip name -> AudioBuffer (or ArrayBuffer until decoded)
    this.packToken = 0;
    this.voiceEnd = 0;
    this.voiceSrc = null;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
      this.master = ctx.createGain();
      this.master.gain.value = 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.2;
      this.musicBus.connect(this.master);
      this.voiceBus = ctx.createGain();
      this.voiceBus.gain.value = 1.1;
      this.voiceBus.connect(this.master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.jet = this.loop('bandpass', 700, 0.9);
      this.flame = this.loop('lowpass', 1400, 0.6);
      this.hum = this.loop('lowpass', 150, 2);
      this.swarm = this.buzzLoop();
      if (this.musicOn) this.startMusic();
      this.pickVoice();
      this.decodeClips(this.packToken);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // A sawtooth with a fast wobble: sounds like bees.
  buzzLoop() {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 210;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 27;
    const depth = ctx.createGain();
    depth.gain.value = 22;
    lfo.connect(depth).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(this.sfx);
    o.start();
    lfo.start();
    return { g, f };
  }

  loop(type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    return { g, f };
  }

  // Continuous jetpack / flamethrower hiss, bee buzz and black hole rumble, set every frame.
  setLoops(jetters, flamers, bees = 0, holes = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    this.jet.g.gain.setTargetAtTime(m * Math.min(0.32, jetters * 0.12), t, 0.04);
    this.flame.g.gain.setTargetAtTime(m * Math.min(0.45, flamers * 0.22), t, 0.05);
    this.swarm.g.gain.setTargetAtTime(m * Math.min(0.1, bees * 0.02), t, 0.05);
    this.hum.g.gain.setTargetAtTime(m * Math.min(0.9, holes * 0.6), t, 0.08);
  }

  gate(name, gap) {
    const now = this.ctx.currentTime;
    if (now - (this.last[name] || 0) < gap) return false;
    this.last[name] = now;
    return true;
  }

  out(x, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const L = this.listener;
    if (x !== undefined && L && ctx.createStereoPanner) {
      const d = (x - L.x) / L.halfW;
      const far = Math.abs(d) - 1;
      g.gain.value = vol * (far > 0 ? Math.max(0.12, 1 - far * this.falloff) : 1);
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(d, -1, 1) * 0.75;
      g.connect(p).connect(this.sfx);
    } else {
      g.gain.value = vol;
      g.connect(this.sfx);
    }
    return g;
  }

  tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.2, x, at = 0, attack = 0.004 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env).connect(this.out(x, vol));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hiss({ dur, vol = 0.2, x, type = 'lowpass', f0 = 2000, f1 = f0, q = 0.8, at = 0, attack = 0.003 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(env).connect(this.out(x, vol));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // An oscillator with vibrato (bee buzz, cartoon boing).
  wobble({ type = 'sine', f0, f1 = f0, rate, depth, dur, vol, x, at = 0, filter = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const d = ctx.createGain();
    d.gain.value = depth;
    lfo.connect(d).connect(o.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(env).connect(this.out(x, vol));
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  ok(name, gap) {
    return this.ready && !this.muted && this.gate(name, gap);
  }

  // ------------------------------------------------------------ game sounds

  shoot(w, x) {
    switch (w) {
      case 'blaster':
        if (!this.ok('blaster', 0.035)) return;
        this.tone({ type: 'square', f0: 1300, f1: 260, dur: 0.09, vol: 0.07, x });
        this.hiss({ dur: 0.06, vol: 0.12, x, type: 'highpass', f0: 3000 });
        break;
      case 'shotgun':
        if (!this.ok('shotgun', 0.1)) return;
        this.hiss({ dur: 0.38, vol: 0.55, x, f0: 3500, f1: 250 });
        this.tone({ f0: 140, f1: 40, dur: 0.25, vol: 0.45, x });
        this.hiss({ dur: 0.04, vol: 0.18, x, type: 'bandpass', f0: 2500, q: 3, at: 0.32 });
        this.hiss({ dur: 0.04, vol: 0.18, x, type: 'bandpass', f0: 1800, q: 3, at: 0.42 });
        break;
      case 'minigun':
        if (!this.ok('minigun', 0.05)) return;
        this.hiss({ dur: 0.05, vol: 0.2, x, type: 'bandpass', f0: 2600, q: 1.2 });
        this.tone({ type: 'square', f0: 420, f1: 160, dur: 0.04, vol: 0.05, x });
        break;
      case 'rail':
        if (!this.ok('rail', 0.1)) return;
        this.tone({ type: 'sawtooth', f0: 180, f1: 2400, dur: 0.18, vol: 0.12, x });
        this.tone({ f0: 2200, f1: 90, dur: 0.6, vol: 0.28, x, at: 0.02 });
        this.hiss({ dur: 0.3, vol: 0.2, x, type: 'highpass', f0: 5000, f1: 1500 });
        break;
      case 'rocket':
        if (!this.ok('rocket', 0.1)) return;
        this.hiss({ dur: 0.55, vol: 0.35, x, type: 'bandpass', f0: 300, f1: 1600, q: 1 });
        this.tone({ f0: 110, f1: 45, dur: 0.18, vol: 0.35, x });
        break;
      case 'bouncer':
        if (!this.ok('bouncer', 0.06)) return;
        this.tone({ f0: 950, f1: 220, dur: 0.16, vol: 0.18, x });
        this.tone({ type: 'triangle', f0: 1900, f1: 700, dur: 0.08, vol: 0.07, x });
        break;
      case 'freeze':
        if (!this.ok('freeze', 0.07)) return;
        this.tone({ type: 'triangle', f0: 2600 + Math.random() * 600, f1: 3800, dur: 0.07, vol: 0.05, x });
        this.hiss({ dur: 0.08, vol: 0.09, x, type: 'highpass', f0: 6000 });
        break;
      case 'bees':
        if (!this.ok('bees', 0.1)) return;
        this.wobble({ type: 'sawtooth', f0: 180, f1: 240, rate: 24, depth: 25, dur: 0.4, vol: 0.12, x, filter: 1500 });
        this.tone({ f0: 520, f1: 160, dur: 0.12, vol: 0.16, x });
        break;
      case 'hammer':
        if (!this.ok('hammer', 0.1)) return;
        this.hiss({ dur: 0.22, vol: 0.3, x, type: 'bandpass', f0: 300, f1: 1800, q: 1.3 });
        break;
    }
  }

  explode(x, big = true, kind) {
    if (!this.ok('explode', 0.04)) return;
    this.hiss({ dur: big ? 1.1 : 0.6, vol: 0.9, x, f0: 1600, f1: 70 });
    this.tone({ f0: 120, f1: 28, dur: 0.7, vol: 0.9, x });
    this.hiss({ dur: 0.06, vol: 0.4, x, type: 'highpass', f0: 2500 });
    if (kind === 'hole') this.tone({ f0: 180, f1: 1500, dur: 0.25, vol: 0.2, x });
  }

  // Ice: crunchy cracks and a little chime.
  freeze(x) {
    if (!this.ok('frozen', 0.1)) return;
    for (let i = 0; i < 4; i++) this.hiss({ dur: 0.04, vol: 0.28, x, type: 'highpass', f0: 3000 + i * 800, at: i * 0.035 });
    [88, 91, 96].forEach((n, i) => this.tone({ f0: NOTE(n), dur: 0.5, vol: 0.07, x, at: 0.05 + i * 0.05 }));
  }

  thaw(x) {
    if (!this.ok('thaw', 0.08)) return;
    this.hiss({ dur: 0.3, vol: 0.35, x, type: 'highpass', f0: 2500, f1: 6000 });
    for (let i = 0; i < 5; i++) this.tone({ type: 'triangle', f0: 2000 + Math.random() * 2500, dur: 0.12, vol: 0.05, x, at: Math.random() * 0.12 });
  }

  // Squeaky toy hammer: a thud, a boing and a squeak.
  bonk(x) {
    if (!this.ok('bonk', 0.06)) return;
    this.tone({ f0: 190, f1: 60, dur: 0.18, vol: 0.55, x });
    this.wobble({ f0: 540, f1: 260, rate: 15, depth: 45, dur: 0.38, vol: 0.2, x });
    this.tone({ type: 'triangle', f0: 1700, f1: 2600, dur: 0.09, vol: 0.09, x, at: 0.02 });
  }

  // A black hole opens: a deep drop and a rushing inward whoosh.
  hole(x) {
    if (!this.ok('hole', 0.1)) return;
    this.tone({ f0: 95, f1: 32, dur: 1, vol: 0.5, x });
    this.hiss({ dur: 0.9, vol: 0.3, x, f0: 2500, f1: 200 });
    this.tone({ type: 'sawtooth', f0: 900, f1: 120, dur: 0.6, vol: 0.05, x });
  }

  hit(x) {
    if (!this.ok('hit', 0.035)) return;
    this.tone({ type: 'triangle', f0: 420, f1: 170, dur: 0.07, vol: 0.2, x });
    this.hiss({ dur: 0.04, vol: 0.1, x, type: 'bandpass', f0: 1200, q: 2 });
  }

  shield(x) {
    if (!this.ok('shield', 0.06)) return;
    this.tone({ f0: 1600, f1: 1450, dur: 0.1, vol: 0.08, x });
  }

  impact(x) {
    if (!this.ok('impact', 0.025)) return;
    this.hiss({ dur: 0.035, vol: 0.07, x, type: 'bandpass', f0: 3200, q: 2 });
  }

  death(x) {
    if (!this.ok('death', 0.05)) return;
    this.tone({ type: 'square', f0: 700, f1: 70, dur: 0.45, vol: 0.12, x });
    this.hiss({ dur: 0.35, vol: 0.35, x, f0: 900, f1: 120 });
    this.tone({ f0: 300, f1: 1100, dur: 0.08, vol: 0.15, x });
  }

  killDing() {
    if (!this.ok('ding', 0.08)) return;
    this.tone({ f0: 1320, dur: 0.18, vol: 0.09 });
    this.tone({ f0: 1980, dur: 0.14, vol: 0.05, at: 0.03 });
  }

  jump(x) {
    if (!this.ok('jump', 0.05)) return;
    this.tone({ f0: 280, f1: 620, dur: 0.11, vol: 0.06, x });
  }

  land(x) {
    if (!this.ok('land', 0.05)) return;
    this.hiss({ dur: 0.12, vol: 0.2, x, f0: 600, f1: 120 });
  }

  spawn(x) {
    if (!this.ok('spawn', 0.05)) return;
    this.tone({ type: 'triangle', f0: 400, f1: 1200, dur: 0.25, vol: 0.08, x });
  }

  pickup(kind, x) {
    if (!this.ok('pickup', 0.05)) return;
    if (kind === 'weapon') {
      this.hiss({ dur: 0.05, vol: 0.25, x, type: 'bandpass', f0: 2200, q: 3 });
      this.hiss({ dur: 0.05, vol: 0.25, x, type: 'bandpass', f0: 1600, q: 3, at: 0.09 });
      this.tone({ type: 'triangle', f0: 600, f1: 900, dur: 0.12, vol: 0.1, x, at: 0.05 });
    } else if (kind === 'power') {
      [0, 4, 7, 12, 16].forEach((n, i) => this.tone({ type: 'sawtooth', f0: NOTE(72 + n), dur: 0.16, vol: 0.06, x, at: i * 0.05 }));
    } else {
      [0, 4, 7].forEach((n, i) => this.tone({ f0: NOTE(76 + n), dur: 0.12, vol: 0.12, x, at: i * 0.06 }));
    }
  }

  empty(x) {
    if (!this.ok('empty', 0.2)) return;
    this.hiss({ dur: 0.03, vol: 0.2, x, type: 'bandpass', f0: 3000, q: 4 });
  }

  throw(x) {
    if (!this.ok('throw', 0.05)) return;
    this.hiss({ dur: 0.2, vol: 0.15, x, type: 'bandpass', f0: 600, f1: 2000, q: 1 });
  }

  pad(x) {
    if (!this.ok('pad', 0.05)) return;
    this.tone({ f0: 180, f1: 900, dur: 0.22, vol: 0.2, x });
    this.hiss({ dur: 0.18, vol: 0.12, x, type: 'bandpass', f0: 800, f1: 3000, q: 1 });
  }

  tele(x) {
    if (!this.ok('tele', 0.05)) return;
    this.tone({ type: 'sine', f0: 1400, f1: 200, dur: 0.3, vol: 0.14, x });
    this.tone({ type: 'triangle', f0: 300, f1: 1800, dur: 0.25, vol: 0.08, x, at: 0.05 });
  }

  clink(x) {
    if (!this.ok('clink', 0.06)) return;
    this.tone({ type: 'triangle', f0: 1700 + Math.random() * 400, dur: 0.05, vol: 0.07, x });
  }

  flag(kind) {
    if (!this.ready || this.muted) return;
    if (kind === 'taken') {
      [81, 76, 81, 76].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(n), dur: 0.11, vol: 0.07, at: i * 0.13 }));
    } else if (kind === 'captured') {
      [60, 64, 67, 72].forEach((n, i) => this.tone({ type: 'sawtooth', f0: NOTE(n), dur: 0.2, vol: 0.08, at: i * 0.1 }));
      [72, 76, 79].forEach((n) => this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.9, vol: 0.1, at: 0.42 }));
    } else if (kind === 'returned') {
      [84, 79, 76].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.18, vol: 0.1, at: i * 0.09 }));
    } else if (kind === 'dropped') {
      this.tone({ type: 'triangle', f0: 330, f1: 180, dur: 0.3, vol: 0.12 });
    }
  }

  tick(final = false) {
    if (!this.ready) return;
    if (final) {
      this.tone({ f0: 1320, dur: 0.45, vol: 0.2 });
      this.tone({ f0: 1760, dur: 0.45, vol: 0.12 });
    } else this.tone({ f0: 880, dur: 0.14, vol: 0.18 });
  }

  fanfare() {
    if (!this.ready) return;
    const seq = [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [84, 0.7]];
    seq.forEach(([n, at]) => this.tone({ type: 'sawtooth', f0: NOTE(n), dur: 0.3, vol: 0.07, at }));
    [72, 76, 79, 84].forEach((n) => this.tone({ type: 'triangle', f0: NOTE(n), dur: 1.6, vol: 0.08, at: 0.7 }));
  }

  ui() {
    if (!this.ready) return;
    this.tone({ f0: 1000, dur: 0.04, vol: 0.06 });
  }

  join() {
    if (!this.ready) return;
    [72, 79, 84].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.12, vol: 0.12, at: i * 0.07 }));
  }

  // ---------------------------------------------------------------- music

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.schedule(), 40);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  schedule() {
    const spb = 60 / 112 / 4; // sixteenth notes at 112 BPM
    while (this.nextT < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextT);
      this.nextT += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(s, t) {
    const ctx = this.ctx;
    const bar = (s / 16) | 0;
    const i = s % 16;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const ch = chords[bar];
    const voice = (type, freq, dur, vol, filter) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = o;
      if (filter) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filter;
        o.connect(f);
        node = f;
      }
      node.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    const drum = (f0, f1, dur, vol, noise) => {
      if (noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = f0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(this.musicBus);
        src.start(t, Math.random());
        src.stop(t + dur + 0.02);
      } else {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.musicBus);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
    };
    if (i % 4 === 0) drum(150, 42, 0.28, 0.9);
    if (i === 4 || i === 12) drum(1800, 0, 0.16, 0.35, true);
    if (i % 2 === 1) drum(7000, 0, 0.04, 0.12, true);
    if (i % 2 === 0) voice('sawtooth', NOTE(ch[0] - 24 + (i % 4 === 2 ? 12 : 0)), 0.2, 0.35, 600);
    if (i % 2 === 0) voice('triangle', NOTE(ch[(i / 2) % 3] + 12), 0.18, 0.12);
    if (i === 0) ch.forEach((n) => voice('sine', NOTE(n), 1.9, 0.06));
  }

  // ------------------------------------------------------------- announcer

  // Announcer language: picks a matching system voice (e.g. "Majed" on a Mac for Arabic).
  setLang(lang) {
    this.lang = lang;
    this.pickVoice();
  }

  pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const choose = () => {
      const voices = speechSynthesis.getVoices();
      const want = this.lang || 'en';
      const prefer = want === 'ar'
        ? ['Majed', 'Maged', 'Tarik', 'Laila', 'Google العربية', 'Microsoft Hamed', 'Microsoft Naayf']
        : ['Daniel', 'Google UK English Male', 'Alex', 'Fred', 'Samantha'];
      const ofLang = voices.filter((v) => v.lang.toLowerCase().startsWith(want));
      this.voice = prefer.map((n) => ofLang.find((v) => v.name.startsWith(n))).find(Boolean) || ofLang[0] || null;
    };
    choose();
    speechSynthesis.onvoiceschanged = choose;
  }

  get hasVoice() {
    return !!this.voice;
  }

  // ------------------------------------------------------------ voice packs

  // Load the clips of one pack for one language ('system' = speech voices only).
  async setPack(pack, lang) {
    if (pack === this.pack && lang === this.packLang) return;
    this.pack = pack;
    this.packLang = lang;
    const token = ++this.packToken;
    this.clips = new Map();
    if (!pack || pack === 'system') return;
    try {
      const m = await (await fetch(`/voices/${pack}/manifest.json`)).json();
      const names = m.clips?.[lang] || [];
      await Promise.all(names.map(async (name) => {
        const r = await fetch(`/voices/${pack}/${lang}/${name}.${m.ext || 'mp3'}`);
        if (r.ok && token === this.packToken) this.clips.set(name, await r.arrayBuffer());
      }));
    } catch {
      /* no pack: the speech voice takes over */
    }
    if (token === this.packToken) this.decodeClips(token);
  }

  decodeClips(token) {
    if (!this.ctx) return;
    for (const [name, data] of this.clips) {
      if (!(data instanceof ArrayBuffer)) continue;
      this.clips.set(name, null);
      this.ctx.decodeAudioData(data).then(
        (buf) => token === this.packToken && this.clips.set(name, buf),
        () => this.clips.delete(name),
      );
    }
  }

  // True once a recorded pack is loaded (even before the sound is unlocked).
  get hasClips() {
    return this.clips.size > 0;
  }

  // Say an announcer line: the recorded clip if the pack has it, else speech.
  announce(key, params, text, urgent = false) {
    if (!this.voiceOn || this.muted) return;
    const buf = this.clips.get(clipName(key, params));
    if (!(buf instanceof AudioBuffer) || !this.ready) {
      this.say(text, urgent);
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    let at = now;
    if (urgent) {
      try {
        this.voiceSrc?.stop();
      } catch {
        /* already stopped */
      }
    } else if (this.voiceEnd > now) {
      if (this.voiceEnd - now > 1.2) return; // too much queued: skip this one
      at = this.voiceEnd;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.voiceBus);
    src.start(at);
    this.voiceSrc = src;
    this.voiceEnd = at + buf.duration;
    // Duck the music under the voice.
    const g = this.musicBus.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0.07, at, 0.05);
    g.setTargetAtTime(0.2, this.voiceEnd, 0.3);
  }

  say(text, urgent = false) {
    if (!this.voiceOn || this.muted || !('speechSynthesis' in window)) return;
    // Never read Arabic words with an English voice (or the other way round).
    if (!this.voice && this.lang === 'ar') return;
    if (urgent) speechSynthesis.cancel();
    else if (speechSynthesis.pending) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    }
    u.rate = this.lang === 'ar' ? 1 : 1.05;
    u.pitch = this.lang === 'ar' ? 1 : 0.85;
    u.volume = 1;
    speechSynthesis.speak(u);
  }
}

export const audio = new Sound();

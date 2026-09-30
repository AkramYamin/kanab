// Map layouts. x grows right, y grows down (world units; a soldier is 60 tall).
//   solids  [x, y, w, h]        walls and floors
//   plats   [x, y, w]           thin one-way platforms (jump up through them)
//   backs   [x, y, w, h]        dark "inside" areas drawn behind tunnels and caves
//   pads    [x, y, vx, vy]      jump pads sitting on a surface at y
//   teles   [[x1, y1], [x2, y2], colorIndex]   a two-way teleporter pair
//   pickups [x, y, kind, weapon?]
//   props   [kind, x, y, arg?]  decoration only (arg = height for columns)
// Everything under "mirror*" is copied to the right half, so both teams get
// the same base. The red team always starts on the left.

const THEMES = {
  canyon: {
    sky: ['#2a1a3a', '#5a2d4a', '#a4525a', '#e08a62', '#f3bf88'],
    celestial: { kind: 'sun', x: 0.74, y: 0.3, r: 0.07, color: '#ffe3b0' },
    stars: 0.08,
    layers: [
      { kind: 'mesas', color: '#7c4a5e', base: 0.55, amp: 340, seed: 3, par: 0.12 },
      { kind: 'mesas', color: '#5c3150', base: 0.7, amp: 240, seed: 9, par: 0.25 },
    ],
    haze: 'rgba(243,191,136,0.10)',
    solid: { style: 'rock', fill: ['#8f5048', '#4a2430'], rim: '#2a1218', top: '#f0a36a', topStyle: 'sand' },
    plat: { body: '#6a3a4a', top: '#ffc79a', edge: '#2a1218' },
    back: '#2c1622',
    smoke: '#5a4a52',
  },
  neon: {
    sky: ['#04060f', '#0a1230', '#131f4f', '#1f2a66', '#2d2466'],
    celestial: { kind: 'moon', x: 0.2, y: 0.2, r: 0.05, color: '#e6ecff' },
    stars: 0.5,
    layers: [
      { kind: 'city', color: '#161c44', base: 0.5, amp: 460, seed: 5, par: 0.1, windows: '#ffd36b' },
      { kind: 'city', color: '#0e1333', base: 0.64, amp: 340, seed: 9, par: 0.22, windows: '#5ff2ff' },
    ],
    haze: 'rgba(8,10,30,0.28)',
    solid: { style: 'building', fill: ['#2a3160', '#141830'], rim: '#070812', top: '#35f0ff', topStyle: 'neon' },
    plat: { body: '#261c4c', top: '#ff4fd8', edge: '#0b0716', neon: true },
    back: '#0a0c1e',
    smoke: '#3a3f5c',
  },
  frost: {
    sky: ['#16345a', '#2c5f8c', '#5f98c2', '#a8d2e8', '#dff1f8'],
    celestial: { kind: 'sun', x: 0.8, y: 0.2, r: 0.045, color: '#fffbe8' },
    stars: 0,
    layers: [
      { kind: 'mountains', color: '#a3c3da', base: 0.5, amp: 440, seed: 2, par: 0.1, snow: true },
      { kind: 'mountains', color: '#7fa6c5', base: 0.66, amp: 300, seed: 4, par: 0.22, snow: true },
    ],
    haze: 'rgba(223,241,248,0.16)',
    solid: { style: 'ice', fill: ['#d3e9f5', '#7fa8c6'], rim: '#3d6283', top: '#ffffff', topStyle: 'snow' },
    plat: { body: '#86c4e2', top: '#f2fcff', edge: '#3d6283' },
    back: '#355a7a',
    smoke: '#c9d8e4',
  },
  jungle: {
    sky: ['#1d4a52', '#3f7f7a', '#86b58f', '#cfe0a6', '#f2efc0'],
    celestial: { kind: 'sun', x: 0.28, y: 0.24, r: 0.055, color: '#fff6cf' },
    stars: 0,
    layers: [
      { kind: 'hills', color: '#5a8a68', base: 0.56, amp: 280, seed: 6, par: 0.1, trees: true },
      { kind: 'hills', color: '#3c684f', base: 0.7, amp: 210, seed: 12, par: 0.22, trees: true },
    ],
    haze: 'rgba(242,239,192,0.12)',
    solid: { style: 'stone', fill: ['#8f8f70', '#505144'], rim: '#2c2d24', top: '#7cc45a', topStyle: 'grass' },
    plat: { body: '#7a5a3a', top: '#a6d872', edge: '#3a2a1a' },
    back: '#2f3226',
    smoke: '#6a6a58',
  },
};

export const TELE_COLORS = ['#35f0ff', '#ff6bd6'];

const MAP_DEFS = [
  {
    id: 'canyon',
    name: 'Canyon Run',
    theme: 'canyon',
    W: 3400,
    H: 1900,
    solids: [[0, 1800, 3400, 100], [1540, 1330, 320, 90]],
    mirrorSolids: [
      [0, 1060, 420, 500], [490, 1060, 110, 500], [0, 1680, 600, 120], [880, 1700, 150, 100],
    ],
    plats: [[1560, 420, 280]],
    mirrorPlats: [
      [420, 1060, 70], [420, 1320, 70], [40, 860, 340], [0, 600, 220],
      [600, 1220, 150], [680, 1440, 190], [600, 1620, 140],
      [800, 1160, 200], [1040, 1360, 200], [1080, 1000, 240], [1320, 1180, 160],
      [700, 760, 240], [980, 620, 260], [1300, 520, 200],
    ],
    mirrorBacks: [[0, 1560, 600, 120], [420, 1060, 70, 500]],
    mirrorPads: [[1200, 1800, 0, -1900], [700, 1800, 0, -1750]],
    teles: [[[80, 1680], [3320, 1680], 0]],
    mirrorTeles: [[[1090, 1800], [1110, 620], 1]],
    pickups: [[1700, 420, 'weapon', 'rocket'], [1700, 1330, 'power'], [1700, 1800, 'health']],
    mirrorPickups: [
      [110, 600, 'weapon', 'rail'], [900, 1160, 'weapon', 'shotgun'], [1200, 1000, 'weapon', 'minigun'],
      [300, 1680, 'weapon', 'flamer'], [1140, 1360, 'weapon', 'bouncer'], [820, 1800, 'health'],
      [200, 860, 'grenades'], [1400, 520, 'grenades'],
      [775, 1440, 'weapon', 'freeze'], [820, 760, 'weapon', 'bees'], [1400, 1180, 'weapon', 'hammer'], [670, 1620, 'hole'],
    ],
    mirrorProps: [
      ['banner', 60, 1060], ['banner', 380, 1060], ['lamp', 560, 1060], ['crate', 955, 1700], ['cactus', 1360, 1800],
      ['column', 1590, 1800, 380],
    ],
    flag: [230, 1060],
    spawns: [[60, 1060], [140, 1060], [320, 1060], [380, 1060], [110, 860], [300, 860]],
  },
  {
    id: 'district',
    name: 'Neon District',
    theme: 'neon',
    W: 3400,
    H: 2000,
    solids: [[0, 1900, 3400, 100]],
    mirrorSolids: [
      [0, 1720, 700, 60], [820, 1720, 760, 60], [0, 1080, 440, 640], [0, 520, 90, 360],
      [600, 1340, 280, 380], [1000, 820, 220, 700], [1000, 1520, 40, 200], [1180, 1520, 40, 200],
    ],
    plats: [[1640, 1820, 120], [1450, 1460, 500], [1540, 1150, 320], [1600, 840, 200], [1640, 560, 120]],
    mirrorPlats: [
      [100, 880, 280], [480, 1000, 180], [640, 1120, 200], [1300, 1200, 150], [1280, 900, 170], [720, 780, 200], [420, 640, 200],
    ],
    backs: [[0, 1780, 3400, 120]],
    mirrorBacks: [[1040, 1520, 140, 200]],
    mirrorPads: [[520, 1720, 0, -1800], [1370, 1720, 0, -1500]],
    mirrorTeles: [[[300, 1900], [1110, 820], 0]],
    pickups: [[1700, 560, 'weapon', 'rocket'], [1700, 840, 'power'], [1700, 1820, 'health'], [1700, 1460, 'grenades']],
    mirrorPickups: [
      [45, 520, 'weapon', 'rail'], [740, 1340, 'weapon', 'shotgun'], [570, 1000, 'weapon', 'minigun'],
      [900, 1900, 'weapon', 'flamer'], [1375, 1200, 'weapon', 'bouncer'], [940, 1720, 'health'],
      [240, 880, 'grenades'], [820, 780, 'health'],
      [740, 1120, 'weapon', 'freeze'], [1365, 900, 'weapon', 'bees'], [520, 640, 'weapon', 'hammer'], [600, 1900, 'hole'],
    ],
    mirrorProps: [['banner', 30, 1080], ['banner', 410, 1080], ['lamp', 1300, 1720], ['lamp', 1540, 1720], ['antenna', 1110, 820]],
    flag: [220, 1080],
    spawns: [[60, 1080], [140, 1080], [300, 1080], [380, 1080], [140, 880], [330, 880]],
  },
  {
    id: 'glacier',
    name: 'Glacier Keep',
    theme: 'frost',
    W: 3400,
    H: 1900,
    solids: [[0, 1800, 3400, 100], [1440, 1500, 520, 150]],
    mirrorSolids: [[0, 1200, 560, 380], [0, 1700, 560, 100], [520, 1080, 40, 120], [0, 700, 160, 500]],
    plats: [[1560, 700, 280]],
    mirrorPlats: [
      [160, 960, 360], [300, 720, 220], [700, 820, 700], [700, 1360, 200], [960, 1540, 200], [1100, 1200, 220], [1300, 1000, 160],
    ],
    backs: [[1440, 1650, 520, 150]],
    mirrorBacks: [[0, 1580, 560, 120]],
    mirrorPads: [[820, 1800, 0, -2050], [470, 1200, 0, -1600]],
    mirrorTeles: [[[100, 1700], [1560, 1800], 0]],
    pickups: [[1700, 700, 'weapon', 'rocket'], [1700, 1800, 'power'], [1700, 1500, 'health']],
    mirrorPickups: [
      [80, 700, 'weapon', 'rail'], [800, 1360, 'weapon', 'shotgun'], [1210, 1200, 'weapon', 'minigun'],
      [300, 1700, 'weapon', 'flamer'], [1060, 1540, 'weapon', 'bouncer'], [340, 960, 'grenades'],
      [660, 1800, 'health'], [1050, 820, 'grenades'],
      [1380, 1000, 'weapon', 'freeze'], [850, 820, 'weapon', 'bees'], [410, 720, 'weapon', 'hammer'], [1250, 1800, 'hole'],
    ],
    mirrorProps: [['banner', 180, 1200], ['banner', 500, 1200], ['pine', 620, 1800], ['pine', 1320, 1800], ['torch', 30, 1700]],
    flag: [300, 1200],
    spawns: [[200, 1200], [280, 1200], [360, 1200], [420, 1200], [220, 960], [420, 960]],
  },
  {
    id: 'temple',
    name: 'Jungle Temple',
    theme: 'jungle',
    W: 3600,
    H: 1900,
    solids: [
      [0, 1800, 3600, 100], [1200, 1640, 1200, 160], [1440, 1320, 720, 160], [1560, 1160, 480, 160], [1680, 1060, 240, 100],
    ],
    mirrorSolids: [[0, 1100, 600, 50], [80, 1150, 160, 650], [1320, 1480, 300, 40]],
    plats: [[1640, 560, 320]],
    mirrorPlats: [
      [40, 880, 460], [0, 620, 300], [340, 420, 200], [700, 1300, 220], [900, 1050, 200], [650, 800, 220], [1000, 700, 260], [1250, 900, 180],
    ],
    backs: [[1320, 1480, 960, 160]],
    mirrorBacks: [[240, 1150, 360, 650]],
    mirrorPads: [[760, 1800, 0, -1500], [1260, 1640, 0, -1800]],
    mirrorTeles: [[[400, 1800], [1700, 1640], 1]],
    pickups: [[1800, 560, 'weapon', 'rocket'], [1800, 1640, 'power'], [1800, 1060, 'health']],
    mirrorPickups: [
      [100, 620, 'weapon', 'rail'], [810, 1300, 'weapon', 'shotgun'], [1000, 1050, 'weapon', 'minigun'],
      [520, 1800, 'weapon', 'flamer'], [1130, 700, 'weapon', 'bouncer'], [270, 880, 'grenades'],
      [1380, 1480, 'health'], [1100, 1800, 'health'],
      [1340, 900, 'weapon', 'freeze'], [760, 800, 'weapon', 'bees'], [440, 420, 'weapon', 'hammer'], [960, 1800, 'hole'],
    ],
    mirrorProps: [['banner', 20, 1100], ['banner', 580, 1100], ['torch', 1230, 1640], ['torch', 1700, 1060], ['palm', 950, 1800]],
    flag: [440, 1100],
    spawns: [[60, 1100], [160, 1100], [260, 1100], [540, 1100], [150, 880], [400, 880]],
  },
];

const RESPAWN = { weapon: 10, health: 12, grenades: 12, power: 40, hole: 25 };

function build(def) {
  const { W, H } = def;
  const mx = (x, w = 0) => W - x - w;
  const rects = (list = [], mirror = []) => {
    const out = list.map(([x, y, w, h]) => ({ x, y, w, h }));
    for (const [x, y, w, h] of mirror) out.push({ x, y, w, h }, { x: mx(x, w), y, w, h });
    return out;
  };
  const plats = (def.plats || []).map(([x, y, w]) => ({ x, y, w }));
  for (const [x, y, w] of def.mirrorPlats || []) plats.push({ x, y, w }, { x: mx(x, w), y, w });

  const pickups = [];
  const addPickup = ([x, y, kind, weapon]) => pickups.push({ x, y, kind, weapon, respawn: RESPAWN[kind] });
  (def.pickups || []).forEach(addPickup);
  for (const [x, y, kind, weapon] of def.mirrorPickups || []) {
    addPickup([x, y, kind, weapon]);
    addPickup([mx(x), y, kind, weapon]);
  }

  const pads = (def.pads || []).map(([x, y, vx, vy]) => ({ x, y, vx, vy }));
  for (const [x, y, vx, vy] of def.mirrorPads || []) pads.push({ x, y, vx, vy }, { x: mx(x), y, vx: -vx, vy });

  const teles = [];
  const addPair = ([a, b], color) => {
    const i = teles.length;
    teles.push({ x: a[0], y: a[1], to: i + 1, color }, { x: b[0], y: b[1], to: i, color });
  };
  for (const [a, b, c] of def.teles || []) addPair([a, b], c);
  for (const [a, b, c] of def.mirrorTeles || []) {
    addPair([a, b], c);
    addPair([[mx(a[0]), a[1]], [mx(b[0]), b[1]]], c);
  }

  const props = (def.props || []).map(([kind, x, y, arg]) => ({ kind, x, y, arg, side: 0 }));
  for (const [kind, x, y, arg] of def.mirrorProps || []) props.push({ kind, x, y, arg, side: -1 }, { kind, x: mx(x), y, arg, side: 1 });

  return {
    id: def.id,
    name: def.name,
    W,
    H,
    theme: THEMES[def.theme],
    themeId: def.theme,
    solids: rects(def.solids, def.mirrorSolids),
    plats,
    backs: rects(def.backs, def.mirrorBacks),
    pads,
    teles,
    pickups,
    props,
    flags: { red: { x: def.flag[0], y: def.flag[1] }, blue: { x: mx(def.flag[0]), y: def.flag[1] } },
    spawns: {
      red: def.spawns.map(([x, y]) => ({ x, y })),
      blue: def.spawns.map(([x, y]) => ({ x: mx(x), y })),
    },
  };
}

export const MAPS = MAP_DEFS.map(build);
export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];

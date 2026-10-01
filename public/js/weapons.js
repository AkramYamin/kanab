// Weapon tuning. rate = shots per second, dmg = damage per bullet/pellet,
// len = barrel length (where bullets come out), knock = push on hit.
export const WEAPONS = {
  blaster: {
    name: 'Blaster', kind: 'bullet', rate: 7, dmg: 11, speed: 1900, spread: 0.035,
    pellets: 1, ammo: Infinity, life: 1.1, knock: 50, len: 34, color: '#6ff7ff', shell: true,
  },
  shotgun: {
    name: 'Shotgun', kind: 'bullet', rate: 1.3, dmg: 10, speed: 1650, spread: 0.2,
    pellets: 8, ammo: 12, life: 0.45, knock: 45, len: 42, color: '#ffd36b', recoil: 280, drag: 1.4, shell: true,
  },
  minigun: {
    name: 'Minigun', kind: 'bullet', rate: 16, dmg: 6, speed: 2100, spread: 0.08,
    pellets: 1, ammo: 150, life: 1, knock: 22, len: 46, color: '#ffae5c', slow: 0.75, shell: true,
  },
  rail: {
    name: 'Railgun', kind: 'rail', rate: 0.85, dmg: 80, ammo: 6, knock: 420, len: 52, color: '#c77dff',
  },
  rocket: {
    name: 'Rockets', kind: 'rocket', rate: 1.05, dmg: 95, radius: 150, speed: 800, maxSpeed: 1500,
    ammo: 6, life: 3, len: 46, color: '#ff7a3d', recoil: 160,
  },
  flamer: {
    name: 'Flamer', kind: 'flame', rate: 26, dmg: 2.5, speed: 720, spread: 0.16, pellets: 1,
    ammo: 200, life: 0.5, knock: 8, len: 42, color: '#ff8c1a', drag: 2.2, burn: 1.4,
  },
  bouncer: {
    name: 'Bouncer', kind: 'bounce', rate: 4, dmg: 16, speed: 1250, spread: 0.04, pellets: 1,
    ammo: 32, life: 2.2, bounces: 4, knock: 90, len: 38, color: '#7dff6b', gravity: 300,
  },
  // Each shard adds `chill`; a full meter freezes the target in an ice block.
  freeze: {
    name: 'Freeze Ray', kind: 'ice', rate: 10, dmg: 3, speed: 1500, spread: 0.05, pellets: 1,
    ammo: 90, life: 0.42, knock: 6, len: 40, color: '#9fe8ff', chill: 0.17,
  },
  // Three bees per shot that curve toward the nearest enemy. Strong, so each
  // map has just one, high up in the middle.
  bees: {
    name: 'Bee Swarm', kind: 'bee', rate: 1.3, dmg: 13, speed: 760, spread: 0.32, pellets: 3,
    ammo: 6, life: 2.4, knock: 110, len: 34, color: '#ffd23f', turn: 4, seek: 650,
  },
  // Melee: a dash plus a swing that launches whoever it hits.
  hammer: {
    name: 'Big Hammer', kind: 'melee', rate: 1.5, dmg: 55, ammo: 24, knock: 1150, len: 40,
    color: '#ff5d73', reach: 78, dash: 700,
  },
};

export const GRENADE = { dmg: 90, radius: 140, fuse: 1.6, speed: 880, max: 4, start: 2 };

// Black hole grenades (from the swirl pickup): fly like a grenade, then float
// and pull enemies in for a moment before they pop.
export const HOLE = { fuse: 0.9, life: 2.2, radius: 430, pull: 2700, dmg: 75, blast: 170, max: 2 };

// Frozen solid: how long it lasts, and how long before you can be frozen again.
export const FREEZE = { time: 1.6, immune: 1.5, decay: 0.35 };

export const SWING = 0.22; // hammer swing length in seconds

// What the lobby can switch off (the blaster always stays). 'hole' = black hole pickups.
export const TOGGLES = ['shotgun', 'minigun', 'rail', 'rocket', 'flamer', 'bouncer', 'freeze', 'bees', 'hammer', 'hole'];

// Emoji-free little glyphs used in the kill feed and on the phone.
export const WEAPON_ICON = {
  blaster: '⟡', shotgun: '⁂', minigun: '≋', rail: '⌁', rocket: '➶', flamer: '♨', bouncer: '◉',
  freeze: '❄︎', bees: '✲', hammer: '⚒︎', hole: '◎',
  grenade: '✹', burn: '♨',
};

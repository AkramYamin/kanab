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
};

export const GRENADE = { dmg: 90, radius: 140, fuse: 1.6, speed: 880, max: 4, start: 2 };

// Emoji-free little glyphs used in the kill feed and on the phone.
export const WEAPON_ICON = {
  blaster: '⟡', shotgun: '⁂', minigun: '≋', rail: '⌁', rocket: '➶', flamer: '♨', bouncer: '◉',
  grenade: '✹', burn: '♨',
};

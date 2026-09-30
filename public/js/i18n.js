// Translations. The server sends message keys (plus names/teams), and every
// screen turns them into text in the chosen language. Arabic is written in
// simple Modern Standard Arabic so every Arabic-speaking kid can read it.
//
//   t('say.scores', { team: 'red' })  ->  "Red team scores!" / "الفريق الأحمر يسجّل!"
// A {team} parameter given as 'red' / 'blue' is translated automatically;
// {x|up} upper-cases the value (does nothing to Arabic).

const en = {
  'logo.small': 'COUCH',
  'logo.big': 'COMMANDOS',
  tagline: 'Grab your phone, scan the code, and it turns into your controller',
  'step.1': 'Join the same Wi-Fi',
  'step.2': 'Point your camera here',
  'step.3': 'Pick a name & play!',
  start: 'START GAME',
  again: 'PLAY AGAIN',
  lobbyBtn: 'LOBBY',
  gameOver: 'GAME OVER',
  soundHint: '🔊 Click anywhere to turn on the sound',
  keysHelp: 'M music · V voice · L language · F fullscreen · K keyboard player · E end match',
  scanToJoin: 'Scan to<br>join!',
  'team.red': 'Red',
  'team.blue': 'Blue',
  redTeam: 'Red team',
  blueTeam: 'Blue team',
  vs: 'VS',
  ffaTitle: 'Everyone vs everyone',
  bot: 'Bot',
  emptyTeam: 'Scan the QR code to join',
  captainLine: '👑 {name} is the captain and can start from their phone',
  pressEnter: 'Press <kbd>Enter</kbd> to start',
  waitingPlayers: 'Waiting for players… (or add bots and press <kbd>Enter</kbd>)',
  'set.mode': 'Mode',
  'set.map': 'Map',
  'set.screen': 'Watch on',
  'set.bots': 'Bots',
  'set.skill': 'Bot skill',
  'set.limit': 'Goal',
  'set.time': 'Time',
  'set.assist': 'Aim help',
  'set.lang': 'Language',
  'mode.ctf': 'Capture the Flag',
  'mode.tdm': 'Team Deathmatch',
  'mode.ffa': 'Free for All',
  'map.canyon': 'Canyon Run',
  'map.district': 'Neon District',
  'map.glacier': 'Glacier Keep',
  'map.temple': 'Jungle Temple',
  'screen.tv': 'TV',
  'screen.phone': 'Phones',
  'skill.easy': 'Easy',
  'skill.normal': 'Normal',
  'skill.hard': 'Hard',
  'lang.en': 'English',
  'lang.ar': 'العربية',
  none: 'None',
  on: 'On',
  off: 'Off',
  minutes: '{n} min',
  limit: ({ n, unit }) => `${n} ${unit}`,
  goal: ({ n, unit }) => `First to ${n} ${unit}`,
  getReady: 'Get ready!',
  go: 'GO!',
  joined: '{name} joined!',
  musicOn: 'Music on',
  musicOff: 'Music off',
  voiceOn: 'Announcer on',
  voiceOff: 'Announcer off',
  noVoice: 'No voice for this language on this computer',
  kbHint: 'Keyboard player: WASD + mouse, G = grenade (K again to remove)',
  needPlayers: 'Join with a phone or add at least 2 bots first!',
  oops: 'oops!',
  'th.player': 'Player',
  'th.flags': 'Flags',
  'th.kos': 'KOs',
  'th.downs': 'Downs',
  backIn: 'Back to the lobby in {n}s',
  reconnecting: 'Reconnecting to the game server…',

  // announcer
  'say.intro.ctf': 'Capture the flag!',
  'say.intro.tdm': 'Team deathmatch!',
  'say.intro.ffa': 'Free for all!',
  'say.fight': 'Fight!',
  'say.firstBlood': 'First blood!',
  'say.double': 'Double kill!',
  'say.triple': 'Triple kill!',
  'say.unstoppable': 'Unstoppable!',
  'say.onFire': '{name} is on fire!',
  'say.legendary': '{name} is legendary!',
  'say.flagTaken': '{team} flag taken!',
  'say.scores': '{team} team scores!',
  'say.flagReturned': '{team} flag returned',
  'say.flagDropped': '{team} flag dropped',
  'say.teamWins': '{team} team wins!',
  'say.playerWins': '{name} wins!',
  'say.draw': "It's a draw!",

  // big messages
  'ba.scores': '{team|up} SCORES!',
  'ba.scoresSub': '{name} captured the flag',
  'ba.onFire': '{name} is on fire!',
  'ba.legendary': '{name} is legendary!',
  'ba.streakSub': '{n} knockouts in a row',
  'title.teamWins': '{team|up} TEAM WINS!',
  'title.playerWins': '{name|up} WINS!',
  'title.draw': "IT'S A DRAW!",
  'to.grabbed': '{name} grabbed the {team} flag!',
  'to.saved': '{name} saved the {team} flag!',
  'to.backHome': '{team} flag is back home',
  'ft.firstBlood': 'FIRST BLOOD!',
  'ft.double': 'DOUBLE KILL!',
  'ft.triple': 'TRIPLE KILL!',
  'ft.unstoppable': 'UNSTOPPABLE!',
  'pk.health': '+50 HP',
  'pk.grenades': '+2 GRENADES',
  'pk.power': 'DOUBLE DAMAGE!',

  'w.blaster': 'Blaster',
  'w.shotgun': 'Shotgun',
  'w.minigun': 'Minigun',
  'w.rail': 'Railgun',
  'w.rocket': 'Rockets',
  'w.flamer': 'Flamer',
  'w.bouncer': 'Bouncer',

  // phone
  'ph.name': 'Your name',
  'ph.namePh': 'Type your name',
  'ph.color': 'Your color',
  'ph.join': 'JOIN GAME',
  'ph.connecting': 'Connecting…',
  'ph.ready': 'Ready! Tap JOIN GAME',
  'ph.watchTv': 'Look at the TV',
  'ph.watchPhone': 'Game on my phone',
  'ph.redTeam': 'RED TEAM',
  'ph.blueTeam': 'BLUE TEAM',
  'ph.captain': "👑 You're the captain",
  'ph.capHint': 'Tap a setting to change it. Everyone ready? Start!',
  'ph.waitCap': 'Waiting for 👑 {name} to start…',
  'ph.left': 'Left thumb',
  'ph.leftHow': 'move · push up to jump & fly',
  'ph.right': 'Right thumb',
  'ph.rightHow': 'aim & shoot',
  'ph.edit': 'Change name / color',
  'ph.move': 'MOVE',
  'ph.moveSub': 'push up to jump & fly',
  'ph.aim': 'AIM & SHOOT',
  'ph.aimSub': 'drag to fire',
  'ph.ko': 'KNOCKED OUT!',
  'ph.back': 'Back in a moment…',
  'ph.won': 'You won! 🎉',
  'ph.close': 'So close!',
  'ph.gg': 'Good game! Next time!',
  'ph.kos': 'KOs',
  'ph.downs': 'Downs',
  'ph.flags': 'Flags',
  'ph.mvp': 'MVP',
  'ph.toLobby': 'BACK TO LOBBY',
  'ph.captainNext': 'The captain will start the next round',
  'ph.rotate': 'Turn your phone sideways',
  'ph.otherTab': 'This controller is open in another tab. Use that one!',
  'ph.lost': 'Lost connection… reconnecting',
  'ph.flagHome': '🚩 You have the flag! Bring it home!',
  'ph.power': '⚡ DOUBLE DAMAGE!',
  'ph.readyDots': 'Get ready…',
  'ph.teamLabel': '{team} team',
  'ph.ffa': 'Free for all',
  'ph.viewTv': 'Watch the TV instead',
  'ph.viewPhone': 'Show the game on this phone',
  'ph.kosShort': 'KOs',
};

const ar = {
  'logo.small': 'كوماندوز',
  'logo.big': 'الكنبة',
  tagline: 'امسك هاتفك، امسح الرمز، وسيصبح يد التحكم الخاصة بك',
  'step.1': 'اتصل بنفس شبكة الواي فاي',
  'step.2': 'وجّه كاميرا الهاتف إلى هنا',
  'step.3': 'اختر اسمك والعب!',
  start: 'ابدأ اللعبة',
  again: 'العب مرة أخرى',
  lobbyBtn: 'القائمة',
  gameOver: 'انتهت اللعبة',
  soundHint: '🔊 اضغط في أي مكان لتشغيل الصوت',
  keysHelp: 'M الموسيقى · V المعلّق · L اللغة · F ملء الشاشة · K لاعب لوحة المفاتيح · E إنهاء المباراة',
  scanToJoin: 'امسح<br>للانضمام!',
  'team.red': 'الأحمر',
  'team.blue': 'الأزرق',
  redTeam: 'الفريق الأحمر',
  blueTeam: 'الفريق الأزرق',
  vs: 'ضد',
  ffaTitle: 'الكل ضد الكل',
  bot: 'روبوت',
  emptyTeam: 'امسح رمز QR للانضمام',
  captainLine: '👑 القائد: {name} · يمكنه بدء اللعبة من هاتفه',
  pressEnter: 'اضغط <kbd>Enter</kbd> للبدء',
  waitingPlayers: 'بانتظار اللاعبين… (أو أضف روبوتات واضغط <kbd>Enter</kbd>)',
  'set.mode': 'النمط',
  'set.map': 'الخريطة',
  'set.screen': 'المشاهدة على',
  'set.bots': 'الروبوتات',
  'set.skill': 'مهارة الروبوتات',
  'set.limit': 'الهدف',
  'set.time': 'الوقت',
  'set.assist': 'مساعدة التصويب',
  'set.lang': 'اللغة',
  'mode.ctf': 'التقاط العلم',
  'mode.tdm': 'معركة الفرق',
  'mode.ffa': 'الكل ضد الكل',
  'map.canyon': 'وادي الغروب',
  'map.district': 'حي النيون',
  'map.glacier': 'قلعة الجليد',
  'map.temple': 'معبد الغابة',
  'screen.tv': 'التلفاز',
  'screen.phone': 'الهواتف',
  'skill.easy': 'سهل',
  'skill.normal': 'متوسط',
  'skill.hard': 'صعب',
  'lang.en': 'English',
  'lang.ar': 'العربية',
  none: 'بدون',
  on: 'تشغيل',
  off: 'إيقاف',
  minutes: ({ n }) => `${n} ${n <= 10 ? 'دقائق' : 'دقيقة'}`,
  limit: ({ n, unit }) => `${n} ${arUnit(n, unit)}`,
  goal: ({ n, unit }) => `أول من يصل إلى ${n} ${arUnit(n, unit)}`,
  getReady: 'استعدّ!',
  go: 'انطلق!',
  joined: '{name} انضم!',
  musicOn: 'الموسيقى: تشغيل',
  musicOff: 'الموسيقى: إيقاف',
  voiceOn: 'المعلّق: تشغيل',
  voiceOff: 'المعلّق: إيقاف',
  noVoice: 'لا يوجد صوت عربي على هذا الجهاز: أضِفه من إعدادات النظام ← تسهيلات الاستخدام ← المحتوى المنطوق',
  kbHint: 'لاعب لوحة المفاتيح: WASD والفأرة، و G للقنبلة (K مرة أخرى للإزالة)',
  needPlayers: 'انضم بهاتف أو أضف روبوتين على الأقل أولًا!',
  oops: 'أوبس!',
  'th.player': 'اللاعب',
  'th.flags': 'الأعلام',
  'th.kos': 'الإقصاءات',
  'th.downs': 'السقطات',
  backIn: 'العودة إلى القائمة خلال {n} ث',
  reconnecting: 'جارٍ إعادة الاتصال بخادم اللعبة…',

  'say.intro.ctf': 'التقاط العلم!',
  'say.intro.tdm': 'معركة الفرق!',
  'say.intro.ffa': 'الكل ضد الكل!',
  'say.fight': 'انطلقوا!',
  'say.firstBlood': 'الضربة الأولى!',
  'say.double': 'ضربة مزدوجة!',
  'say.triple': 'ضربة ثلاثية!',
  'say.unstoppable': 'لا أحد يوقفه!',
  'say.onFire': '{name} مشتعل!',
  'say.legendary': '{name} أسطوري!',
  'say.flagTaken': 'أُخذ علم الفريق {team}!',
  'say.scores': 'الفريق {team} يسجّل!',
  'say.flagReturned': 'عاد علم الفريق {team}',
  'say.flagDropped': 'سقط علم الفريق {team}',
  'say.teamWins': 'الفريق {team} يفوز!',
  'say.playerWins': '{name} يفوز!',
  'say.draw': 'تعادل!',

  'ba.scores': 'الفريق {team} يسجّل!',
  'ba.scoresSub': '{name} التقط العلم',
  'ba.onFire': '{name} مشتعل!',
  'ba.legendary': '{name} أسطوري!',
  'ba.streakSub': '{n} إقصاءات متتالية',
  'title.teamWins': 'الفريق {team} يفوز!',
  'title.playerWins': '{name} يفوز!',
  'title.draw': 'تعادل!',
  'to.grabbed': '{name} أخذ علم الفريق {team}!',
  'to.saved': '{name} أنقذ علم الفريق {team}!',
  'to.backHome': 'عاد علم الفريق {team} إلى القاعدة',
  'ft.firstBlood': 'الضربة الأولى!',
  'ft.double': 'ضربة مزدوجة!',
  'ft.triple': 'ضربة ثلاثية!',
  'ft.unstoppable': 'لا أحد يوقفه!',
  'pk.health': '+50 صحة',
  'pk.grenades': '+2 قنابل',
  'pk.power': 'ضرر مضاعف!',

  'w.blaster': 'مسدس الليزر',
  'w.shotgun': 'بندقية الرش',
  'w.minigun': 'الرشاش الدوّار',
  'w.rail': 'مدفع الشعاع',
  'w.rocket': 'الصواريخ',
  'w.flamer': 'قاذف اللهب',
  'w.bouncer': 'الكرات المرتدّة',

  'ph.name': 'اسمك',
  'ph.namePh': 'اكتب اسمك',
  'ph.color': 'لونك',
  'ph.join': 'انضم إلى اللعبة',
  'ph.connecting': 'جارٍ الاتصال…',
  'ph.ready': 'جاهز! اضغط «انضم إلى اللعبة»',
  'ph.watchTv': 'أشاهد التلفاز',
  'ph.watchPhone': 'اللعبة على هاتفي',
  'ph.redTeam': 'الفريق الأحمر',
  'ph.blueTeam': 'الفريق الأزرق',
  'ph.captain': '👑 أنت القائد',
  'ph.capHint': 'اضغط على أي إعداد لتغييره. هل الجميع جاهز؟ ابدأ!',
  'ph.waitCap': 'بانتظار 👑 {name} ليبدأ اللعبة…',
  'ph.left': 'الإبهام الأيسر',
  'ph.leftHow': 'تحرّك · ادفع للأعلى للقفز والطيران',
  'ph.right': 'الإبهام الأيمن',
  'ph.rightHow': 'صوّب وأطلق',
  'ph.edit': 'تغيير الاسم / اللون',
  'ph.move': 'تحرّك',
  'ph.moveSub': 'ادفع للأعلى للقفز والطيران',
  'ph.aim': 'صوّب وأطلق',
  'ph.aimSub': 'اسحب لتطلق',
  'ph.ko': 'أُصبت!',
  'ph.back': 'ستعود بعد لحظة…',
  'ph.won': 'فزت! 🎉',
  'ph.close': 'كانت قريبة جدًا!',
  'ph.gg': 'لعبة رائعة! في المرة القادمة!',
  'ph.kos': 'إقصاءات',
  'ph.downs': 'سقطات',
  'ph.flags': 'أعلام',
  'ph.mvp': 'الأفضل',
  'ph.toLobby': 'العودة إلى القائمة',
  'ph.captainNext': 'سيبدأ القائد الجولة التالية',
  'ph.rotate': 'أدِر هاتفك بالعرض',
  'ph.otherTab': 'يد التحكم مفتوحة في تبويب آخر. استخدم ذلك التبويب!',
  'ph.lost': 'انقطع الاتصال… جارٍ إعادة الاتصال',
  'ph.flagHome': '🚩 معك العلم! أرجِعه إلى قاعدتك!',
  'ph.power': '⚡ ضرر مضاعف!',
  'ph.readyDots': 'استعدّ…',
  'ph.teamLabel': 'الفريق {team}',
  'ph.ffa': 'الكل ضد الكل',
  'ph.viewTv': 'شاهد على التلفاز بدلًا من ذلك',
  'ph.viewPhone': 'اعرض اللعبة على هذا الهاتف',
  'ph.kosShort': 'إقصاء',
};

// Arabic counted nouns: 3–10 take the plural, 11+ the singular.
function arUnit(n, unit) {
  const few = n >= 3 && n <= 10;
  if (unit === 'captures') return few ? 'أعلام' : 'علمًا';
  return few ? 'إقصاءات' : 'إقصاءً';
}

const DICTS = { en, ar };
export const LANGS = ['en', 'ar'];
export const FUN_NAMES = {
  en: ['Captain Pickle', 'Turbo Taco', 'Ninja Noodle', 'Space Potato', 'Laser Llama', 'Mega Muffin', 'Pixel Panda', 'Thunder Toast', 'Rocket Rabbit', 'Jet Jelly'],
  ar: ['كابتن فلافل', 'صاروخ كنافة', 'نينجا الشاي', 'بطاطا فضائية', 'نمر الليزر', 'برق الصحراء', 'الفهد النفاث', 'رعد الصغير', 'القط المقاتل', 'بطل الكنبة'],
};

let lang = 'en';
export const getLang = () => lang;

// Switch language; also flips the page to right-to-left for Arabic.
export function setLang(l) {
  const next = DICTS[l] ? l : 'en';
  const changed = next !== lang;
  lang = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }
  return changed;
}

export function t(key, params = {}) {
  const v = DICTS[lang][key] ?? en[key] ?? key;
  const p = { ...params };
  if (p.team === 'red' || p.team === 'blue') p.team = t(`team.${p.team}`);
  if (typeof v === 'function') return v(p);
  return v.replace(/\{(\w+)(\|up)?\}/g, (m, k, up) => {
    const s = p[k] === undefined ? '' : String(p[k]);
    return up ? s.toUpperCase() : s;
  });
}

// Fill every element marked data-i18n (text) or data-i18n-html (markup).
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
}

// Text for one lobby setting, e.g. { key: 'mode', v: 'ctf' }.
export function settingText(s) {
  switch (s.key) {
    case 'mode': return t(`mode.${s.v}`);
    case 'map': return t(`map.${s.v}`);
    case 'screen': return t(`screen.${s.v}`);
    case 'bots': return s.v ? String(s.v) : t('none');
    case 'skill': return t(`skill.${s.v}`);
    case 'limit': return t('limit', { n: s.v, unit: s.unit });
    case 'time': return t('minutes', { n: s.v });
    case 'assist': return t(s.v ? 'on' : 'off');
    case 'lang': return t(`lang.${s.v}`);
    default: return String(s.v);
  }
}

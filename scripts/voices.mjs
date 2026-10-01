// Makes an announcer voice pack with AI (see tools/voice/README.md):
//   npm run voices                      Arabic + English "announcer" pack
//   npm run voices -- --lang ar --only fight,draw
//   npm run voices -- --pack baba --ref ~/Desktop/baba.m4a --name "Baba" --lang ar
//   npm run voices -- --teams           team lines with the names from public/family/family.json
// The lines come from the game's own translations (public/js/i18n.js).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setLang, setTeamNames, t, LANGS } from '../public/js/i18n.js';
import { VOICE_LINES, clipName } from '../public/js/audio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools/voice');
const py = path.join(TOOL, '.venv/bin/python');
let args = process.argv.slice(2);

// --teams: only the lines that name a team, said with the family's team names,
// saved next to family.json (so they stay off GitHub) for the chosen pack.
const teamsOnly = args.includes('--teams');
if (teamsOnly) {
  args = args.filter((a) => a !== '--teams');
  const file = path.join(ROOT, 'public/family/family.json');
  let teams;
  try {
    teams = JSON.parse(fs.readFileSync(file, 'utf8')).teams;
  } catch {
    console.log(`Put the team names in ${path.relative(ROOT, file)} first (see README).`);
    process.exit(1);
  }
  setTeamNames(teams);
  const i = args.indexOf('--pack');
  const pack = i >= 0 ? args[i + 1] : 'announcer';
  const names = VOICE_LINES.team.flatMap((key) => ['red', 'blue'].map((team) => clipName(key, { team })));
  args.push('--out', path.join(ROOT, 'public/family/voices', pack));
  if (!args.includes('--only')) args.push('--only', names.join(','));
}

const lines = {};
for (const lang of LANGS) {
  setLang(lang);
  const L = (lines[lang] = {});
  for (const key of VOICE_LINES.plain) L[clipName(key)] = t(`say.${key}`);
  for (const key of VOICE_LINES.team) for (const team of ['red', 'blue']) L[clipName(key, { team })] = t(`say.${key}`, { team });
  for (const key of VOICE_LINES.named) L[clipName(key)] = t(`clip.${key}`);
}
fs.writeFileSync(path.join(TOOL, 'lines.json'), JSON.stringify(lines, null, 2));

if (!fs.existsSync(py)) {
  console.log('The voice tool is not installed yet. Run this once first:\n\n  npm run voices:setup\n');
  process.exit(1);
}
const r = spawnSync(py, [path.join(TOOL, 'generate.py'), ...args], { stdio: 'inherit', cwd: TOOL });
process.exit(r.status ?? 1);

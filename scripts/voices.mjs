// Makes an announcer voice pack with AI (see tools/voice/README.md):
//   npm run voices                      Arabic + English "announcer" pack
//   npm run voices -- --lang ar --only fight,draw
//   npm run voices -- --pack baba --ref ~/Desktop/baba.m4a --name "Baba" --lang ar
// The lines come from the game's own translations (public/js/i18n.js).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setLang, t, LANGS } from '../public/js/i18n.js';
import { VOICE_LINES, clipName } from '../public/js/audio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools/voice');
const py = path.join(TOOL, '.venv/bin/python');

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
const r = spawnSync(py, [path.join(TOOL, 'generate.py'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: TOOL });
process.exit(r.status ?? 1);

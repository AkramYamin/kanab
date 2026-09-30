# Announcer voices (AI)

The announcer lines ("First blood!", "الفريق الأحمر يسجّل!", …) are short MP3
clips in `public/voices/<pack>/<lang>/`. They are made on your own computer
with two open models:

- **[Chatterbox Multilingual](https://github.com/resemble-ai/chatterbox)**
  (Resemble AI, MIT license) turns text into speech in 23 languages,
  Arabic included, in the voice of a short recording you give it.
- **[Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo)**
  (OpenAI, MIT license) listens to every take. Each line is spoken 3 times and
  the take Whisper understands best is kept. `takes/<pack>/report.json` shows
  what it heard.

You only need this to *make* new clips. Playing the game needs none of it.

## Setup (once)

```bash
npm run voices:setup
```

This puts a private Python 3.11 and the packages in `tools/voice/`
(about 1 GB). The first `npm run voices` also downloads the models into
`tools/voice/.cache` (about 5 GB). Nothing is installed system-wide: delete
`tools/voice/.venv`, `.python`, `.bootstrap` and `.cache` to remove it all.

It runs on the Apple Silicon GPU, an NVIDIA GPU, or (slowly) the CPU. On an
M1 Pro one line takes about 40 seconds (3 takes plus the checks), so a full
pack of 44 lines takes about half an hour.

## Make the built-in announcer

```bash
npm run voices                              # Arabic + English
npm run voices -- --lang ar                 # only Arabic
npm run voices -- --only fight,scores_red   # redo a few lines
npm run voices -- --takes 5                 # more takes to choose from
```

The lines come from the `say.*` and `clip.*` texts in `public/js/i18n.js`, so
changing a line there and running the tool again keeps everything in sync. The
default voice is the male Arabic demo voice from the Chatterbox project
(`mtl_prompts/ar_m1.flac`), used for both languages so the announcer sounds
like the same person.

## Make a family voice pack

1. Record 5–10 seconds of clear speech in a quiet room: any sentence, spoken
   with energy, in the language of the pack. A phone's voice memo app works.
   Copy the file to the laptop (m4a, mp3, wav, aiff and flac all work).
2. Make the pack:

   ```bash
   npm run voices -- --pack baba --name "Baba" --ref ~/Desktop/baba.m4a --lang ar
   ```

3. In the lobby, click **Announcer** until it shows *Baba*.

Only copy the voices of people who said yes. Packs other than `announcer` are
in `.gitignore`, so family voices stay on your computer and never end up on
GitHub.

## Tips

- Don't like a line? Listen to its takes in `tools/voice/takes/<pack>/<lang>/`
  and keep another one with `npm run voices -- --lang ar --pick fight=2`, or
  make new takes with `--only fight --takes 5`. Clip names are the file names
  in `public/voices/<pack>/<lang>/`.
- If a word keeps coming out wrong, give the model a little more context. The
  Arabic "Legendary!" clip says «بطل أسطوري!» because «أسطوري!» on its own
  kept losing its first sound. Those clip-only texts are the `clip.*` lines in
  `public/js/i18n.js`.
- Chatterbox adds an inaudible watermark to what it makes, so AI speech can be
  recognized as AI speech.

"""Make an announcer voice pack for Couch Commandos with AI.

Chatterbox (Resemble AI, MIT license) turns each announcer line into speech in
the voice of a short reference recording. Every line is spoken a few times
("takes"); Whisper (OpenAI's speech recognizer) listens to each take and the
one it understands best is kept, trimmed, levelled and saved as an MP3 in
public/voices/<pack>/<lang>/. Run it through npm (see tools/voice/README.md):

  npm run voices
  npm run voices -- --lang ar --only fight,draw
  npm run voices -- --pack baba --ref ~/Desktop/baba.m4a --name "Baba" --lang ar
  npm run voices -- --lang ar --pick fight=2     (keep take 2 of a line instead)
"""

import argparse
import difflib
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.request
import warnings
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
os.environ.setdefault("HF_HOME", str(HERE / ".cache" / "hf"))  # models stay in this folder
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import soundfile  # noqa: E402
import torch  # noqa: E402

# Official Chatterbox demo voices (a male Arabic speaker is the default announcer).
DEFAULT_REFS = {
    "ar": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/ar_m1.flac",
    "en": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/ar_m1.flac",
}
PACK_NAMES = {"announcer": {"en": "Arena announcer", "ar": "معلّق الحلبة"}}
LANG_NAMES = {"ar": "arabic", "en": "english"}
# (exaggeration, cfg_weight): calmer to wilder. Lower cfg + more exaggeration = more excited.
TAKES = [(0.6, 0.4), (0.75, 0.35), (0.9, 0.3), (0.7, 0.45), (1.0, 0.3)]


def pick_device():
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


DEVICE = pick_device()
_load = torch.load


def _load_here(*a, **k):
    # Checkpoints were saved on CUDA; load them onto whatever this machine has.
    k.setdefault("map_location", torch.device(DEVICE))
    return _load(*a, **k)


torch.load = _load_here


# ------------------------------------------------------------------ helpers

AR_MARKS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")


def normalize(text):
    """Compare what was said with what we wanted, ignoring spelling details."""
    s = AR_MARKS.sub("", text.lower()).replace("'", "").replace("’", "")
    s = re.sub("[إأآٱ]", "ا", s).replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def similarity(a, b):
    return difflib.SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def trim(x, sr):
    """Cut the silence around the words, with short fades so nothing clicks."""
    frame = int(sr * 0.02)
    n = len(x) // frame
    if n < 3:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    loud = np.where(20 * np.log10(rms / rms.max()) > -38)[0]
    if not len(loud):
        return x
    a = max(0, loud[0] * frame - int(0.03 * sr))
    b = min(len(x), (loud[-1] + 1) * frame + int(0.12 * sr))
    y = x[a:b].copy()
    fi, fo = int(0.008 * sr), int(0.04 * sr)
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo)
    return y


def level(x, sr):
    """Same loudness for every clip (about -16 LUFS), peaks under -1 dB."""
    import pyloudnorm

    meter = pyloudnorm.Meter(sr)
    padded = np.pad(x, (0, max(0, int(0.5 * sr) - len(x))))
    lufs = meter.integrated_loudness(padded)
    if np.isfinite(lufs):
        x = x * (10 ** ((-16 - lufs) / 20))
    peak = np.abs(x).max()
    return x * (0.89 / peak) if peak > 0.89 else x


def to_mp3(x, sr, path):
    import lameenc

    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    path.write_bytes(enc.encode(pcm) + enc.flush())


def reference(arg, lang):
    """A WAV/FLAC file Chatterbox can read. Other formats go through macOS afconvert."""
    refs = HERE / "refs"
    refs.mkdir(exist_ok=True)
    if not arg:
        url = DEFAULT_REFS[lang]
        path = refs / url.rsplit("/", 1)[1]
        if not path.exists():
            print(f"Downloading the default voice {url}")
            urllib.request.urlretrieve(url, path)
        return path
    src = Path(arg).expanduser().resolve()
    if src.suffix.lower() in (".wav", ".flac"):
        return src
    out = refs / (src.stem + ".wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@24000", "-c", "1", str(src), str(out)], check=True)
    return out


# --------------------------------------------------------------------- main


def pick_takes(args):
    """Swap in takes chosen by ear (no AI needed)."""
    lang = args.lang.split(",")[0]
    takes_dir = HERE / "takes" / args.pack / lang
    out_dir = ROOT / "public" / "voices" / args.pack / lang
    report_path = HERE / "takes" / args.pack / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else []
    for item in args.pick.split(","):
        clip, n = item.split("=")
        x, sr = soundfile.read(takes_dir / f"{clip}_{n}.wav", dtype="float32")
        to_mp3(x, sr, out_dir / f"{clip}.mp3")
        for r in report:
            if r["lang"] == lang and r["clip"] == clip:
                r["kept"] = int(n)
        print(f"  {lang}/{clip}: now using take {n}")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description="Make announcer voice clips with AI.")
    ap.add_argument("--pack", default="announcer", help="folder name in public/voices (default: announcer)")
    ap.add_argument("--lang", default="ar,en", help="languages, e.g. ar or ar,en")
    ap.add_argument("--ref", help="recording of the voice to copy (5-10 s of clear speech); default: a demo announcer")
    ap.add_argument("--name", help="name shown in the lobby, e.g. Baba")
    ap.add_argument("--only", help="comma-separated clip names to (re)make, e.g. fight,scores_red")
    ap.add_argument("--takes", type=int, default=3, help="takes per line; Whisper keeps the best (default 3)")
    ap.add_argument("--pick", help="keep other takes instead, e.g. fight=2,draw=1 (listen in tools/voice/takes/)")
    args = ap.parse_args()
    if args.pick:
        return pick_takes(args)

    lines = json.loads((HERE / "lines.json").read_text())
    langs = [x.strip() for x in args.lang.split(",") if x.strip()]
    only = set(args.only.split(",")) if args.only else None
    out_dir = ROOT / "public" / "voices" / args.pack
    takes_dir = HERE / "takes" / args.pack

    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from transformers import pipeline
    import librosa

    print(f"Loading Chatterbox on {DEVICE} (the first run downloads about 3 GB)…", flush=True)
    tts = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
    print("Loading Whisper to check the takes…", flush=True)
    asr = pipeline(
        "automatic-speech-recognition", model="openai/whisper-large-v3-turbo", device=DEVICE,
        dtype=torch.float16 if DEVICE != "cpu" else torch.float32,
    )

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.setdefault("name", {"en": args.name, "ar": args.name} if args.name else PACK_NAMES.get(args.pack, {"en": args.pack}))
    manifest["ext"] = "mp3"
    manifest["made_with"] = "Chatterbox Multilingual TTS (Resemble AI, MIT), checked with Whisper large-v3-turbo"
    manifest.setdefault("clips", {})
    report = []

    for lang in langs:
        ref = reference(args.ref, lang)
        (out_dir / lang).mkdir(parents=True, exist_ok=True)
        (takes_dir / lang).mkdir(parents=True, exist_ok=True)
        todo = {k: v for k, v in lines[lang].items() if not only or k in only}
        print(f"\n[{lang}] {len(todo)} lines in the voice of {ref.name}", flush=True)
        for i, (clip, text) in enumerate(todo.items(), 1):
            t0 = time.time()
            results = []
            for n, (ex, cfg) in enumerate(TAKES[: args.takes]):
                seed = zlib.crc32(f"{lang}/{clip}/{n}".encode()) % 100000
                random.seed(seed)
                np.random.seed(seed)
                torch.manual_seed(seed)
                wav = tts.generate(text, language_id=lang, audio_prompt_path=str(ref), exaggeration=ex, cfg_weight=cfg, temperature=0.8)
                x = level(trim(wav.squeeze(0).cpu().numpy().astype(np.float32), tts.sr), tts.sr)
                heard = asr(
                    {"raw": librosa.resample(x, orig_sr=tts.sr, target_sr=16000), "sampling_rate": 16000},
                    generate_kwargs={"language": LANG_NAMES[lang], "task": "transcribe"},
                )["text"].strip()
                sim = similarity(heard, text)
                dur = len(x) / tts.sr
                # Much too long for the words usually means mumbling or extra noises.
                too_long = dur > 1.2 + 0.15 * len(normalize(text))
                score = sim - (0.1 if too_long else 0) + 0.01 * n  # ties go to the livelier take
                results.append((score, sim, dur, n, heard, x))
                soundfile.write(takes_dir / lang / f"{clip}_{n + 1}.wav", x, tts.sr)
            best = max(results, key=lambda r: r[0])
            to_mp3(best[5], tts.sr, out_dir / lang / f"{clip}.mp3")
            flag = "" if best[1] >= 0.8 else "   <-- check this one"
            print(f"  {i:2}/{len(todo)} {clip:18} take {best[3] + 1}  heard “{best[4]}”  {best[1]:.0%}  {best[2]:.1f}s  ({time.time() - t0:.0f}s){flag}", flush=True)
            report.append({
                "lang": lang, "clip": clip, "text": text, "kept": best[3] + 1,
                "takes": [{"take": r[3] + 1, "heard": r[4], "match": round(r[1], 3), "seconds": round(r[2], 2)} for r in sorted(results, key=lambda r: r[3])],
            })
        manifest["clips"][lang] = sorted(p.stem for p in (out_dir / lang).glob("*.mp3"))

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    # Keep earlier results for lines that were not remade this time.
    report_path = takes_dir / "report.json"
    done = {(r["lang"], r["clip"]) for r in report}
    old = json.loads(report_path.read_text()) if report_path.exists() else []
    report = [r for r in old if (r["lang"], r["clip"]) not in done] + report
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\nSaved to {out_dir.relative_to(ROOT)}. All takes: {takes_dir.relative_to(ROOT)} (report.json lists what Whisper heard).")
    print("Pick the pack with the lobby's Announcer setting.")


if __name__ == "__main__":
    sys.exit(main())

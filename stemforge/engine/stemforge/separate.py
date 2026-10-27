"""Stem separation pipelines built on python-audio-separator.

fast: one Demucs pass (htdemucs / htdemucs_6s).
best: BS-RoFormer pulls the vocals first (cleaner vocals, less bleed), then Demucs
      splits the remaining instrumental. Whatever vocal residue Demucs still finds in
      the instrumental is folded into "other" so no audio is lost.
"""

from pathlib import Path

import numpy as np

from stemforge import audio

ROFORMER = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
DEMUCS_FAST = "htdemucs.yaml"
DEMUCS_FINE = "htdemucs_ft.yaml"
DEMUCS_6 = "htdemucs_6s.yaml"

# Demucs/RoFormer stem labels -> our stem keys
LABELS = {
    "vocals": "vocals", "instrumental": "instrumental", "drums": "drums",
    "bass": "bass", "other": "other", "guitar": "guitar", "piano": "piano",
}

STEMS = {
    "vocals": ["vocals", "instrumental"],
    "4stem": ["vocals", "drums", "bass", "other"],
    "6stem": ["vocals", "drums", "bass", "guitar", "piano", "other"],
}

DISPLAY = {
    "vocals": "Vocals", "instrumental": "Instrumental", "drums": "Drums", "bass": "Bass",
    "guitar": "Guitar", "piano": "Keys", "other": "Other",
}


def models_for(mode, quality):
    """The model files a mode/quality pair downloads, in pipeline order."""
    if quality == "best":
        second = {"vocals": None, "4stem": DEMUCS_FINE, "6stem": DEMUCS_6}[mode]
        return [ROFORMER] + ([second] if second else [])
    return [DEMUCS_6 if mode == "6stem" else DEMUCS_FAST]


def robust_download(url, output_path, verify_existing=False, attempts=6, timeout=60, log=lambda msg: None):
    """Download url to output_path via a .part file with resume, retries and a size check.

    audio-separator's own downloader writes straight to the final name and skips any file
    that exists, so one dropped connection leaves a truncated model that is never repaired.
    """
    import time

    import requests

    out = Path(output_path)
    if out.is_file():
        if not verify_existing:
            return
        try:
            expected = int(requests.head(url, allow_redirects=True, timeout=timeout).headers.get("content-length", 0))
        except requests.RequestException:
            return  # offline: keep what we have
        if not expected or out.stat().st_size == expected:
            return
        log("Re-downloading truncated %s (%d of %d bytes)" % (out.name, out.stat().st_size, expected))
        out.unlink()

    part = out.with_name(out.name + ".part")
    expected = None
    for attempt in range(1, attempts + 1):
        have = part.stat().st_size if part.exists() else 0
        headers = {"Range": "bytes=%d-" % have} if have else {}
        try:
            with requests.get(url, stream=True, timeout=timeout, headers=headers, allow_redirects=True) as r:
                if r.status_code == 416:  # already complete
                    break
                r.raise_for_status()
                if r.status_code != 206:
                    have = 0  # server ignored Range: start over
                length = int(r.headers.get("content-length", 0))
                expected = have + length if length else None
                with open(part, "ab" if have else "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        f.write(chunk)
            if expected is None or part.stat().st_size >= expected:
                break
            raise IOError("incomplete download (%d of %d bytes)" % (part.stat().st_size, expected))
        except (requests.RequestException, IOError) as e:
            if attempt == attempts:
                raise RuntimeError("Download of %s failed after %d attempts: %s" % (out.name, attempts, e))
            wait = min(30, 2 ** attempt)
            log("Connection dropped (%s); resuming in %ds (attempt %d/%d)" % (e.__class__.__name__, wait, attempt + 1, attempts))
            time.sleep(wait)
    if expected is not None and part.stat().st_size != expected:
        raise RuntimeError("Download of %s is %d bytes, expected %d" % (out.name, part.stat().st_size, expected))
    part.replace(out)


def make_separator(verify_existing=False, log=lambda msg: None, **kwargs):
    """An audio-separator Separator whose model downloads go through robust_download."""
    from audio_separator.separator import Separator

    sep = Separator(log_level=30, **kwargs)
    sep.download_file_if_not_exists = lambda url, path: robust_download(url, path, verify_existing, log=log)
    return sep


class AudioSeparatorBackend:
    """Thin wrapper so the pipeline can be tested with a fake backend."""

    def __init__(self, models_dir):
        self.models_dir = str(models_dir)
        self._separator = None
        self._loaded = None

    def run(self, model_file, input_wav, out_dir, prefix):
        out_dir = Path(out_dir)
        if self._separator is None or self._separator.output_dir != str(out_dir):
            self._separator = make_separator(model_file_dir=self.models_dir, output_dir=str(out_dir),
                                             output_format="WAV")
            self._loaded = None
        if self._loaded != model_file:
            self._separator.load_model(model_file)
            self._loaded = model_file
        names = {label: "%s_%s" % (prefix, key) for label, key in LABELS.items()}
        self._separator.separate(str(input_wav), custom_output_names=names)
        found = {}
        for key in LABELS.values():
            path = out_dir / ("%s_%s.wav" % (prefix, key))
            if path.exists():
                found[key] = path
        if not found:
            raise RuntimeError("Separation produced no stems with %s" % model_file)
        return found


def _sum(paths):
    total, sr = None, None
    for p in paths:
        data, sr = audio.read(p)
        total = data if total is None else _add(total, data)
    return total, sr


def _add(a, b):
    n = max(len(a), len(b))
    out = np.zeros((n, a.shape[1]), dtype=np.float32)
    out[:len(a)] += a
    out[:len(b)] += b
    return out


def separate(mix_wav, work_dir, mode, quality, backend, report=lambda pct, msg: None):
    """Return {stem_key: Path} for the requested mode, files written under work_dir."""
    if mode not in STEMS:
        raise ValueError("mode must be one of %s" % ", ".join(STEMS))
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    wanted = STEMS[mode]

    if quality == "best":
        report(10, "Isolating vocals (BS-RoFormer)...")
        first = backend.run(ROFORMER, mix_wav, work_dir, "pass1")
        if mode == "vocals":
            return {k: first[k] for k in wanted}
        report(45, "Splitting instruments (Demucs)...")
        second = backend.run(models_for(mode, quality)[1], first["instrumental"], work_dir, "pass2")
        stems = {"vocals": first["vocals"]}
        for key in wanted:
            if key != "vocals" and key in second:
                stems[key] = second[key]
        # fold Demucs' leftover vocal bleed into "other" so the stems still sum to the mix
        if "vocals" in second and "other" in stems:
            merged, sr = _sum([stems["other"], second["vocals"]])
            out = work_dir / "pass2_other_merged.wav"
            audio.write(out, merged, sr)
            stems["other"] = out
        return stems

    model = models_for(mode, quality)[0]
    report(10, "Separating stems (Demucs %s)..." % model.split(".")[0])
    result = backend.run(model, mix_wav, work_dir, "pass1")
    if mode == "vocals":
        rest = [p for k, p in result.items() if k != "vocals"]
        merged, sr = _sum(rest)
        out = work_dir / "pass1_instrumental_merged.wav"
        audio.write(out, merged, sr)
        return {"vocals": result["vocals"], "instrumental": out}
    return {k: result[k] for k in wanted if k in result}


def drop_silent(stems, mix_rms_db, keep=("vocals",), margin_db=40.0, floor_db=-60.0):
    """Split stems into (kept, dropped) by loudness relative to the mix."""
    kept, dropped = {}, []
    for key, path in stems.items():
        data, _ = audio.read(path)
        level = audio.rms_db(data)
        if key in keep or (level > floor_db and level > mix_rms_db - margin_db):
            kept[key] = path
        else:
            dropped.append(key)
    return kept, dropped

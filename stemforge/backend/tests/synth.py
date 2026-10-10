"""Synthetic multi-instrument test track (no copyrighted audio needed)."""
import numpy as np

SR = 44100


def make_track(seconds: float = 8.0, bpm: float = 120.0, seed: int = 0,
               organ: bool = True, percussion: bool = True) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    beat = 60.0 / bpm
    mix_l = np.zeros(n, np.float32)
    mix_r = np.zeros(n, np.float32)

    def add(sig, pan=0.0, at=0):
        end = at + len(sig)
        mix_l[at:end] += sig * np.sqrt((1 - pan) / 2)
        mix_r[at:end] += sig * np.sqrt((1 + pan) / 2)

    # Kick on every beat, snare on 2 & 4, hats on 8ths.
    kick = np.zeros(n); snare = np.zeros(n); hat = np.zeros(n)
    for i, start in enumerate(np.arange(0, seconds, beat)):
        s = int(start * SR); L = min(int(0.25 * SR), n - s); tt = np.arange(L) / SR
        kick[s:s + L] += np.sin(2 * np.pi * (50 + 80 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 12)
        if i % 2 == 1:
            snare[s:s + L] += rng.standard_normal(L) * np.exp(-tt * 20) * 0.5
    for start in np.arange(0, seconds, beat / 2):
        s = int(start * SR); L = min(int(0.05 * SR), n - s)
        hat[s:s + L] += np.diff(rng.standard_normal(L + 1)) * np.exp(-np.arange(L) / SR * 80) * 0.25
    add(kick * 0.8); add(snare * 0.6); add(hat * 0.5, 0.2)

    # Bass: root notes.
    f_bass = np.where((t // (beat * 4)) % 2 == 0, 55.0, 73.4)
    add(np.sin(2 * np.pi * np.cumsum(f_bass) / SR) * 0.35)

    # Piano-like: decaying harmonic plucks.
    for k, start in enumerate(np.arange(0, seconds, beat)):
        s = int(start * SR); L = min(int(1.0 * SR), n - s); tt = np.arange(L) / SR
        f0 = [261.6, 329.6, 392.0, 329.6][k % 4]
        tone = sum(np.sin(2 * np.pi * f0 * h * tt) / h for h in range(1, 6))
        add(tone * np.exp(-tt * 4) * 0.12, -0.3, s)

    # Organ: sustained drawbar tone with Leslie tremolo.
    if organ:
        f0 = 196.0
        tone = sum(np.sin(2 * np.pi * f0 * h * t) / (1 + 0.3 * h) for h in (1, 2, 3, 4, 6, 8))
        add(tone * (1 + 0.3 * np.sin(2 * np.pi * 6.5 * t)) * 0.05, 0.4)

    # Shaker: dense high-band noise on 16ths.
    if percussion:
        for start in np.arange(0, seconds, beat / 4):
            s = int(start * SR); L = min(int(0.06 * SR), n - s)
            noise = np.diff(np.diff(rng.standard_normal(L + 2)))
            add(noise * np.hanning(L) * 0.08, -0.5, s)

    # "Vocal": vibrato tone with formants, centre panned.
    f_v = 220 * (1 + 0.01 * np.sin(2 * np.pi * 5 * t))
    phase = 2 * np.pi * np.cumsum(f_v) / SR
    voice = sum(np.sin(h * phase) * np.exp(-((h * 220 - 700) / 500) ** 2) for h in range(1, 20))
    gate = ((t % (beat * 2)) < beat * 1.5).astype(float)
    add(voice * gate * 0.12)

    mix = np.stack([mix_l, mix_r]).astype(np.float32)
    return mix / (np.abs(mix).max() + 1e-9) * 0.9

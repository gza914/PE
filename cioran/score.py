"""Dark ambient score for 'The Trouble' (60 s). Pure synthesis: numpy + scipy."""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 60.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

def env(points):
    """Piecewise-linear envelope from (time, value) pairs."""
    ts, vs = zip(*points)
    return np.interp(t, ts, vs)

def smooth_noise(rate, seed):
    r = np.random.default_rng(seed)
    k = int(DUR * rate) + 4
    pts = r.standard_normal(k)
    x = np.linspace(0, k - 3, N)
    i = np.floor(x).astype(int); f = x - i
    # cubic-ish smoothing
    f2 = f * f * (3 - 2 * f)
    return pts[i] * (1 - f2) + pts[i + 1] * f2

def lp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'low'); return signal.lfilter(b, a, x)

def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band'); return signal.lfilter(b, a, x)

# --- impulse response: long dark hall -------------------------------------------------
def make_ir(sec=7.0, seed=1):
    n = int(sec * SR); tt = np.arange(n) / SR
    out = []
    for ch in range(2):
        r = np.random.default_rng(seed + ch)
        ir = r.standard_normal(n) * np.exp(-tt / 1.6)
        ir = lp(ir, 2600, 1)
        ir[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return out
IR = make_ir()

def reverb(x, wet=0.6):
    L = signal.fftconvolve(x, IR[0])[:N]; R = signal.fftconvolve(x, IR[1])[:N]
    return np.stack([x * (1 - wet) + L * wet, x * (1 - wet) + R * wet])

# --- 1. drone: D, detuned, beating ---------------------------------------------------
def drone():
    out = np.zeros(N)
    parts = [(36.71, 1.0), (36.9, 0.7), (55.0, 0.55), (73.42, 0.45), (73.7, 0.3),
             (110.0, 0.12), (146.8, 0.07)]
    for i, (f, a) in enumerate(parts):
        drift = 1 + 0.0015 * smooth_noise(0.15, 10 + i)
        ph = 2 * np.pi * np.cumsum(f * drift) / SR
        am = 0.75 + 0.25 * smooth_noise(0.2, 30 + i)
        out += a * np.sin(ph) * am
    # soft saturation for weight, then darken
    out = np.tanh(out * 0.9)
    return lp(out, 400)

# --- 2. upper cluster: F / A / E, very quiet, slow swells ----------------------------
def cluster():
    out = np.zeros(N)
    for i, f in enumerate([174.61, 220.0, 329.63, 349.23]):
        ph = 2 * np.pi * np.cumsum(f * (1 + 0.002 * smooth_noise(0.1, 50 + i))) / SR
        saw = sum(np.sin(k * ph) / k for k in range(1, 7))
        am = np.clip(0.5 + 0.6 * smooth_noise(0.07, 70 + i), 0, 1)
        out += saw * am * 0.25
    fc_mod = smooth_noise(0.05, 99)
    # emulate a slowly moving filter by crossfading two lowpassed copies
    a, b = lp(out, 500), lp(out, 1400)
    m = np.clip(0.5 + 0.5 * fc_mod, 0, 1)
    return a * (1 - m) + b * m

# --- 3. air: filtered noise, like a draught in an empty building ---------------------
def air():
    n = rng.standard_normal(N)
    brown = np.cumsum(n); brown -= lp(brown, 20)  # remove DC walk
    x = bp(n, 180, 900) * 0.5 + bp(brown, 60, 300) * 0.004
    return x * (0.6 + 0.4 * smooth_noise(0.25, 5))

# --- 4. struck low notes: muted, inharmonic, felt-piano-like ------------------------
def strike(f0, at, amp=1.0, decay=5.0):
    out = np.zeros(N)
    s = int(at * SR); n = N - s
    tt = np.arange(n) / SR
    partials = [(1, 1.0, 1.0), (2.003, 0.45, 0.6), (3.01, 0.2, 0.45), (4.03, 0.1, 0.3),
                (5.07, 0.05, 0.25), (6.9, 0.03, 0.15)]
    atk = 1 - np.exp(-tt / 0.012)
    for mult, a, dscale in partials:
        out[s:] += a * np.sin(2 * np.pi * f0 * mult * tt) * np.exp(-tt / (decay * dscale))
    out[s:] *= atk
    # felt thump
    th = rng.standard_normal(n) * np.exp(-tt / 0.03)
    out[s:] += lp(th, 300) * 0.15
    return out * amp

# --- 5. bowed metal: rising inharmonic shimmer before the midpoint -------------------
def bowed(start, end, peak):
    out = np.zeros(N)
    for i, f in enumerate([612.0, 887.5, 1311.0, 1873.0]):
        ph = 2 * np.pi * np.cumsum(f * (1 + 0.003 * smooth_noise(0.3, 120 + i))) / SR
        out += np.sin(ph) / (i + 1)
    e = env([(0, 0), (start, 0), (peak, 1), (end, 0), (DUR, 0)]) ** 2
    return out * e

# --- arrangement --------------------------------------------------------------------
CUT = 34.2          # midpoint: everything falls away
BACK = 35.6         # and returns, lower
END = 57.0          # slit closes: silence

d = drone()
d_env = env([(0, 0), (4, 0.55), (14, 0.75), (33.8, 1.0), (CUT, 1.0), (CUT + 0.02, 0),
             (BACK, 0), (BACK + 2.5, 0.85), (50, 1.0), (END - 0.05, 1.0), (END, 0), (DUR, 0)])
c = cluster()
c_env = env([(0, 0), (8, 0), (16, 0.35), (30, 0.6), (CUT, 0.7), (CUT + 0.02, 0),
             (BACK + 3, 0), (46, 0.25), (54, 0.45), (END - 0.05, 0.45), (END, 0), (DUR, 0)])
a = air()
a_env = env([(0, 0.0), (2.5, 0.5), (CUT, 0.8), (CUT + 0.02, 0.0), (CUT + 0.6, 0.12),
             (BACK, 0.12), (BACK + 2, 0.6), (END - 0.05, 0.9), (END, 0), (DUR, 0)])
b = bowed(24.0, CUT + 0.01, CUT - 0.1)

dry = d * d_env * 0.55 + c * c_env * 0.10 + a * a_env * 0.35 + b * 0.035

# struck notes — one under each aphorism, descending; the last rings into the silence
notes = [(110.0, 5.0, 0.8), (87.31, 14.6, 0.75), (73.42, 24.6, 0.8),
         (69.30, BACK + 0.2, 0.9), (55.0, 46.4, 0.85), (73.42, END, 1.0)]
hits = sum(strike(f, at, amp) for f, at, amp in notes)

mix = reverb(dry, wet=0.45) + reverb(hits * 0.22, wet=0.8)
# the midpoint silence must be true: kill any dry bleed but let the reverb tail breathe
gate = env([(0, 1), (CUT, 1), (CUT + 0.01, 0.12), (BACK - 0.3, 0.12), (BACK, 1), (DUR, 1)])
mix *= gate
# gentle fade of the very last tail
mix *= env([(0, 1), (58.2, 1), (DUR, 0)])

# master: highpass sub-rumble, soft limit, normalize to about -1 dBFS peak
b_, a_ = signal.butter(2, 28 / (SR / 2), 'high')
mix = signal.lfilter(b_, a_, mix, axis=1)
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.3) / np.tanh(1.3) * 0.89
wavfile.write(sys.argv[1] if len(sys.argv) > 1 else 'score.wav', SR, (mix.T * 32767).astype(np.int16))
print('ok', mix.shape)

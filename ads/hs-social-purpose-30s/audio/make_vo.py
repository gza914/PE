"""Scratch VO via Piper TTS (en_US-lessac-high): python3 make_vo.py <voice.onnx> [length_scale].
Replace with licensed VO talent before airing."""
import wave, json, sys
from piper import PiperVoice
from piper.config import SynthesisConfig
LINES = [
 "For the people you serve, a diploma changes everything.",
 "But building a high school program on your own is a lot to carry.",
 "Penn Foster partners with nonprofits, youth organizations, and work-force boards to deliver an accredited online high school diploma.",
 "Self-paced, with wraparound support that keeps learners moving forward.",
 "In twenty twenty-five alone, more than forty-five thousand students graduated.",
 "Penn Foster. Let's open the door to what's next, together.",
]
v = PiperVoice.load(sys.argv[1])
cfg = SynthesisConfig(length_scale=float(sys.argv[2]) if len(sys.argv) > 2 else 0.95, noise_scale=0.6, noise_w_scale=0.8)
out = []
for i, t in enumerate(LINES):
    with wave.open(f"vo_{i}.wav", "wb") as w:
        v.synthesize_wav(t, w, syn_config=cfg)
    with wave.open(f"vo_{i}.wav") as w: d = w.getnframes() / w.getframerate(); sr = w.getframerate()
    out.append(d); print(i, round(d, 2))
print("total", round(sum(out), 2), "sr", sr)

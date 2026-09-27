"""Render 'The Trouble' — a 60-second film on Cioran and suffering.

The frame is a letterbox that closes, slowly and without pause, over the whole
minute: the image is a slit that narrows until nothing is left. Aphorisms sit in
the dark beneath it. Everything is monochrome, grained, and moves almost not at all.

    python3 score.py && python3 render.py
"""
import subprocess, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
FONTS = os.path.join(HERE, 'fonts')

W, H, FPS, DUR = 1920, 1080, 24, 60.0
NF = int(DUR * FPS)
PREVIEW = '--preview' in sys.argv          # half-res, fewer frames, for checking
if PREVIEW:
    W, H = 960, 540
S = W / 1920                               # layout scale

# ---------------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------------
CUT, BACK, END = 34.2, 35.6, 57.0          # must match score.py

# shot: file, start, end, fade-in, fade-out, zoom from→to, pan (dx, dy as fraction), exposure, contrast, focus y
SHOTS = [
    dict(f='s01_fogforest', t0=3.0,  t1=8.7,  fi=2.4, fo=0.7, z=(1.10, 1.03), pan=(0.00, 0.01), ex=0.95, c=1.15, fy=0.50),
    dict(f='s02_jetty',     t0=8.6,  t1=14.1, fi=0.9, fo=0.9, z=(1.02, 1.08), pan=(0.01, 0.00), ex=0.85, c=1.20, fy=0.55),
    dict(f='s03_shelter',   t0=14.3, t1=19.7, fi=0.8, fo=0.5, z=(1.30, 1.20), pan=(0.00, 0.00), ex=0.90, c=1.10, fy=0.66, fx=0.50),
    dict(f='s04_hand',      t0=19.6, t1=24.4, fi=0.6, fo=0.8, z=(1.05, 1.12), pan=(-0.01, 0.0), ex=1.20, c=1.10, fy=0.42),
    dict(f='s05_lamp',      t0=24.5, t1=29.2, fi=0.7, fo=0.4, z=(1.03, 1.09), pan=(0.00, 0.00), ex=0.90, c=1.30, fy=0.45),
    dict(f='s06_eyes',      t0=29.1, t1=CUT,  fi=0.5, fo=0.0, z=(1.55, 1.45), pan=(0.00, 0.0),  ex=1.00, c=1.15, fy=0.29, fx=0.78),
    dict(f='s07_road',      t0=BACK, t1=41.1, fi=2.2, fo=0.3, z=(1.04, 1.10), pan=(0.00, 0.00), ex=0.85, c=1.15, fy=0.50),
    dict(f='s08_whitefog',  t0=40.9, t1=46.3, fi=0.4, fo=0.9, z=(1.00, 1.05), pan=(0.00, 0.00), ex=1.00, c=0.90, fy=0.55),
    dict(f='s09_arch',      t0=46.4, t1=51.7, fi=0.9, fo=0.7, z=(1.08, 1.02), pan=(0.00, 0.00), ex=1.00, c=1.20, fy=0.48),
    dict(f='s10_sea',       t0=51.6, t1=END,  fi=0.9, fo=0.0, z=(1.00, 1.06), pan=(0.00, 0.00), ex=0.85, c=1.20, fy=0.62),
]

# aphorism: lines with their own entrance times, exit time
QUOTES = [
    dict(lines=[('We do not rush toward death,', 4.9), ('we flee the catastrophe of birth.', 7.0)], out=12.7),
    dict(lines=[('Sadness:', 15.3), ('an appetite no misfortune can satisfy.', 16.9)], out=22.8),
    dict(lines=[('Consciousness is much more than the thorn,', 25.3), ('it is the dagger in the flesh.', 28.4)], out=CUT, hard=True),
    dict(lines=[('We are all deep in a hell', 37.0), ('each moment of which is a miracle.', 41.0)], out=45.7),
    dict(lines=[('What I know at sixty, I knew as well at twenty.', 47.3),
                ('Forty years of a long, a superfluous, labor of verification.', 50.2)], out=55.6),
]
SIGN = dict(text='E. M. CIORAN', t0=57.7, t1=59.4)

# ---------------------------------------------------------------------------------
# The closing frame
# ---------------------------------------------------------------------------------
BAND0 = 1920 / 2.76                        # starts at 2.76:1, very wide

def band_h(t):
    """Visible image height (in 1080p px). Slow at first, inexorable at the end."""
    if t >= END:
        return 0.0
    u = max(t, 0) / END
    return BAND0 * (1 - u ** 1.55)

# ---------------------------------------------------------------------------------
# Image preparation
# ---------------------------------------------------------------------------------
def tone(y, ex, c):
    """Monochrome grade: exposure, S-curve around mid-grey, crushed blacks."""
    y = np.clip(y * ex, 0, 1)
    y = 0.5 + (y - 0.5) * c
    y = np.clip(y, 0, 1)
    y = y * y * (3 - 2 * y) * 0.35 + y * 0.65          # gentle S
    y = np.clip((y - 0.03) / 0.97, 0, 1) ** 1.12         # sink the shadows
    return y

def load_shot(s):
    im = Image.open(os.path.join(SRC, s['f'] + '.jpg')).convert('RGB')
    a = np.asarray(im, dtype=np.float32) / 255.0
    a = a ** 2.2                                                  # to linear
    y = a[..., 0] * 0.30 + a[..., 1] * 0.59 + a[..., 2] * 0.11    # panchromatic-ish
    y = y ** (1 / 2.2)
    y = tone(y, s['ex'], s['c'])
    img = Image.fromarray((y * 255).astype(np.uint8), 'L')
    # cover-fit at the shot's largest zoom, so the push-in never upsamples twice
    cs = max(s['z'])
    r = max(W * cs / img.width, H * cs / img.height)
    img = img.resize((int(img.width * r + 0.5), int(img.height * r + 0.5)), Image.LANCZOS)
    img.cs = cs
    return img

def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)

def shot_frame(s, img, t, rng):
    u = (t - s['t0']) / (s['t1'] - s['t0'])
    z = s['z'][0] + (s['z'][1] - s['z'][0]) * ease(u * 0.9 + 0.05)
    k = img.cs / z                        # input px per output px
    vw, vh = W * k, H * k                 # visible window in the source
    # the focus point sits at frame centre, drifting by pan, clamped inside the source
    cx = s.get('fx', 0.5) * img.width + s['pan'][0] * W * u
    cy = s['fy'] * img.height + s['pan'][1] * H * u
    cx = min(max(cx, vw / 2), img.width - vw / 2)
    cy = min(max(cy, vh / 2), img.height - vh / 2)
    # film weave: sub-pixel, slow
    cx += 0.35 * S * np.sin(t * 5.3 + 1.1) + 0.2 * S * rng.standard_normal()
    cy += 0.35 * S * np.sin(t * 4.1) + 0.2 * S * rng.standard_normal()
    x0, y0 = cx - vw / 2, cy - vh / 2
    out = img.transform((W, H), Image.AFFINE, (k, 0, x0, 0, k, y0), resample=Image.BICUBIC)
    return np.asarray(out, dtype=np.float32) / 255.0

def shot_alpha(s, t):
    if t < s['t0'] or t >= s['t1']:
        return 0.0
    a = 1.0
    if s['fi'] > 0:
        a = min(a, ease((t - s['t0']) / s['fi']))
    if s['fo'] > 0:
        a = min(a, ease((s['t1'] - t) / s['fo']))
    return a

# ---------------------------------------------------------------------------------
# Type
# ---------------------------------------------------------------------------------
FONT = ImageFont.truetype(os.path.join(FONTS, 'CG-Light.ttf'), int(46 * S))
FONT_SIGN = ImageFont.truetype(os.path.join(FONTS, 'CG-Regular.ttf'), int(30 * S))
INK = np.array([224, 221, 214], dtype=np.float32) / 255.0
LINE = int(58 * S)

def render_line(text, font, tracking=0):
    if tracking == 0:
        bbox = font.getbbox(text)
        wdt = bbox[2] - bbox[0]
        im = Image.new('L', (wdt + 40, int(font.size * 1.6)), 0)
        ImageDraw.Draw(im).text((20 - bbox[0], int(font.size * 0.2)), text, font=font, fill=255)
        return im
    widths = [font.getlength(ch) for ch in text]
    wdt = int(sum(widths) + tracking * (len(text) - 1))
    im = Image.new('L', (wdt + 40, int(font.size * 1.6)), 0)
    d = ImageDraw.Draw(im); x = 20
    for ch, cw in zip(text, widths):
        d.text((x, int(font.size * 0.2)), ch, font=font, fill=255); x += cw + tracking
    return im

for q in QUOTES:
    q['imgs'] = [render_line(txt, FONT) for txt, _ in q['lines']]
    # hang the text under the slit as it is when the aphorism begins
    b = band_h(q['lines'][0][1]) * S
    q['y'] = int(H / 2 + b / 2 + 62 * S)
SIGN['img'] = render_line(SIGN['text'], FONT_SIGN, tracking=int(9 * S))

def text_alpha(t, t_in, t_out, hard=False, fin=1.6, fout=1.3):
    if t < t_in or t >= t_out:
        return 0.0
    a = ease((t - t_in) / fin)
    if not hard:
        a = min(a, ease((t_out - t) / fout))
    return a

def paste_text(canvas, glyphs, a, cx, cy):
    """Blend a glyph mask into the canvas; it sharpens as it arrives."""
    if a <= 0.001:
        return
    g = glyphs
    blur = (1 - a) * 3.0 * S
    if blur > 0.15:
        g = g.filter(ImageFilter.GaussianBlur(blur))
    m = np.asarray(g, dtype=np.float32) / 255.0 * a * 0.92
    h, w = m.shape
    x0, y0 = int(cx - w / 2), int(cy - h / 2)
    x1, y1 = max(x0, 0), max(y0, 0)
    x2, y2 = min(x0 + w, W), min(y0 + h, H)
    m = m[y1 - y0:y2 - y0, x1 - x0:x2 - x0, None]
    canvas[y1:y2, x1:x2] = canvas[y1:y2, x1:x2] * (1 - m) + INK * m

# ---------------------------------------------------------------------------------
# Film texture
# ---------------------------------------------------------------------------------
def make_grain(n, rng):
    frames = []
    for _ in range(n):
        g = rng.standard_normal((H // 2 + 2, W // 2 + 2)).astype(np.float32)
        gi = Image.fromarray(((g * 40) + 128).clip(0, 255).astype(np.uint8), 'L')
        gi = gi.resize((W + 4, H + 4), Image.BILINEAR).crop((2, 2, W + 2, H + 2))
        fine = rng.standard_normal((H, W)).astype(np.float32) * 0.35
        frames.append((np.asarray(gi, dtype=np.float32) - 128) / 40 + fine)
    return frames

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = 1 - 0.38 * (((xx - W / 2) / (W / 2)) ** 2 * 0.55 + ((yy - H / 2) / (H / 2)) ** 2 * 0.45) ** 1.3
VIGNETTE = VIGNETTE.astype(np.float32)

def halation(y):
    """Soft bloom off the highlights: the lamp, the white field."""
    hi = np.clip((y - 0.72) / 0.28, 0, 1)
    if hi.max() < 0.02:
        return y
    small = Image.fromarray((hi * 255).astype(np.uint8), 'L').resize((W // 8, H // 8), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(6))
    bloom = np.asarray(small.resize((W, H), Image.BILINEAR), dtype=np.float32) / 255.0
    return y + bloom * 0.18 * (1 - y)

# cold, near-neutral toning: shadows lean blue-grey, highlights paper-white
def tint(y):
    r = y ** 1.04
    g = y ** 1.01
    b = y ** 0.96 * 0.985 + 0.012 * (1 - y) * y * 4
    return np.stack([r, g, b], axis=-1)

# ---------------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------------
def main():
    rng = np.random.default_rng(3)
    grain = make_grain(10, rng)
    imgs = {s['f']: load_shot(s) for s in SHOTS}

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = os.path.join(HERE, 'preview.mp4' if PREVIEW else 'the_trouble.mp4')
    cmd = [ff, '-y', '-loglevel', 'error',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', os.path.join(HERE, 'score.wav'),
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'grain', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    step = 1
    for fi in range(0, NF, step):
        t = fi / FPS
        frame = np.zeros((H, W), dtype=np.float32)
        for s in SHOTS:
            a = shot_alpha(s, t)
            if a > 0:
                frame += shot_frame(s, imgs[s['f']], t, rng) * a
        frame = np.clip(frame, 0, 1)
        frame = halation(frame)
        # breathing exposure: film flicker, barely there
        frame *= 1 + 0.012 * rng.standard_normal()
        frame *= VIGNETTE

        # the slit
        bh = band_h(t) * S
        top, bot = int(round(H / 2 - bh / 2)), int(round(H / 2 + bh / 2))
        mask = np.zeros(H, dtype=np.float32)
        if bot > top:
            mask[top:bot] = 1.0
            # a single soft pixel at each edge so the bars never alias
            if top > 0: mask[top - 1] = 0.35
            if bot < H: mask[bot] = 0.35
        frame *= mask[:, None]

        # grain everywhere: the image gets it by luminance, the black gets a trace
        g = grain[rng.integers(len(grain))]
        amt = 0.046 * (1 - np.abs(frame - 0.45) * 1.2).clip(0.15, 1) * mask[:, None] + 0.006
        frame = np.clip(frame + g * amt, 0, 1)

        rgb = tint(frame)
        for q in QUOTES:
            for (txt, t_in), gl, k in zip(q['lines'], q['imgs'], range(len(q['lines']))):
                a = text_alpha(t, t_in, q['out'], q.get('hard', False))
                paste_text(rgb, gl, a, W / 2, q['y'] + k * LINE)
        a = text_alpha(t, SIGN['t0'], SIGN['t1'], fin=1.0, fout=0.9)
        paste_text(rgb, SIGN['img'], a * 0.8, W / 2, H / 2)

        proc.stdin.write((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        if fi % 96 == 0:
            print(f'{t:5.1f}s', flush=True)
    proc.stdin.close()
    proc.wait()
    print('wrote', out)

if __name__ == '__main__':
    main()

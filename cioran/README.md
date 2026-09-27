# The Trouble

A 60-second film on suffering, set to five aphorisms by E. M. Cioran.

**[the_trouble.mp4](the_trouble.mp4)**: 1920×1080, 24 fps, stereo, 60.0 s

## The idea

The film is a letterbox that keeps closing. It opens at a very wide 2.76:1, and the black bars
close in without stopping for the whole minute, so each image is seen through a narrower slit than the last. At
57 seconds the slit shuts, and the sound stops with it. Only the attribution is left, in silence.

The aphorisms are not laid over the pictures. Each one hangs in the dark just under the slit,
wherever the edge happens to be when the line arrives. That way the text drifts up the screen from one
aphorism to the next without ever moving on screen. Each line sharpens out of a slight blur as it fades in.

| time | aphorism | images |
|---|---|---|
| 0:03 | *We do not rush toward death, / we flee the catastrophe of birth.* | fog swallowing a forest · a jetty going nowhere |
| 0:14 | *Sadness: / an appetite no misfortune can satisfy.* | a figure alone in a night bus shelter · a hand, a cigarette |
| 0:24 | *Consciousness is much more than the thorn, / it is the dagger in the flesh.* | a lamp through night fog · a closed eye |
| 0:34 | a hard cut to black and near-silence for 1.4 s | |
| 0:35 | *We are all deep in a hell / each moment of which is a miracle.* | a dark path by a fence, then a cut to the one white image as "miracle" lands |
| 0:46 | *What I know at sixty, I knew as well at twenty. / Forty years of a long, a superfluous, labor of verification.* | an arched window in a dark room · a grey sea, reduced to a line |
| 0:57 | **E. M. CIORAN** | |

All quotations are from *The Trouble with Being Born* and other late works, in Richard Howard's English translation.

## Look

- Monochrome from a panchromatic-style luminance mix, graded with an S-curve and crushed shadows, plus a
  faint cold tone in the shadows.
- Animated two-scale film grain weighted to the midtones, with a trace of grain in the black bars.
- Sub-pixel gate weave, about 1% exposure flicker, a vignette, and a soft halation off the highlights.
- Very slow push-ins and pull-outs, usually under 10% over a shot. Shots dissolve through black, with one
  hard cut at the midpoint.
- Type is Cormorant Garamond Light (SIL Open Font License).

## Score

The score is synthesized entirely in `score.py` (numpy/scipy) and uses no samples:

- A beating D drone, detuned and softly saturated, that grows heavier over the minute.
- A quiet F/A/E cluster moving under a slowly opening filter.
- Filtered noise that sounds like a draught in an empty building.
- A bowed-metal shimmer that rises into the midpoint.
- One muted, felt-piano-like low note under each aphorism, descending from A to F, D, C♯, A and D.
- Everything goes through a synthetic 7-second hall. The mix falls to near-silence at the midpoint cut and
  stops at 0:57, where a final low D rings out into the silence.

## Rebuild

```sh
pip install numpy scipy pillow imageio-ffmpeg
python3 score.py          # -> score.wav
python3 render.py         # -> the_trouble.mp4 (about 6 min on 4 cores)
python3 stills.py 31 43   # optional: inspect single frames
```

`render.py` produces a high-bitrate master. The committed file was then re-encoded at about 10 Mb/s.

## Image candidates

Every image screened for the film, including the ones that were cut, is in [`candidates/`](candidates/).

## Image credits

All stock photographs are CC0 (public domain dedication), from Wikimedia Commons:

| shot | title | author | license | source |
|---|---|---|---|---|
| s01 | Fog devouring a forest (Unsplash) | Frances Gunn francesgunn | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=58791113) |
| s02 | Jetty in fog at Holländaröd 1 | W.carter | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=67913562) |
| s03 | Black-and-white-person-woman-night (24030201790).jpg | www.Pixel.la Free Stock Photos | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=51440461) |
| s04 | Smoking in Iran 02 | Mostafameraji | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=93451749) |
| s05 | Trees around Brastad soccer arena in fog (12) | W.carter | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=83173312) |
| s06 | Woman eyes closed sad | pixabay user 422694 | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=91221425) |
| s07 | Mobil Fotoğraf (200127035).jpeg | Fatih Öztürk | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=71467633) |
| s08 | Deep winter fog (51854946690) | Ted Moravec | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=143892776) |
| s09 | Arch | Alex A | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=73616963) |
| s10 | I M In Love (192261309).jpeg | Kamil Sypień | CC0 | [Commons](https://commons.wikimedia.org/w/index.php?curid=71471300) |

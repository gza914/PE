# Penn Foster High School for Social Purpose Organizations: 30-second spot

**Working title:** "Open the Door"
**Audience:** Leaders at nonprofits, youth-serving organizations (such as YouthBuild programs), workforce boards, and other community and social-purpose organizations
**Goal:** Position Penn Foster High School as the turnkey, accredited diploma partner for the people these organizations serve, and drive visits to partners.pennfoster.edu
**Tone:** Corporate and optimistic VO. Inspiring ambient music bed (96 BPM in D major, swelling to a V→I resolution on the end card).
**Master:** `hs-social-purpose-30s.mp4`, 1920×1080, 30 fps, AAC stereo 48 kHz.

---

## Script (VO: 68 words)

| Time | Picture | Supers | Voiceover |
|---|---|---|---|
| 0:00–0:04 | Smiling young man, slow push-in | *For the people you serve,* / **a diploma changes everything.** | For the people you serve, a diploma changes everything. |
| 0:04–0:08 | Young people working together around a table | **Building a high school program on your own?** / *That's a lot to carry.* | But building a high school program on your own is a lot to carry. |
| 0:08–0:15 | Two women shaking hands across a desk (partnership) | *Penn Foster partners with* chips: **Nonprofits · Youth Organizations · Workforce Boards**, then **to deliver an accredited online high school diploma.** | Penn Foster partners with nonprofits, youth organizations, and workforce boards to deliver an accredited online high school diploma. |
| 0:15–0:20 | Navy panel slides in; learner on a laptop at home | **Built for real lives.** **21**-credit curriculum · Online & self-paced · Wraparound support | Self-paced, with wraparound support that keeps learners moving forward. |
| 0:20–0:25 | Graduates in caps and gowns | **45,000+** high school graduates in 2025 alone (counts up) | In 2025 alone, more than 45,000 students graduated. |
| 0:25–0:30 | Split: smiling graduate / end card | **Penn Foster High School** · *Let's open the door to what's next, together.* · **Partner with us → partners.pennfoster.edu** | Penn Foster. Let's open the door to what's next, together. |

## Audio

| File | What it is |
|---|---|
| `audio/mix.wav` | Final mix: VO over music, with the music ducked about 5 dB under speech. Peak -1 dBFS. |
| `audio/music.wav` | Music bed on its own, for re-cutting |
| `audio/vo_0.wav` … `vo_5.wav` | Individual VO lines (scratch TTS) |
| `audio/timings.json` | VO line start/end times (the on-screen animation is keyed to these) |
| `audio/make_vo.py` | Regenerates the scratch VO with Piper TTS |
| `audio/build_audio.py` | Composes the music bed (pad, piano arpeggio, sub bass, soft pulse, riser) and mixes it with the VO |

I checked the mix with speech-to-text, and it transcribes word for word. "Workforce" is spelled "work-force" in the TTS input on purpose, because the voice mumbled the unhyphenated word.

**The VO is scratch audio, not for air.** It's synthesized with Piper's `en_US-lessac-high` voice, which was trained on a dataset licensed for non-commercial use only. Record final VO with licensed talent, using the same script and timings. The music bed is original and generated in code, so it has no third-party licensing.

## Claims and sources (verify before airing)

Taken from Penn Foster's public partner pages (partners.pennfoster.edu):

- Serves nonprofits, youth organizations, workforce boards, and other job training organizations
- 21-credit, fully online, self-paced curriculum (English, math, science, social studies, plus academic and career electives)
- Regionally and nationally accredited, with wraparound academic and motivational support
- "More than 45,000 high school graduates in 2025 alone"
- Long-standing partnerships with organizations such as YouthBuild (since 2014), Eckerd Connects and Chicago CRED. These could be used in a testimonial cutdown with the partners' permission.

## Stock photography (CC0, free for commercial use)

| File | Title | Photographer | Source | License |
|---|---|---|---|---|
| img/s1-hopeful-learner.jpg | Smiling Man | Matt Moloney | [StockSnap](https://stocksnap.io/photo/smiling-man-3LMPSCJQGQ) | CC0 1.0 |
| img/s2-youth-group.jpg | People Girls | Brodie Vissers | [StockSnap](https://stocksnap.io/photo/people-girls-Y2AHVPYB51) | CC0 1.0 |
| img/s3-partnership.jpg | Shaking Hands | Kristin Hardwick | [StockSnap](https://stocksnap.io/photo/shaking-hands-GEKK2UOHCY) | CC0 1.0 |
| img/s4-self-paced.jpg | Working Typing | Bench Accounting | [StockSnap](https://stocksnap.io/photo/working-typing-0E0M5W9O3V) | CC0 1.0 |
| img/s5-graduates.jpg | People Men | Caleb Woods | [StockSnap](https://stocksnap.io/photo/people-men-3PQLBTZQPC) | CC0 1.0 |
| img/s6-graduate.jpg | Education Graduation | Candace McDaniel | [StockSnap](https://stocksnap.io/photo/education-graduation-XAL3MIM3OC) | CC0 1.0 |

Notes:
- These are 960px source files, enlarged to 1080p, so they're slightly soft. For the final cut, download the full-resolution originals from the StockSnap links, or swap in licensed or owned Penn Foster photography.
- CC0 covers copyright but not model releases. Brand and legal should confirm they're comfortable using recognizable faces in an ad, or use Penn Foster's own photography of real learners.

## Production notes

- Colors, type and the text wordmark are placeholders (CSS variables in `index.html`). Swap in the official brand kit and logo.
- To preview in a browser, open `index.html` and click "Play with sound". Add `?captions` to the address to show the VO as captions.
- To rebuild the video:
  ```
  cd audio && python3 build_audio.py && cd ..
  node render.js frames 30
  ffmpeg -framerate 30 -i frames/f%04d.png -i audio/mix.wav -c:v libx264 -pix_fmt yuv420p -crf 19 -c:a aac -b:a 192k -shortest hs-social-purpose-30s.mp4
  ```

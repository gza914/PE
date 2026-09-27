# Penn Foster Partnerships — 30-second spot

**Working title:** "Build Your Pathway"
**Audience:** HR/L&D leaders, school and district administrators, college and career-school leaders, workforce boards, and nonprofits
**Goal:** Get organizations to see Penn Foster as a turnkey training partner and send them to partners.pennfoster.edu
**Tone:** Confident, warm, plainspoken. Upbeat modern instrumental with a light pulse that resolves on the end card.
**Formats:** 16:9 master (`partnership-30s.mp4`, 1920×1080, 30 fps). Supers carry the message with the sound off, so the spot works on social and CTV. VO captions can be toggled on in `index.html` (`?captions`).

---

## Script (VO: about 72 words, 30s)

| Time | Visual / super | Voiceover |
|---|---|---|
| 0:00–0:04 | **"Your people have potential."** then *"Your goals can't wait."* Navy field. B-roll option: employee on a shop floor, student at a laptop. | Your people have potential. Your goals can't wait. |
| 0:04–0:09 | **"Close the skills gap"**: an orange bar fills the gap between two grey bars. *"without building a training program from scratch."* | So close the skills gap, without building a training program from scratch. |
| 0:09–0:16 | **"Penn Foster partners with"**, then chips appear one at a time: *Employers · Schools & Colleges · Workforce Orgs.* Tag line: *"to deliver accredited online career training & high school programs."* | Penn Foster partners with employers, schools, and workforce organizations to deliver accredited online training. |
| 0:16–0:22 | **"We bring it. You grow."** Three cards rise: **Platform** (flexible, self-paced online learning) · **Content** (Learn · Practice · Apply, built for real jobs) · **Coaching** (instructors and support that keep learners moving). | We bring the platform, the content, and the coaching. Your learners build real, job-ready skills. |
| 0:22–0:26 | **"Join a proven network"**, with numbers counting up: **1,000+ partnerships · 130K+ learners trained each year** | Join more than a thousand partners training over 130,000 learners every year. |
| 0:26–0:30 | End card on a light background: **Penn Foster** wordmark. *"Let's build your pathway together."* Button: **Become a partner → partners.pennfoster.edu** | Penn Foster. Let's build your pathway together. |

## Alternate cutdowns

- **15s:** Scenes 2, 4 and 6. VO: "Close the skills gap without building training from scratch. Penn Foster brings the platform, the content, and the coaching. Let's build your pathway together."
- **6s bumper:** Scene 6 with the super "1,000+ organizations partner with Penn Foster."

## Claims and sources (check before airing)

These come from Penn Foster's public partner pages (partners.pennfoster.edu). Legal/brand should confirm the current figures.

- "1,000+ partnerships" and "133,000+ learners each year" (the spot rounds this to 130K+)
- Serves employers, high schools and districts, colleges and career schools, workforce boards, and nonprofits
- "Platform, content, and service capabilities"; Learn-Practice-Apply instruction model
- Wraparound learner support with instructors and coaches
- Accredited programs (Penn Foster High School: DEAC, Cognia, Middle States)

## Production notes

- Colors and type in `index.html` are **placeholders** (CSS variables on `:root`). Swap in the official Penn Foster brand palette, font and logo lockup before release. The end card currently uses a text wordmark, not the real logo.
- To re-render the MP4 after edits: `node render.js frames 30`, then
  `ffmpeg -framerate 30 -i frames/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 partnership-30s.mp4`
- The master has no audio. Add the VO and music bed in editing; the timings above match the on-screen supers.

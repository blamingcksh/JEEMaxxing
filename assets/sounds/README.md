# Focus Soundscape — audio assets

All files are bundled locally so the app works offline (the service worker
caches them on first use).

## Real recordings (CC0 1.0 Universal — public domain, no attribution required)

Sourced from the Internet Archive, `Red_Library_Nature_Rain` and
`SSE_Library_AMBIENCE` collections.

| File        | Source | License |
|-------------|--------|---------|
| `rain.mp3`      | https://archive.org/details/Red_Library_Nature_Rain — `R22-25-General Rain.mp3` | CC0 |
| `rain-roof.mp3` | https://archive.org/details/Red_Library_Nature_Rain — `R22-17-Smooth Rain on Roof.mp3` | CC0 |
| `cafe.mp3`      | https://archive.org/details/SSE_Library_AMBIENCE — `RESTAURANT & BAR/AMBRest_Cafe ambience; good walla_CS_USC.mp3` | CC0 |

These are looped in the browser with a constant-loudness crossfade looper
(see `focus-sound.js`), which hides the clip seams without any volume throb.

## Generated loops (fully synthetic, no external source)

Created by `scripts/gen-ambient-sounds.mjs` (`node scripts/gen-ambient-sounds.mjs`):

| File        | Recipe |
|-------------|--------|
| `white.wav` / `pink.wav` / `brown.wav` | true white / pink (Paul Kellet) / brown noise, 10s seamless loops |
| `drone.wav`   | detuned 55/82.5/110/165/220 Hz partials with slow breathing |
| `ocean.wav`   | brown bed + surf hiss under a 2-cycle-per-loop swell envelope |
| `stream.wav`  | pink bandpass (Q2) with 3-cycle gurgle wobble + bubble blips |
| `fire.wav`    | brown bed with flutter + ~28 soft-attack crackles |
| `wind.wav`    | pink bandpass with howling sweep + 4 gust cycles per loop |

Every loop is seam-baked (tail crossfaded into head) so browser looping is
perfectly clean.

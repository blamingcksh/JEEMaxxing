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

Short recordings (under 45s) are expanded at load time into long grain-loop
canvases by `focus-sound.js` (circular overlap-add, equal-power windows) so
there are no splice jumps and the wrap seam is seamless. Longer recordings
loop through a constant-loudness equal-power crossfade looper.

## Generated loops (fully synthetic, no external source)

Created by `scripts/gen-ambient-sounds.mjs` v3 (`node scripts/gen-ambient-sounds.mjs`),
audited numerically by `scripts/analyze-wavs.mjs`:

| File        | Recipe |
|-------------|--------|
| `white.wav` / `pink.wav` / `brown.wav` | white / pink (Paul Kellet) / brown noise, 36s loops, equal-power seams, DC-blocked |
| `drone.wav`   | exactly-periodic partial stack (55/82.5/110/165/220 Hz + beat pairs), integer-cycle breathing, faint pink air bed |
| `ocean.wav`   | brown surge bed under a 6-layer incommensurate swell contour + stochastic breaking-wave events, 68s |
| `stream.wav`  | two wandering bandpass brook channels + sparkle + soft clustered bubble plops, 56s |
| `fire.wav`    | ember bed + slow roar + dense quiet crackles (soft attack, low Q), AGC-tamed, 60s |
| `wind.wav`    | three gently-drifting air layers (±12% wander, low Q — no siren howl) + gust envelope + leaf rustle, 60s |

Every loop is seam-baked with EQUAL-POWER crossfades (linear fades dip −3 dB
on uncorrelated noise tails — that was v2's wrap "wobble"), normalised to
per-bed loudness targets (−18…−23 dBFS RMS so presets switch at matched
levels), peak-limited via a soft knee (no blow-outs), and DC-blocked.

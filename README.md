# JEEMaxxing

Offline-first JEE preparation app written in vanilla ES6 modules with zero build step. The home screen is an empty black canvas running a WebGL2 Aizawa toroidal flux manifold (`heartbeat.js`) wired to a real-time 30-hour survival clock.

## How the Heartbeat works

- **30.0h wall-clock reservoir**: Drains `-1.0h` per real hour (`-24.0h/day`) whether the tab is open or closed. Clock rollbacks are clamped against a monotonic `highWaterMark`.
- **Freeze rules**: Real-time decay pauses only during an active Pact / study session (`window._pomoRunning` / `body.pomo-active`), expires after `35m` without interaction, and caps continuous stopwatch freezes at `3h`.
- **Daily break-even (`+24.0h`)**:
  - `20.0u` per subject across Physics, Chemistry, and Maths (`0.25h/u` = `+5.0h` each; overflow cap `26.0u` per subject).
  - `240m` of completed Lock-In Pact blocks (`+9.0h` base; overflow cap `280m`). Forfeited blocks pay `0h`.
- **Parity-gated Pact escrow**: Pact credit multiplies by `0.25 + 0.75 * minP`, where `minP` is your weakest subject's progress toward `20.0u`. Withheld hours release automatically once the lagging subject catches up.
- **Difficulty weights (`qElo` tiers)**: `T1/T2 = 0.75u`, `T3/T4 = 1.00u`, `T5 = 1.35u`, `T6/T7 = 1.75u`.
- **Repeat & error rules**:
  - First-time solves pay `100%`; due spaced-repetition repeats pay `50%`; non-due repeats pay `0%`.
  - Logging an error requires both a mistake tag and a `>= 30`-character failure note to pay `70%` immediately. The remaining `30%` stays locked until solved when due in the Vault.
- **4:00 AM day rollover**: Daily quotas reset at `04:00` local time (`DAY_ROLLOVER_HOUR = 4`) so late-night sessions do not split across midnight.
- **Flatline wipe (`0.0h`)**: Exhausting the 30-hour clock wipes `jeemaxxing_db`, `checkpoint-db`, and `localStorage`, and stamps a monotonic `jeemax_wipe_epoch`. Backup export/import and Google Drive sync are disabled so data exists solely inside the live pulse.

## Manifold vitals & spectrum

The `[ VITALS ]` panel reports the four live manifold parameters:

- **Speed** (`0.05..1.00`): Remaining reservoir life (`reservoirHours / 30`).
- **Luminescence** (`0.00..1.00`): Three-subject balance (`0.35 * avgP + 0.65 * minP`, with a morning blend across the first `20.0u`).
- **Persistence** (`0.00..1.00` normalized): Weighted problem output + Pact endurance.
- **Spread** (`0.00..0.50` max): Inward collapse proportional to remaining reservoir ratio (`0.50` at `30h` -> `0.00` at `0h`).

Color stages interpolate continuously across 5 bands:
`24-30h` Xenon White -> `16-24h` Ion Silver -> `8-16h` UV Laser -> `3-8h` Amber Arc -> `0-3h` Arterial Crimson.

## Core modules

- `index.html` — Application shell, void canvas stage, practice modal, error/lock-in dialogs
- `heartbeat.js` / `heartbeat.css` / `heartbeat-audio.js` — KLSR Aizawa Flux WebGL2 renderer (with 2D fallback), 30h clock, vitals UI, industrial dark-ambient Web Audio engine, flatline wipe sequence
- `storage.js` — `AppState`, IndexedDB (`jeemaxxing_db`), multi-tab sync, wipe-epoch guards (local-only; backups & Drive sync disabled)
- `app.js` — Routing, question bank management, practice grader, difficulty calibration
- `matrix.js` / `memory.js` — Spaced-repetition Error Vault and memory stability model
- `pomodoro.js` / `shadow-duel.js` — Lock-In Pact timers, stopwatch caps, focus ledger
- `mock.js` — Timed mock exam runner and auto-grading
- `sw.js` — Service worker (`jeemax-v119`, network-first HTML + offline KaTeX cache)

## Running locally

```bash
node scripts/dev-server.mjs
```

Opens at `http://localhost:8123`.

## Tests

```bash
npm run smoke
npm run smoke:memory
npm run smoke:weights
node scripts/verify-heartbeat.mjs
```

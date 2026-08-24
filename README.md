# ⚡ JEEMaxxing — Locked In

A **client-side JEE grind command center**: focus timers, a question vault with spaced-repetition scheduling, an Elo-style skill rating engine, a live growing forest, cloud backup, and accountability systems that actively police your procrastination.

Everything runs in the browser. No build step, no server. All data lives in **IndexedDB + localStorage** (optionally mirrored to **Google Drive**), and the app works fully offline as an installable PWA.

---

## 🗂️ Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Module Map](#module-map)
3. [Data & Persistence Layer](#data--persistence-layer)
4. [Feature Breakdown](#feature-breakdown)
   - [Study & Focus](#study--focus)
   - [Question Bank & Ingestion](#question-bank--ingestion)
   - [Practice & the Elo Engine](#practice--the-elo-engine)
   - [Spaced Repetition & Error Matrix](#spaced-repetition--error-matrix)
   - [Accountability (Slump Sentry / Checkpoints)](#accountability-slump-sentry--checkpoints)
   - [Recovery Systems (CNS Load, Lifeline, Deload)](#recovery-systems-cns-load-lifeline-deload)
   - [Gamification & Growth (Forest, Streaks)](#gamification--growth-forest-streaks)
   - [Cloud Sync & Google Drive](#cloud-sync--google-drive)
   - [Theme & UI Layer](#theme--ui-layer)
5. [Internal Data Model](#internal-data-model)
6. [Events & Global Hooks](#events--global-hooks)
7. [Running Locally](#running-locally)
8. [PWA & Offline](#pwa--offline)
9. [Performance Notes](#performance-notes)

---

## 🧭 Architecture Overview

JEEMaxxing is a **vanilla ES6 module** application. There is no framework, no bundler, and no npm build step — the browser's native `import`/`export` resolves everything, so you must serve the folder over HTTP (see [Running Locally](#running-locally)).

**Layering:**

```
┌─────────────────────────────────────────────────────────────┐
│  UI / Views        index.html · dashboard-clean.js · theme.js│
├─────────────────────────────────────────────────────────────┤
│  Feature Engines   app.js (orchestrator, ~11.5k lines)      │
│                    matrix.js (SR + error vault)              │
│                    pomodoro.js (focus timers)                │
│                    checkpoint.js (accountability, passive)   │
│                    grove-islands.js + forest-bg.js           │
│                    + gallery-break.js                        │
│                    cns-load.js · deload.js · lifeline.js     │
│                    nightguard.js                             │
├─────────────────────────────────────────────────────────────┤
│  Charting          candlestick-engine.js (SVG graphs)        │
├─────────────────────────────────────────────────────────────┤
│  Persistence       storage.js (IndexedDB + Drive sync)       │
│  PWA               sw.js · manifest.webmanifest              │
│  Math rendering    vendor/katex/ (local KaTeX)               │
└─────────────────────────────────────────────────────────────┘
```

**Key architectural rules:**

- **Single source of truth** — `AppState` lives in `storage.js` and is mutated by every module; `saveAllAsync()` persists it.
- **No circular module imports** — cross-module communication happens through `window.*` bridges (e.g. `window.calculateEloMigration`, `window._studySecsForCns`).
- **Append-only UI modules** — files like `dashboard-clean.js`, `gallery-break.js`, `forest-island-juice.js` self-wire via IIFEs with guard flags (`window.__dashCleanInit`) and never modify the core files.

---

## 🎨 Design System v4

The UI runs on a single token foundation declared at the top of `styles.css` (`:root` → *DESIGN TOKENS v4*), consumed by a coherent layer at the **end** of the stylesheet (*DESIGN SYSTEM v4 — PROFESSIONAL LAYER*). All seven accent themes × both appearance modes re-skin live because every component color derives from `var(--accent)` / `color-mix()` — no hardcoded hex in the chrome.

| Token family | Values |
|---|---|
| Type scale | `--fs-2xs` 9.5 → `--fs-2xl` clamp(22–27px), display/body/numeric font roles |
| Space scale | `--sp-1` 4px → `--sp-8` 40px (4px base) |
| Radius scale | `--r-sm` 8 · `--r-md` 10 (controls) · `--r-lg` 14 (rows) · `--r-xl` 20 (cards/modals) · `--r-full` pills |
| Elevation | `--e-1…3` tinted shadows + `--ring-focus` focus ring |
| Motion | `--t-fast/med/slow` + `--ease`/`--ease-spring`, reduced-motion guard |
| Controls | `--ctl-h` 38 · `--ctl-h-sm` 31 · `--ctl-h-lg` 44 |

**Shell (command bar v5).** The sidebar renders as a horizontal glass command bar: brand mark → compact icon utilities (theme, living-world) → centered nav (inline SVG icons, accent-tinted active pill + underline marker) → profile chip → collapse. Auto margins (not `justify-content: center`) keep the nav safely centered without the legacy centered-flex overflow bug.

**Header.** Page identity (dynamic `#view-title` + date) on the left; quiet stat chips (Streak · Focus time, label-over-value with tinted icon squircles) and the calendar/sync action cluster on the right.

**Redesign QA.** `scripts/redesign-probe.mjs` (shell contracts), `redesign-layout-qa.mjs` (4 viewports × 6 views: panning, collisions, HUD overlap), `redesign-theme-qa.mjs` (7 themes × 2 modes accent sweep), `redesign-interaction-qa.mjs` (widget sprint, modals, vault, practice flow).

---

## 🧩 Module Map

| File | Lines | Role |
|---|---|---|
| `index.html` | ~1,357 | Entire viewport: sidebar, dashboard, practice modal, upload modal, preview modal, forest canvas, error matrix, settings, script bootstrap. |
| `app.js` | ~9,508 | **Orchestrator.** Boot sequence, all UI wiring, question bank browsing, practice flow, crop/ingestion, Elo engine, forest planting, streak logic, scratchpad. |
| `storage.js` | ~2,039 | **Persistence core.** `AppState`, IndexedDB wrapper (`idbSet`/`idbGet`), Google Drive auth + sync, Gemini API calls, LaTeX repair, daily history ledger, target configs. |
| `matrix.js` | ~2,070 | **Spaced repetition + error vault.** Error matrix UI, chapter decay grid, SR practice drawer, daily fix queue, chapter progress, Elo migration entry points. |
| `pomodoro.js` | — | Deep-focus countdown timers, stopwatch mode, visualizer, mini widget, study-subject switching, bell audio. |
| `checkpoint.js` | ~1,408 | **Slump Sentry / 4-pillar accountability system.** Scheduled checkpoints, idle detection, Proof-of-Work lockdown, Protocol Zero penalties. |
| `candlestick-engine.js` | ~611 | SVG candlestick chart renderer powering the home-section graphs. |
| `cns-load.js` | — | CNS load meter (fatigue telemetry) that gates flow/hardcore practice modes. |
| `deload.js` | — | Deload-day engine: automatic + manual deload scheduling, streak preservation. |
| `lifeline.js` | — | Flow-state lifeline: when CNS load is high, shifts practice difficulty windows easier. |
| `nightguard.js` | — | Post-23:00 ELO-yield guard (×0.80/×0.55/×0.20 tiers), clock-rollback detection, sleep-debt ledger, hold-to-override. |
| `grove-islands.js` | ~2,570 | The **island biome** forest: island canvas, trees, clouds, growth physics. |
| `forest-island-full.js` | — | *(removed — folded into `grove-islands.js`)* |
| `forest-island-juice.js` | — | *(removed — folded into `grove-islands.js` / `forest-bg.js`)* |
| `forest-bg.js` | ~333 | Animated background layers for the forest (sky, stars, parallax). |
| `forest-juice.js` | — | *(removed — folded into `grove-islands.js` / `forest-bg.js`)* |
| `gallery-break.js` | — | **The Burn Reveal** — during a pomodoro break the app dissolves away to reveal a public-domain painting (Wikimedia, cached in IDB); reveal radius tracks break progress, quote + Continue button at 100%. |
| `dashboard-clean.js` | ~200 | Declutter pass: hides banners, floating layout FAB, momentum legend, sidebar collapse persistence. *(No Time Bank card — that README claim was stale.)* |
| `theme.js` | — | 7 accent themes × 2 appearance modes, live re-skinning. |
| `fx.js` | — | Centralized sound / visual / haptic FX controller (`window.FX`): correct/wrong/super sounds, red flash, streak-shield glow, emoji bursts, haptics; prefs in `jeemax_fx_prefs`, honors `prefers-reduced-motion`. |
| `checkpoint.js` | — | See above (accountability). |
| `lifeline.js` | — | See above. |
| `sw.js` | — | Service worker: network-first HTML, stale-while-revalidate assets, offline cache (`jeemax-v44`). |
| `manifest.webmanifest` | — | PWA manifest (standalone, icons, dark background). |
| `storage.js` | — | See above. |

---

## 💾 Data & Persistence Layer

### `AppState` (single source of truth)

Defined in `storage.js` and imported everywhere. It holds **all** user data:

- `solved` / `studySecs` — per-subject daily solve counts and study seconds.
- `questionBank` — every ingested question with Elo, scheduling, history logs.
- `elo` — per-subject + global Elo ratings (`physics`, `chemistry`, `maths`, `global`).
- `activeTargets` / `baseTargets` / `baseErrorTargets` — daily solve and error-resolution targets.
- `extractedItems`, `currentQ`, `practiceQuestions`, `practiceSubmittedFlags` — active practice session state.
- `currentSubject` / `currentChapter` / `currentFilter` — browsing context.
- `driveAccessToken`, `driveRefreshToken` — Google Drive credentials.
- `isAnomaly` flags, `practiceCorrectStreak`, `photoHidden`, `selectedMcq`, etc.

### Two-layer storage

1. **IndexedDB (primary)** — database `jeemaxxing_db`. All state and media blobs. Accessed via `idbSet(key, value)` / `idbGet(key)`.
2. **localStorage (cache)** — quick config snapshots (`jeemax_theme`, `jeemax_ck_shields`, target lock dates, daily forest store).

Writes go through `saveAllAsync()` → `flushSaves()` which coalesces and persists the whole `AppState` atomically, then (optionally) uploads to Drive.

### Daily history ledger

`getDailyHistory()` / `updateDailyHistory()` maintain a per-day solve-count ledger (`date → count`). It feeds:

- Streak computation (see [Streaks](#streaks))
- The Momentum candlestick graph (the old 15-day sparkline was removed)
- Forest daily stores (`jeemax_forest_daily_v1`, mirrored to IndexedDB)
- Deload 48h missed-day checks

### Google Drive sync (optional)

- OAuth2 implicit flow via Google Identity Services (`CLIENT_ID`, `SCOPES`).
- On login, `initDrive()` → `initializeCloudFolder()` creates a private folder, then `syncStateToCloud()` uploads `system_state.json` plus media files.
- `fetchMediaFromDrive(driveImageId)` lazily pulls question images; `cacheAllDriveImages()` pre-caches them offline.
- `setupSyncHeartbeat()` runs periodic background sync; `executeUnifiedSync()` handles conflict-free merge with tombstones (`recordCloudTombstone`).
- The service worker **never** intercepts Google API calls.

---

## ✨ Feature Breakdown

---

### 📚 Study & Focus

#### Pomodoro / Deep-Focus Timer (`pomodoro.js`)

- **Countdown timer** with start / pause / resume / quit; auto-tracks seconds into `studySecs` per subject.
- **Stopwatch mode** (`toggleStopwatchMode`) for open-ended focus blocks.
- **Break cycles**: after a focus block, break timer with `skipBreak` / `addBreakTime` / `finishAll`.
- **Dynamic subject switching** (`toggleDynamicSubject`, `changeStudySubject`) — time accrues to the selected subject HUD.
- **Audio**: `initAudioContext()` unlocks audio on first gesture; `playBell()` rings at session end; `confirmTimerNotification()` sends a notification.
- **Visualizer + mini widget** (`toggleVisualizer`, `toggleMiniWidget`) — an always-on-top floating widget with a beacon on the sidebar nav.
- **Ambient Sprint Widget** — the focus engine's permanent surface, docked bottom-right on *every* tab: idle pill with one-tap ▶ (starts a sprint at the suggested length) and a config popover (subject P/C/M, minutes ±5, rounds ±1, dynamic ⚡); running state shows a progress ring, countdown, live ×1.5 badge, "ends HH:MM", and inline pause/skip/end controls. Clicking a running pill jumps to Focus Mode.
- **Focus tab v3 (minimal)** — single-column rebuild: slim "LOCK-IN" header, huge centered countdown over a hairline progress bar (the beaker is now opt-in via the ⚙ visualiser modal), one quiet setup strip that dims to 34% while a block runs (stays fully live in dynamic mode via `body.pomo-dynamic`), and the ledger + all-time totals as single-line pills instead of card grids.
- **Soundscape session bridge** — "Auto-play on lock-in" toggle (persisted, default on): `transitionToStudy`/`transitionToStopwatch` call `FocusSound.autoStart()`. `FocusSound.duck()` dips the bed to 25% when the session bell rings, then swells back softly. Beds breathe: 1.4s linear fade-in on start, ~0.5s release on pause; preset changes crossfade graph-vs-graph (~0.9s) with no mute gap; engine failures surface in the status line instead of failing silently.
- **Real ×1.5 Deep Work bonus** — while a study/stopwatch block runs, `body.pomo-active` + `window._pomoRunning` are set, which `_getDeepWorkBlockMultiplier()` reads to pay 1.5× ELO on every solve. Pausing, breaks, quitting and resets close the window (the badge never lies).
- **Focus ledger** (`jeemax_focus_ledger`, per-day) — blocks done, forfeits, current chain, best chain, deep seconds. Completing a block grows the chain; abandoning one resets it to zero and logs a forfeit (abandoned seconds still count toward deep time). Surfaced in the widget tally and the Focus view's "Today's Burn" strip with chain pips.
- **Quit friction** — ending a live study block opens a "Break the chain?" confirm that names the price (kept seconds vs. chain reset) with a "Keep Going" escape hatch; stopwatch stops ≥5 min count as completed blocks.
- **Session receipts** — every completed block's modal carries a receipt: block length + subject, chain state, deep time today, and ELO earned during the block (snapshotted at block start).
- **Commitment projection** — the Focus form states the contract live ("50m × 2 rounds ≈ 1h 50m committed · every solve banks ×1.5 ELO while you're locked in").

#### Dashboard (`app.js` + `dashboard-clean.js`)

- Per-subject **daily solve targets** (settable via `#set-tgt-[subject]`) and **error-resolution targets** (`#set-err-[subject]`), with a 24-hour lock (`jeeTargetLockDate`) so you can't nudge targets mid-day.
- ~~**Time Bank card**~~ *(removed from the product; `dashboard-clean.js` no longer injects it)* — live per-subject study time lives in **Focus Mode**'s hour-stats instead.
- **Loop-rail navigation** — sidebar arcs show progress toward today's physics/chemistry/maths targets plus a "fix" ring for error resolution. When all four rings close, the loop is "CLOSED"; after 18:00 with zero solves the sidebar flashes a "STREAK AT RISK" warning.
- **Candlestick graphs** (`candlestick-engine.js`) — the home-section trend graphs (solves/time) rendered as SVG candlesticks with momentum colors.
- **Momentum legend** injected into the Momentum Tracker by `dashboard-clean.js`.
- **Floating layout FAB** — bento-toolbar panel tucked behind a pencil FAB; sidebar collapse state persists.

#### Scratchpad (in `app.js`)

A floating **drawing overlay** (canvas + toolbar with pencil, color palette, erase, color stashing) usable over any screen — questions, checkpoint lockdowns, etc. Optimized for pen input (desynchronized 2D context, non-passive touchstart bypass for iOS gesture latency). Exposed globally as `window.__scratchpad`.

---

### 📥 Question Bank & Ingestion

#### Ingestion paths

1. **Screenshot crop** — upload a screenshot, crop the question region, run OCR → question text. (`cropImageFromBBox`, `readFileAsBase64`)
2. **Gem text dump** (`processGemTextDump`) — paste a JSON/text dump of questions (e.g. generated by an AI model). A real-JSON fast path (`cleanAndParseJson`) heals bare-backslash LaTeX corruption; a legacy regex path handles freeform text.
3. **JSON file upload** (`loadJsonDumpFile`) — reads a dump file into the text-add terminal, then runs the same ingestion.
4. **Manual creation** — add questions directly.

#### Ingestion pipeline (per question)

- **Type classification**: `mcq` (single or multi-select), `numeric`, or `text`/free-response (auto-detected from options/answer shape).
- **Gem qElo stamping** — if the dump carries `qElo`/`targetTimeMins`/`tags`/`model` metadata, the question is `gem-stamped` (trusted Elo, skips the warmup curve). Otherwise it's `uncalibrated` (chapter-average Elo + legacy warmup).
- **Anti-cheat audit** (`_auditGemBatchByChapter`) — flags batches where ≥80% of questions land in elite tiers (T6–T7) against a low prior chapter average (`suspiciousDistribution`), and low-stdev automation (`suspiciousStdev`).
- **Chapter-ceiling guard** — qElo is clamped to ±600 of the destination chapter's running average.
- **LaTeX repair** — `repairLatex()` deterministically fixes broken delimiters/backslash runs; `mathOk()` validates; failed rows get `latexRepairFailed` flagged (never blocked).
- **Placement** — questions land in the *active session's* subject/chapter; the Gem's own stamps are kept only as provenance (`gemSubject`/`gemChapter`).
- **Gem auto-crop coordinates** — when the dump carries `imageRef` (which tagged source screenshot) + `cropBox` (crop region), ingestion opens the **🗺 Diagram Map**, counts the distinct tags, asks for one upload per tag, and auto-crops every referenced diagram into `diagramImageUrl` via `cropImageFromBBox` — no manual cropping.

##### Gem diagram auto-crop (`imageRef` + `cropBox`)

When a question's diagram lives inside one of the source screenshots, the Gem
emits coordinates so the app crops it automatically:

```json
{
  "extractedText": "A projectile is fired...",
  "options": ["A) ...", "B) ..."],
  "correctAnswer": "B",
  "solution": "...",
  "imageRef": "a1",
  "cropBox": { "x": 0.12, "y": 0.30, "w": 0.40, "h": 0.35 },
  "optionImages": { "A": { "imageRef": "a1", "cropBox": { "x": 0.55, "y": 0.10, "w": 0.30, "h": 0.40 } } },
  "solutionImage": { "imageRef": "a2", "cropBox": { "x": 0.1, "y": 0.5, "w": 0.5, "h": 0.4 } }
}
```

- `imageRef` — tag of the source screenshot the diagram lives in (`a1`, `a2`, `s1`, …). Aliases: `imageTag`, `diagramRef`, `imgTag`, `sourceImage`; loose matches on `image`/`img`/`figure`/`imageNumber` are also accepted when the value is a short tag token (a URL or data URL is never treated as a tag).
- `cropBox` — top-left (`x`,`y`) + size (`w`,`h`) as **fractions** (0–1) of the screenshot. Aliases: `bbox`, `box`, `crop`, `region`, `coords`, `cropCoords`; object or `[x, y, w, h]` array form; pixel-scale coordinates are auto-detected and normalized at crop time.

**Option & solution images** — the same mechanism works for figures inside
individual MCQ options and the worked solution:

- `optionImages` — map of option letter → `{ imageRef, cropBox }` (or an array of `{ option, imageRef, cropBox }` entries). Aliases: `optionImageRefs`, `optionsImages`, `optionsImageRefs`, `optionsImg`. Renders under the matching option in preview **and** the practice modal.
- `solutionImage` — `{ imageRef, cropBox }` (or a bare tag string). Aliases: `solImage`, `solutionImageRef`, `solutionRef`, `answerImage`, with standalone crop fallbacks `solutionCrop` / `solutionCropBox` / `solCropBox` / `answerCrop`. Renders above the worked solution in the solution popup.

On ingest the app counts the distinct tags ("how many are there"), prompts one
upload per tag, and auto-crops every referenced asset (diagram, per-option
image, solution image) in a single pass — the manual ➕ Add Diagram flow
remains as fallback. The copy-paste Gemini instruction block lives inside the
🗺 Diagram Map modal.

#### Preview modal

Before saving, every extracted item is shown in a grid where you can:

- Verify/edit the **answer key** per row (manual answer input).
- **Add / wipe a diagram** asset (`window.triggerSurgicalDiagramUpload`, `window.yeetSurgicalDiagram`).
- **🗺 Diagram Map** — reopen the auto-crop mapper for any question that references a tagged source image (`imageRef`).
- Review type badges, options, solution/hint presence.
- Then **Save All** commits the batch to the bank.

---

### 🎯 Practice & the Elo Engine

#### Practice modes

- **Standard / Grind Station** — the classic practice modal.
- **Flow State (🎯)** and **Hardcore (⚡ HC)** — gated by your current CNS load and Elo; each has tuned P_win (difficulty) windows and reward multipliers (`PRACTICE_MODES`, `MODE_TUNING`).

#### Question rendering (`renderPracticeQuestionModal`)

- MCQ single / MCQ multi-select / numeric input / free-response (self-report) — all graded with exact tolerance (`|user − correct| < 1e-6` for numeric).
- Images: base64 `imageDataUrl` or lazily fetched `driveImageId` from Drive.
- **LaTeX**: every question body/answer/solution is escaped then hydrated by KaTeX (`processElementMath` — synchronous hydration + observer watchdog).
- **Hide photo toggle**, solution popup (`showSolutionPopup`), time-on-question tracked per question (`timeTaken`).

#### The Elo engine (in `app.js`)

A **subject-segregated, uncapped cognitive matchmaking rating** ("MMR") that reverse-engineers each question's *Implied Difficulty Rating* (`qElo`) from your execution telemetry:

- **K-factors** per subject: physics/chemistry `K=12`, maths `K=16`; asymmetric antagonistic scaling compresses gains at high ratings and cushions falls at low ones.
- **Rank tiers**: `NPC 🧍` → `Skill Issue 💀` → `Cooking 🍳` → `Let Him Cook 👨🍳` → `Diffed the Exam 💀` → `Unhinged Gigachad 🗿`.
- `calculateEloMigration()` merges: solve correctness, **time divergence** (your time vs. chapter average, with FAST/SLOW/BALANCED bonus pills), friction severity, chapter health, and mode multipliers into a single delta.
- **Elo shift chips** (`injectEloShiftChip`) pop into the practice header + results banner with tier transition celebrations (emoji burst + super sound).
- **First-attempt accuracy** (`_firstAttemptResult`) — accuracy is locked to your first ever attempt; re-solves never inflate it.

#### Bounty mode

Time-boxed bounty questions: answer within the countdown or the attempt is marked wrong; practice time is converged into daily study counters.

---

### 🧠 Spaced Repetition & Error Matrix

#### Error Vault (`matrix.js`)

- **Error matrix** — every wrong/fumbled question is vaulted with friction reasons (`CALC`, `FORMULA`, `CONCEPT`, `APPROACH`).
- **Filters**: all / errors / solved / by friction type / by due status; `filterErrors()` drives the list.
- **Daily Fix Queue** (`toggleDailyQueue`) — auto-curates a weighted 20-question set: lowest ease-factor items first, sliced to paper-distribution targets.
- **Chapter decay grid v2** (`renderChapterDecayGrid`) — exam-aware risk bars: JEE-weightage × forecast retention at your exam date, coverage underlay, "critical in Nd" chips, trend arrows and a fluency (τ) readout; tap any row for the per-item decay drilldown (`openDecayDrilldown`). Powered by **memory.js** — an FSRS-style three-state kernel (Difficulty / Stability / Retrievability, power-law forgetting curve, unbounded stability growth). `node scripts/smoke-memory-model.mjs` property-tests it.

#### Spaced repetition math

- **SuperMemo-2 variant** with multi-variable tuning: ease factor, friction severity weight, performance quality `q` (0.0–5.0 from autonomy vs. time ratio).
- **Memory Kernel v2** (`memory.js`, canonical for BOTH the grid and `_getChapterHealth`):

  ```
  R(t,S) = (1 + (19/81) · t/S)^−0.5        ← power-law retrievability; R(S)=0.9
  pass:  S' = S · (1 + G·((11−D)/10)·S^−0.15·(e^(0.4·(1−R))−1))
  lapse: S' = max(0.5, F·((S+1)^0.25 − 1)·e^(0.3·(1−R))/D^0.2)
  ```
- **Elo v2**: Glicko-lite rating deviation (uncertainty-weighted K_eff), graded partial-credit scores, 3PL guess correction on 4-option MCQs, continuous retrievability gating (low-R recalls earn ~full credit), pre-reveal confidence capture → Brier-scored Calibration Report, chapter-level ability θ_c (`getChapterTheta`), and an AIR uncertainty cone + Top-100 gap panel in the rating popup.

- `getDueStatus()` decides if an item is `ready`/`due`; the nav's "Vault" badge counts ready items (O(1) cached).
- **SR practice drawer** (`openPracticeDrawer`) — full spaced-repetition session: flip card, select options / self-report, autonomy & friction rating, optional stopwatch + manual time, hint/image toggles, then `submitPracticeLog()` feeds Elo migration.
- **Error resolution dashboard** (`renderErrorResolutionDashboard`) — decay grid + penalty scars (the old 15-day sparkline was removed).
- **Chapter progress** (`renderChapterProgressList`, `openChapterProgress`) — per-chapter mastery breakdown.

---

### 🔒 Accountability (Slump Sentry / Checkpoints)

> **⚠ STATUS: DECOMMISSIONED (passive).** The 1-second monitoring loop and its
> penalty driver were **removed from the source** (`checkpoint.js` — "TODAY'S
> LOOP: REMOVED"): it re-armed on every reload and kept writing Protocol-Zero
> hard-zeros into the Fix Streak, so "closing it" never stuck. `cfg.enabled`
> ships `false`, no tick driver exists, and the control-center UI stays hidden
> and inert. **Stored penalties are kept as plain history for the graphs** —
> they are never re-armed or re-written. Manual debug access survives via
> `window.__checkpoint`. The table below documents how the system *worked*
> before decommissioning.

`checkpoint.js` — a hardened "4-pillar accountability checkpoint system" that actively guards your schedule. **8 known exploits patched** (documented in the file header):

| Exploit | Defense |
|---|---|
| Silent death (tab closed/suspended) | `lastTickAt` gap detection, Wake Lock + Notification API, `visibilitychange` resume guard |
| Palm/scroll activity spam | `reportDrawingActivity(x, y)` with movement threshold (>4px) |
| Time-travel (clock rollback) | `lastKnownNow` high-water mark; rollback → **Protocol Zero** penalty |
| Force-close during penalty | Atomic state persist + `restoreState()` resumes exact phase |
| 1-second ghost miss | `processedToday` set; occurrence never pushed to tomorrow |
| Focus-spam speedrun (rapid ticks) | Timestamp-based PoW timer (`powStartedAt + accumulated pause`), not tick count |
| Multi-correct lockout | `submitAnswer` handles single/multi/integer/self-report |
| localStorage amnesia | Dual-write IndexedDB + localStorage; penalties re-restored from IDB |

**Flow:**

1. At configured checkpoints (default `11:00`, `17:00`, `21:00`), if you've been **idle ≥ 120 min**, the checkpoint **arms**.
2. A **grace modal** (default 15 min) counts down against an *absolute, calendar-anchored deadline* — refreshing or closing the tab can't extend it.
3. **INITIATE CHECKPOINT** → **lockdown overlay** with the lowest-health due question, a **Proof-of-Work timer** (default 10 min, pauses when you stop drawing/typing), and full answer UI (single/multi/integer/self-report).
4. Correct answer → checkpoint cleared. Wrong / abandon / timer expiry / clock rollback / missed grace → **PROTOCOL ZERO**: a permanent red spike scarred into your 15-day error graph + main predictive graph.
5. A floating control center (hub button + panel) surfaces all state and lets you tweak config.

---

### 🧬 Recovery Systems (CNS Load, Lifeline, Deload)

#### CNS Load (`cns-load.js`)

A **central-nervous-system fatigue meter** (0–1) built from study volume, elapsed sessions, and telemetry. High load gates demanding modes and feeds the lifeline. Exposed as `window.__cnsLoad`. Reset bridges: `window._studySecsForCns` (pomodoro quit) and `window._deloadDailyHistoryFn`.

#### Flow-State Lifeline (`lifeline.js`)

When `CNS_LOAD ≥ 0.80`, the lifeline shifts practice difficulty windows toward **easier problems** (per-mode P_win offsets) to pull you back into the flow channel. The catch: **ELO yield × 0.65** on lifeline-assisted solves. Auto-disables below 0.40; opt-out per solve; requires ≥3 unsolved questions in the easier band of the chapter.

#### Deload Engine (`deload.js`)

- **Automatic deload** — after sustained high volume (or 48h without missed days), a deload day is scheduled.
- **Manual scheduling** (`scheduleDeloadFromUi`) — "🌿 Deload Day scheduled. Your streak is preserved."
- On a deload day, the daily target loop treats it as an **Earned Rest day** — the streak counter is preserved and targets don't count against you.

#### Night Guard (`nightguard.js`)

Post-23:00 **"Diminishing Returns" guard** — a stepped ELO-yield degradation driven by the local clock: Tier 1 (23:00–01:00) ×0.80 🌙, Tier 2 (01:00–03:00) ×0.55 🌑, Tier 3 (03:00+) ×0.20 🛌 uninterruptible modal with force-CNS. Also detects clock rollback, tracks late-night overrides (3s hold-to-override) and keeps a sleep-debt ledger (consecutive short gaps → mood penalty). Pure read over AppState; persists its own tier/override state in localStorage.

---

### 🌳 Gamification & Growth (Forest, Streaks)

#### The Forest (multiple engines)

The forest grows as you solve questions. Layers:

- `forest-bg.js` — animated sky/stars/parallax backdrop (three.js, vendored build first with CDN fallbacks).
- `grove-islands.js` — the bigger island archipelago with its own growth physics (~2.5k lines: growth curves, cloud movement, maturity stages, mini widget + full explorer).
- Daily forest store (`jeemax_forest_daily_v1` in localStorage + IDB mirror) records daily growth per subject.

> Note: the old `forest-island-full.js` / `forest-island-juice.js` /
> `forest-juice.js` modules no longer exist — their roles were folded into
> `grove-islands.js` and `forest-bg.js`.

**Growth rules:** solves (and subject balance) plant/water trees; targets met grow trees to maturity; missed days can wilt them. The forest is a persistent visual progress bar for your grind.

#### Streaks

Computed from the daily history ledger:

- Solving ≥1 question per day extends the streak.
- **Deload days** preserve the streak.
- After 18:00 with zero solves, the sidebar shows the "🚨 STREAK AT RISK" state.

---

### ☁️ Cloud Sync & Google Drive

See [Data & Persistence](#data--persistence-layer) — the key user-facing features:

- **Link Google Drive** → creates a private cloud folder and mirrors `system_state.json` + media.
- **Auto-sync heartbeat** + manual **Sync Now**; **Cache All Images** for offline Drive media.
- **Cloud restore** — `loadStateFromCloud()` rehydrates state on a new device; tombstones prevent resurrected deletes.
- Token expiry handling (`handleAuthExpiry`) keeps sync graceful.

---

### 🎨 Theme & UI Layer

`theme.js` — **7 accent themes**:

| Theme | Vibe |
|---|---|
| Furnace | Amber heat (stock) |
| Synthwave | Violet neon haze |
| Glacier | Ice-blue deep focus |
| Overgrowth | Bioluminescent green |
| Blood Moon | Crimson aggression |
| Sakura | Rose quartz calm |
| Stealth | Monochrome ops |

× **2 appearance modes**: `Midnight` (deep-night terminal) and `Dusk` (evening glass, ~65% dark). Persisted as `jeemax_theme` / `jeemax_mode`; live re-skins via `data-theme` / `data-mode` attributes.

`fx.js` — **centralized FX controller** (`window.FX`): correct/wrong/super sounds, red-flash on errors, streak-shield glow, emoji bursts, and haptics — with persisted preferences (`jeemax_fx_prefs`) and reduced-motion support.

---

## 🗃️ Internal Data Model

### Question shape

```js
{
  id, subject, chapter, type,               // 'mcq' | 'numeric' | 'text' | 'self-report'
  extractedText, options[], correctAnswer,  // string | string[] | numeric
  solution, hint,
  imageDataUrl, diagramImageUrl, driveImageId,
  optionImageUrls, solutionImageUrl,        // gem auto-crop outputs ({'A': dataUrl, ...} / dataUrl)
  gemImage, gemOptionImages, gemSolutionImage,  // gem crop provenance (imageRef + cropBox coords)
  qElo, targetTimeMins, isAnomaly,          // Elo schema
  qEloSource,                                // 'gem-stamped' | 'uncalibrated'
  qEloStampedBy, qEloStampedAt, tags, difficulty,
  status,                                    // 'solved' | 'wrong' | 'error' | 'unsolved'
  firstAttemptResult, historyLogs[],         // spaced-repetition timeline
  easeFactor, lastReviewedAt, dueDate,       // SM-2 fields
  timeTaken, errorReason,                    // friction tag (CALC/FORMULA/CONCEPT/APPROACH)
  batchSuspiciousDistribution, batchSuspiciousStdev, latexRepairFailed
}
```

### Elo schema

- `AppState.elo = { physics, chemistry, maths, global }` — all default 1200.
- `ELO_BANDS` / `BAND_TARGET_TIME` map Elo bands → target solve times.
- `ELO_GEM_STAMP_TUNING` — reward deltas for gem-stamped questions.

### Streak / targets

- `baseTargets = { physics, chemistry, maths }` — daily solve targets.
- `baseErrorTargets` — daily error-resolution targets.
- `jeeTargetLockDate` — 24h lock key.

---

## 📡 Events & Global Hooks

| Hook | Fired by | Consumed by |
|---|---|---|
| `checkpoint:state` | `checkpoint.js` emit() | control panel / ignite button |
| `checkpoint:penalty` | Protocol Zero | error-resolution + predictive graphs |
| `window.__ckBumpTodayFix(subject)` | `matrix.js` on correct SR log | nav loop "fix" ring cache |
| `window.__jmaxDataDirty` | save pipeline | memoized nav heavy-derivations |
| `window._studySecsForCns` | app boot | CNS reset on pomodoro quit |
| `window._deloadDailyHistoryFn` | app boot | deload 48h missed-day check |
| `window.__cnsLoad` | `cns-load.js` | lifeline + mode gating |
| `window.__scratchpad` | app boot | scratchpad API (`toggle`, `clear`, `getColor`, …) |

---

## 🚀 Running Locally

Because the app uses native ES modules, opening `index.html` via `file://` is blocked by CORS. Serve the folder:

```bash
# Option A: Python
python3 -m http.server 8000
# → http://localhost:8000

# Option B: any static server
npx serve .
```

**No build step. No `npm install` required** (the only dependency entry, `freebuff`, is not needed to run).

---

## 📱 PWA & Offline

- `manifest.webmanifest` — installable, standalone, dark theme, maskable icons.
- `sw.js` (cache version `jeemax-v44`):
  - **Network-first for HTML** — a cached `index.html` can never pin old code; fresh shell served every load, cached copy only when offline.
  - **Stale-while-revalidate** for JS/CSS/fonts; CDN prefix whitelist (`jsdelivr`, `esm.sh`, `unpkg`, Google Identity).
  - **KaTeX vendored locally** (`vendor/katex/`) so math renders offline.
  - Activation **cannot fail** — all navigation reloads are `Promise.allSettled` so a rejected `client.navigate()` never aborts the update.
  - Drive/Gemini API calls are never intercepted.

---

## ⚡ Performance Notes

- **Memoized nav derivations** — the "fix today" count is an O(1)-cached per-day counter (`__ckBumpTodayFix` bumps instead of rescanning); the ready-count and lowest-health scans respect a 30s TTL + 2s min interval via `navHeavy()`.
- **`nav-ck-ladder` innerHTML** only rewritten when the rungs actually change; the global Math observer no longer tree-walks the sidebar every tick.
- **Chapter health is a pure read** (idempotent, JIT hydrates memory fields without mutating objects) so it's safe to call at high frequency.
- **Scratchpad canvases** use `desynchronized: true` GPU fast paths and never call `getImageData()` during drawing.
- **Service worker install** pre-caches only the essential shell; CDN assets are best-effort (`allSettled`) and never fail activation.

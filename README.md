# ⚡ JEEMaxxing — Locked In

A **client-side JEE grind command center**: focus timers, a question vault with spaced-repetition scheduling, an Elo-style skill rating engine, a live growing forest, P2P leaderboards, cloud backup, and accountability systems that actively police your procrastination.

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
   - [Gamification & Growth (Forest, Streaks, Leaderboards)](#gamification--growth-forest-streaks-leaderboards)
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
│  Feature Engines   app.js (orchestrator, ~9.5k lines)       │
│                    matrix.js (SR + error vault)              │
│                    pomodoro.js (focus timers)                │
│                    checkpoint.js (accountability)            │
│                    forest-island-full.js + grove-islands.js  │
│                    + forest-bg.js + forest-juice.js          │
│                    + forest-island-juice.js + gallery-break.js│
│                    cns-load.js · deload.js · lifeline.js     │
│                    nightguard.js · leaderboard.js            │
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
| `nightguard.js` | — | Overnight maintenance: pending-write flush, streak/target rollover, silent data protection. |
| `leaderboard.js` | — | Serverless P2P leaderboard arena over WebRTC (WebTorrent trackers). |
| `grove-islands.js` | ~1,859 | The **island biome** forest: island canvas, trees, clouds, growth physics. |
| `forest-island-full.js` | — | Full island renderer (trees, palms, rocks, water) driven by solve counts. |
| `forest-island-juice.js` | ~814 | Polish layer: animations, particles, ambient effects on the island. |
| `forest-bg.js` | ~333 | Animated background layers for the forest (sky, stars, parallax). |
| `forest-juice.js` | — | Particle/sprite juice for the classic forest. |
| `gallery-break.js` | — | **The Burn Reveal** — during a pomodoro break the app dissolves away to reveal a public-domain painting (Wikimedia, cached in IDB); reveal radius tracks break progress, quote + Continue button at 100%. |
| `dashboard-clean.js` | ~200 | Declutter pass: hides banners, injects a live Time Bank card, floating layout FAB, momentum legend, sidebar collapse persistence. |
| `theme.js` | — | 7 accent themes × 2 appearance modes, live re-skinning. |
| `fx.js` | — | Centralized sound / visual / haptic FX controller (`window.FX`): correct/wrong/super sounds, red flash, streak-shield glow, emoji bursts, haptics; prefs in `jeemax_fx_prefs`, honors `prefers-reduced-motion`. |
| `checkpoint.js` | — | See above (accountability). |
| `lifeline.js` | — | See above. |
| `sw.js` | — | Service worker: network-first HTML, stale-while-revalidate assets, offline cache (v15). |
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
- The 15-day error momentum sparkline
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

#### Dashboard (`app.js` + `dashboard-clean.js`)

- Per-subject **daily solve targets** (settable via `#set-tgt-[subject]`) and **error-resolution targets** (`#set-err-[subject]`), with a 24-hour lock (`jeeTargetLockDate`) so you can't nudge targets mid-day.
- **Time Bank card** — live total + per-subject study time, always synced with the pomodoro hour-stats (injected by `dashboard-clean.js`).
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
- **Chapter decay grid** (`renderChapterDecayGrid`) — live chapter health bars (emerald → crimson) with CSS glow; drives the "lowest health chapter" pulse on the nav.

#### Spaced repetition math

- **SuperMemo-2 variant** with multi-variable tuning: ease factor, friction severity weight, performance quality `q` (0.0–5.0 from autonomy vs. time ratio), and a **Biologically-grounded chapter health model** (Bjork's *New Theory of Disuse*):

  ```
  RS_i(t) = e^( −ln2 · (Δt / S_i) )          ← retrieval strength per item
  A_ch(t) = (Σ Q_Elo,i · RS_i(t)) / (Σ Q_Elo,i) · 100   ← chapter accessibility
  ```

- `getDueStatus()` decides if an item is `ready`/`due`; the nav's "Vault" badge counts ready items (O(1) cached).
- **SR practice drawer** (`openPracticeDrawer`) — full spaced-repetition session: flip card, select options / self-report, autonomy & friction rating, optional stopwatch + manual time, hint/image toggles, then `submitPracticeLog()` feeds Elo migration.
- **Error resolution dashboard** (`renderErrorResolutionDashboard`) — 15-day sparkline of resolved errors vs. targets.
- **Chapter progress** (`renderChapterProgressList`, `openChapterProgress`) — per-chapter mastery breakdown.

---

### 🔒 Accountability (Slump Sentry / Checkpoints)

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

Overnight/overnight-flush maintenance: ensures pending `saveAllAsync` writes land, rolls over daily counters cleanly at midnight, and guards streak/target data during inactivity windows.

---

### 🌳 Gamification & Growth (Forest, Streaks, Leaderboards)

#### The Forest (multiple engines)

The forest grows as you solve questions. Layers:

- `forest-bg.js` — animated sky/stars/parallax backdrop.
- `forest-island-full.js` — the **island biome**: trees, palms, rocks, water rendered from solve counts.
- `grove-islands.js` — the bigger island archipelago with its own growth physics (~1.8k lines: growth curves, cloud movement, maturity stages).
- `forest-island-juice.js` + `forest-juice.js` — particles, sparkles, ambient animations on top.
- Daily forest store (`jeemax_forest_daily_v1` in localStorage + IDB mirror) records daily growth per subject.

**Growth rules:** solves (and subject balance) plant/water trees; targets met grow trees to maturity; missed days can wilt them. The forest is a persistent visual progress bar for your grind.

#### Streaks

Computed from the daily history ledger:

- Solving ≥1 question per day extends the streak.
- **Deload days** preserve the streak.
- After 18:00 with zero solves, the sidebar shows the "🚨 STREAK AT RISK" state.

#### P2P Leaderboard Arena (`leaderboard.js`)

A **serverless WebRTC leaderboard**:

- No backend, no OAuth — handshake via public **WebTorrent WebSocket trackers**, then a direct `RTCDataChannel` exchange.
- Broadcasts a 4-field telemetry packet (solves, Elo, study time, name) via `LeaderboardNet.broadcastTelemetry()` — fired on practice solves and study-time mutations.
- Fully decoupled from local persistence: never reads `questionBank`, API keys, or backup configs.

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
| `LeaderboardNet.broadcastTelemetry()` | solve/study-time mutations | P2P arena |
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
- `sw.js` (cache version `jeemax-v23`):
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

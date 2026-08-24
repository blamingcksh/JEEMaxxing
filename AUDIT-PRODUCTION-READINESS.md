# JEEmaxxing — Production-Readiness Audit & Fix Ledger

**Session:** 2025 · full-app audit requested ("rip the whole app… specifically optimized for iPad").
**Method:** five parallel deep-audit passes (iPad/touch · runtime performance · UX friction/cognitive load · consistency/code-health *(pending)* · PWA/offline/data-integrity) **plus** empirical measurement of the real app in a headless iPad-profile browser. Every finding below was verified against source (file:line) or measured live; items already listed in `bugs-report.txt` were excluded.
**Status legend:** ✅ FIXED this session (verified) · 🔧 PARTIAL · ⬜ OPEN (roadmap)

---

## 1. Empirical measurements (headless Edge/Chrome, iPad profiles)

| Metric | Value | Verdict |
|---|---|---|
| Boot → DOMContentLoaded (script eval) | **5.5–8.0 s**, worst single long task **2.8 s**, ~9 s total long-task time | ❌ main cause found & fixed (grove deferral); more work open |
| Startup CPU profile | ~3.3 s inside three.js island construction (`A`+`St`+`setSize`); rest = parse/compile wave | ✅ heavy init deferred to idle time |
| Scroll frame test @820×1180, dashboard | backdrop-filter ON: **97/427 dropped frames (22.7%)** · OFF: **11/701 (1.6%)**, +64% delivered frames | ❌ quantified; CSS diet open |
| Backdrop-filter layers simultaneously active on Home | **72 elements** | ❌ open (CSS diet) |
| Sub-40px touch targets visible on Home (fresh boot) | **19** incl. primary nav (40×38), theme/world buttons 36×36, counters 30×30 | ⬜ open |
| Horizontal overflow | html clipped at all widths ✓; nav-menu scrollable-but-unsignposted at ≤375px | ⬜ minor polish |
| Console errors / failed local requests on fresh first run | **0 / 0** | ✅ clean boot |
| DOM nodes after boot | 1,238 | ✅ light |
| Live intervals / rAF loops after boot | 9 intervals, 1 rAF pending | ✅ disciplined |
| Smoke baseline (`npm run smoke`) | 23+21+84+41+report checks — green before and after every fix batch | ✅ |

---

## 2. Fixed this session

| # | Fix | Files | Verified by |
|---|---|---|---|
| F1 | **Wipe-propagation guard** — transient IndexedDB read failure at boot used to leave an empty in-memory state that any later save/auto-push would commit over the real local rows *and* the Drive mirror (the manual sync had a zero-guard; the automatic path had none). Now: `_degradedBootRead` latch blocks destructive commits; auto-push refuses empty-local pushes unless cloud verifiably empty; `getCloudSolvedTotal` returns `null` on unknown (was indistinguishable from "empty"); manual-sync guard tightened to also require an actually-empty bank before skipping. | `storage.js` | syntax ✓, smoke ✓ |
| F2 | **`navigator.storage.persist()`** now requested at boot (months of data were best-effort evictable). | `storage.js` | smoke ✓ |
| F3 | **SW precache completeness** — added `metronome.js`, `styles-daily.css`, `styles-retention.css`, `styles-chapters.css`, `vendor/three/three.module.min.js`; bumped to `jeemax-v43`. Offline-first-launch no longer loses metronome/redesign layers/grove engine. | `sw.js` | disk-existence verified ✓ |
| F4 | **Captive-portal/error-page shell poisoning** — network-first navigations now fall back to cached shell when response is non-ok or non-HTML instead of caching junk over `index.html`. | `sw.js` | code-reviewed ✓ |
| F5 | **forest-bg three.js loader** now tries the vendored build first (matching grove-islands) instead of CDN-only. | `forest-bg.js` | smoke/probe ✓ |
| F6 | **Grove world-build deferred off the critical boot path** via `requestIdleCallback` (timeout 4s). Removes the measured multi-second main-thread block during startup; grove still builds (API + pixel A/B vs baseline identical). | `grove-islands.js` | qa-grove-verify ≡ baseline ✓ |
| F7 | **ResizeObserver leak** in full-view rebuilds hoisted to one shared observer (N observers stacked per travel/rebuild). | `grove-islands.js` | code-reviewed ✓ |
| F8 | **`renderGraph()` complexity** — was O(history-days × bank-size) ≈ millions of iterations per dashboard-visible solve and at boot; now one O(n) pass builds a date→yield index consumed per day. | `app.js` | syntax ✓, smoke ✓, qa-today-progress ✓ |
| F9 | **Cloud merge O(n²)** — `.find()` per cloud question replaced with id→question Map in both `loadStateFromCloud` and `executeUnifiedSync` (~9M comparisons → ~3k lookups at 3k×3k). | `storage.js` | syntax ✓, smoke ✓ |
| F10 | Export filenames used UTC dates (wrong day for IST users 00:00–05:30) → local `en-CA` YYYY-MM-DD. | `app.js` | grep-clean ✓ |
| F11 | **Stale QA gate restored** — `scripts/qa-today-progress.mjs` still asserted the pre-redesign ring/row markup (`.tp-ring`, `.tp-row`, `#tp-arc-*`), so `npm run qa-progress` had been red since the dashboard redesign landed (verified: identical failure on baseline HEAD). Rewritten against the current hero+ledger contract — **17/17 green**. | `scripts/qa-today-progress.mjs` | run ✓ 17/17 |
| F12 | **Real redesign regression found & fixed**: the new `.tp-step-btn` steppers were never registered in fx.js's ripple/classify tables, so daily-counter taps silently lost their tick sound, haptic and bump animation after the redesign (and the bump target lookup referenced dead `.tp-row` markup). Registered `.tp-step-btn` + retargeted bump to `[data-subject] .tp-num` with legacy fallback. | `fx.js` | qa-today-progress ✓ 17/17 |
| F13 | **iPad hardening layer** (`styles-ipad.css`, loaded last, precached as v44): ① sub-16px fields forced to 16px under `(pointer:coarse)` — kills iOS focus auto-zoom app-wide; ② fx/sc/metro sliders get 28px hit boxes with the hairline track preserved via background-size pinning; ③ metronome FAB stacks above the dashboard Layout FAB (`body.dc-active` offset) instead of being permanently covered; ④ safe-area insets (`env()` calc) across the whole fixed chrome cluster — FABs, panels, metro popover, island headers, expanded sidebar, persistence banner, skip-toast; ⑤ `.modal-content.wide` no longer clips in Slide Over (≤640px width:100%); ⑥ invisible `::after` hit halos on counter/stepper/close/bento micro-targets, pm-close base opacity raised on touch, nav rows to 44px. Desktop/mouse rendering untouched. | `styles-ipad.css` (new), `index.html`, `sw.js` | runtime probe ✓ (16px computed, 28px sliders, no FAB overlap, 0 console errors, small-target count 19→13 with halos) |
| F14 | **Audio-interruption recovery** for pomodoro session bell (`statechange` auto-resume, matching focus-sound's pattern) and metronome context (same) — bells/click-tracks no longer die silently after iOS alarms/Siri/calls. | `pomodoro.js`, `metronome.js` | syntax ✓, pomo smoke 21/21 ✓ |
| F15 | **Stray-tap guard on the practice modal** — a backdrop click while a live timed attempt is running now requires confirmation instead of silently killing the sprint timer, Flow/Hardcore stacks and armed lifeline (the exact accidental-dismissal path flagged as P1-8). X-button and programmatic closes unaffected. | `app.js` (`closeModal`) | syntax ✓, smoke-practice-nav 41/41 ✓ |
| F16 | **SessionFocus interruption gate (P0-1)** — new shared registry in `storage.js` (`acquire/release/isBusy`, mock state detected via `body.mock-running`). Producers: practice modal open/close paths, vault SR drawer open/close. Consumers: pomodoro phase-end modals queue-until-idle (bell plays immediately, receipt toast shown, auto-flush on focus release / visibility, stale-drop when a new block starts) and Night Guard Tier-3 modal defers via its existing poll loop. The bell-under-practice z-burial and mock-runner silent-penalty scenarios are structurally resolved. | `storage.js`, `app.js`, `matrix.js`, `pomodoro.js`, `nightguard.js` | syntax ✓, smoke 84/84 boot-seq ✓, qa-focus-mode ✓ |
| F17 | **Ghost `#top-streak` repaired** — the daily streak was computed but written to an element that no longer exists, silently zeroing CNS streak-strain bonus, deload's DOM fallback and forest sunlight warmth. `updateStreakDisplay` now publishes `window.__jmaxStreak`; all three consumers read the bridge first (DOM kept as legacy fallback). | `app.js`, `cns-load.js`, `deload.js`, `forest-bg.js` | syntax ✓, smoke ✓ |
| F18 | **Subject-normalizer split-brain closed** — matrix's `_normSubj` now delegates to the canonical `normSubjKey` (alias-aware), so vault filtering/grouping agrees with how questions were written ("Mathematics" rows no longer go invisible). | `matrix.js` | syntax ✓ |
| F19 | **easeFactor regimes unified** — canonical SM-2 path clamps to [1.3, 3.0] (ceiling added), matching the practice-inline nudges and memory-kernel's documented range; vault items can no longer out-grow practice items on the same question. | `storage.js` | syntax ✓, smoke ✓ |
| F20 | Export filenames switched from `toLocaleDateString('en-CA')` to the shared `todayLocalKey()` helper (consistency-audit catch: en-CA can emit non-ISO shapes on odd ICU builds). | `app.js` | grep-clean ✓ |
| F21 | **Full backup/restore shipped (P1-1)** — `buildFullBackup()` dumps the entire IndexedDB store (bank, image vault, ELO, mocks, history-ledger, tombstones…) + full localStorage snapshot into one portable `.json`; `applyFullBackup()` validates marker/version/shape before writing through IDB directly; Config gains a **Data Vault** card (download + restore-from-file); restore auto-downloads a PRE-RESTORE safety copy of current state first; junk files rejected. Proven by a browser round-trip test: seed → backup → total wipe → restore → reload → state rehydrated (**10/10**). | `storage.js`, `app.js`, `index.html`, `scripts/audit-backup-roundtrip.mjs` (new) | round-trip 10/10 ✓ |
| F22 | **Gallery-break repaint cap (P1-13)** — settled-state frames now repaint at ~24fps instead of uncapped 60fps (transitions stay full-rate); kills hours of shadowBlur-path + ~23-gradient-per-frame CPU rasterization per break. Visuals identical (grain/bokeh drift is slow by nature). | `gallery-break.js` | syntax ✓, smoke ✓ |
| F23 | **Log-a-Mistake draft persistence (P1-9)** — chapter/type fields mirror to localStorage on every input, restore when the modal opens, clear only after a successful save. Attached image intentionally not persisted (multi-MB data URLs would blow the quota). | `matrix.js`, `app.js` (`openModal` hook) | syntax ✓, smoke ✓ |
| F24 | **Save-path + KaTeX hygiene** — `_doSaveAll`'s unguarded username DOM read (a missing element rejected the ENTIRE multi-key commit) now falls back to AppState/defaults; KaTeX's post-30s fallback poll terminates on arrival instead of sweeping `document.body` every 2s forever. | `storage.js`, `app.js` | syntax ✓, smoke ✓ |

---

## 3. Open findings — P0/P1 (ordered by user harm)

### P0-1 · Five interruption systems ignore practice/mock state (+ z-order inversions)
Checkpoint lockdowns, Night Guard tiers, pomodoro bell modal, bounty timeout and the boot briefing each fire on their own clock with **no shared "user is mid-practice/mid-mock" gate anywhere** (only `activePracticeDrawerId` exists, consulted by nothing). Z-index makes it worse: `.modal-overlay` z1000 ties with practice-modal (DOM order ⇒ phase-end bell renders *under* practice), and the mock runner's z100000 buries night-guard tint and every standard modal during a 3h paper while penalties/ELO decay mutate silently underneath.
**Fix:** one shared SessionFocus service consulted by all interrupters: defer/queue modals, convert in-session bells to toasts, place interruption overlays above z100000. Boot-sequence already implements the defer-and-queue pattern in-house (`boot-sequence.js:88-99`) — generalize it. Also: checkpoint "idle" detection ignores studying entirely (activity reporters only wired to its own scratchpad).

### P1-1 · No full-state backup/export, and no import
Only exports are a lossy analytics `.txt` and a Gem-feed `.json` projection (drops ids, images, SR/memory fields, counters, ELO, mocks, history, vault images entirely). No restore path exists at all. iPad lost/stolen/browser purge = total loss.
**Fix:** full-backup serializer walking the exact `_doSaveAll` key list + image vault + ledger + tombstones + grove/checkpoint keys; matching schema-versioned restore; "last backup N days ago" reminder.

### P1-2 · iOS focus auto-zoom on tablet widths
16px input fix lives only in `@media (max-width:640px)`; `.pomo-input` 13.5px, `.matrix-search` 13.5px, `.sr-manual-input` 13px, `.text-track-terminal-input` 12.5px apply on all iPads (768–1366px + Split View). Focusing any field zooms Safari ~1.2–1.5× until manual pinch-out.
**Fix:** set ≥16px unconditionally on those classes + fallback `input,select,textarea{font-size:max(16px,1em)}`.

### P1-3 · Range sliders have 3–6px hit areas
`.fx-range` 6px, `.sc-range` 6px, `.metro-range` **3px with an 11px thumb** — soundscape/metronome sliders are near unusable by finger.
**Fix:** input height 28px transparent + track painted via `::-webkit-slider-runnable-track`, thumb margin-offset.

### P1-4 · Metronome FAB and dashboard Layout FAB collide
`#metro-fab` (bottom:20 right:20 z900) vs `#dc-layout-fab` (bottom:22 right:22 z950) — metronome unreachable from Home.
**Fix:** stack offsets when both exist.

### P1-5 · No WebGL context-loss recovery
No `webglcontextlost/restored` handlers in app code (three renderers). iPadOS GPU eviction under memory pressure freezes forest/islands until reload mid-session.
**Fix:** preventDefault + stop loop on lost; rebuild + ensureLoop on restored.

### P1-6 · Safe-area insets missing at tablet widths (home-indicator zone)
Only 3 `env(safe-area-inset-*)` uses exist, both inside phone blocks. The whole fixed cluster (#cp-hub, ignite float, layout FAB, metro FAB/popover, control panel, storage banner, skip-toast, full-island headers, expanded sidebar) sits in the gesture zone in standalone mode.
**Fix:** `calc(<n>px + env(safe-area-inset-bottom/top))` across the cluster; banner padding.

### P1-7 · Error Vault drawer meta-tagging tax (cognitive fatigue)
`canSubmit` requires result + autonomy + ≥1 friction tag + time — 6–7 taps/card, mandatory tagging even for clean solves (~100+ taps for a 15-card queue). Classic abandonment driver for SR systems.
**Fix:** default autonomy, make friction optional/auto-suggested from errorReason, reserve deep tagging for incorrect cards.

### P1-8 · Practice-modal backdrop click kills a live attempt
One stray thumb lands outside the card → timer cleared, Flow/Hardcore stacks cleared, lifeline disarmed, no confirm/undo.
**Fix:** confirm-or-skip-with-undo on backdrop close during unsubmitted attempt (undo pattern already exists at app.js:5930).

### P1-9 · No draft persistence for manual entry / Gem dump
Zero sessionStorage/localStorage draft persistence for ingestion forms; swipe-away mid-entry loses everything (mock answers, by contrast, are refresh-safe).
**Fix:** mirror form inputs to localStorage keyed by modal id; clear on successful save.

### P1-10 · Jargon with zero translation (anxiety amplifier)
Exactly three explanatory tooltips exist in the whole UI while Elo/qElo/MMR/CNS/EF/S/D/L·R deltas surface after every solve; boot briefing teaches none of it. For the anxious-teen audience, unexplained moving numbers read as judgment.
**Fix:** first-seen tooltips/plain-language subtitles per metric; two optional briefing slides ("your rating", "the vault loop"); glossary.

### P1-11 · Whole-corpus persistence shape (perf, grows with age)
Every save rewrites the entire bank as one IDB value (still embedding option/solution images — only 2 of 4 image fields stripped locally); daily ledger fully rebuilt+written twice per burst; per-save JSON.stringify signatures of every question; cloud push uploads whole state ≤1/30s + heartbeat re-downloads whole snapshot every 120s; Drive fileId re-searched every push.
**Fix (staged):** strip all 4 image fields locally (short-term); cache fileId + integer rev counters; then per-question records keyed by id + incremental ledger upsert.

### P1-12 · Image vault RAM-resident from cold boot, unbounded
Entire base64 vault hydrates into RAM at boot by design; background prefetch then pulls ALL Drive-hosted images too (concurrency 4, pinned forever). Hundreds of MB → tab kills on iPad.
**Fix:** Blob-based vault hydrated lazily through existing IO loaders; LRU-cap prefetch; drop fetch-cache entries on settle.

### P1-13 · Gallery-break repaints full-screen canvas uncapped through entire breaks
~60fps CPU rasterization with shadowBlur=40 paths, ~23 radial gradients/frame, per-frame allocations, no hidden/static skip — dominant battery cost during breaks.
**Fix:** cached offscreen blit when settled; cap ~30fps static; cache gradients/Path2D.

---

## 4. Open findings — P2

- **Native alert()/confirm() on critical paths** (63 sites): wrong-answer vault logging alerts inside practice flow; up to 4 sequential alerts per ingestion batch; hostname-titled system dialogs block JS on iPadOS. → toast/status-line (pattern exists: skip-undo toast).
- **Sub-44px targets throughout**: counter-btns 26px (!important), close X's 28px dimmed-to-opacity-.5 until hover, bento grips 26px/14px strips, skip-undo button ~25px with 5s fuse. → invisible `::after inset:-9px` expansions; raise base opacity on `(pointer:coarse)`.
- **Hover-only data surfaces**: elo-monitor tooltip hover-gated; candlestick crosshair mousemove-only (touch can't scrub OHLC; stale tooltip risk). → pointermove/leave + :active/:focus-visible reveal.
- **Gallery-break quote chime can never play on iPadOS** (context created suspended outside gesture, no resume).
- **Pomodoro bell + metronome lack interruption recovery** (focus-sound has the model implementation to copy).
- **Zero visualViewport keyboard adaptation** — keyboard covers bottom chrome/modals in landscape; no `--kb` var anywhere.
- **`.modal-content.wide` 520px beats the 95vw phone fix by specificity** — upload/edit-question modals clip in Slide Over.
- **Expanded sidebar & island headers under standalone status bar** at ≥1181px widths.
- **Modal dismissal grammar split across three regimes** (Escape works almost nowhere; only decay drilldown has the full triple; two parallel closeModal implementations).
- **KaTeX always fetched/parsed at boot** (~292KB even math-free sessions); observer re-parses identical latex on board wipes. → dynamic import on first `$` sighting + bounded latex→HTML memo.
- **SR-drawer answer rebuilds the entire vault board even when hidden** (ungated `renderErrorMatrixFromBank`) — thousands of nodes parsed per answer.
- **BroadcastChannel receiver deserializes full bank on every sibling ping**; no storage-event fallback for browsers without BC.
- **Multi-tab same-day increments lose updates** (max-merge, not sum) — two tabs solving simultaneously drop one solve.
- **Runtime cache has no eviction policy** (~27MB WAVs + CDN dups accumulate; `?v=Date.now()` mints unreusable entries); version-skew window serves old JS to new HTML post-update (SWR) and `skipWaiting` deletes old cache under live pages.
- **Drive token expiry silently stalls heartbeat** (no 401-specific re-auth UX; generic "Sync Failed ✖").
- **Tombstones never leave the device** — cross-device delete resurrects everywhere else; remote edits never propagate back.
- **Update UX absent** — silent force-reload can yank a live session; no update-available toast.
- **Home screen attention budget**: ~14 simultaneous attention surfaces (rings/badges/counters/widget/FABs); declutter module exists as CSS band-aid rather than source-level progressive disclosure.
- **CSS compositing diet**: de-stack per-card backdrop-filter (keep chrome/modals only), pause offscreen infinite animations (0 `animation-play-state` uses today), shadow-pulse keyframes → opacity, kill dusk `background-attachment:fixed`.
- **Crop/OCR pipeline persists PNG data URLs forever** (sync stitch+encode jank; 3–10× oversized vs JPEG/WebP).
- **Startup sequencing**: forced ≥600ms coalesce wait between data-ready and paint; 4 independent IDB gets serialized; `_repairQuestionBank` runs 6 regex passes × every string × every question per cold load.
- **Forest renders while occluded**; firefly buffers rewritten every frame.
- **Checkpoint UI ships dead weight**: 1.4k-line module loaded at eval, injects permanently-hidden panels (monitoring loop deliberately removed).
- **HUD drag reads offsetWidth/Height after style writes each pointermove** (cache on pointerdown).
- **Button verb lexicon pileup** (Save/Create/Add/Lock In/Confirm/Log Attempt/Let's Go/Nvm…) + mixed date formatters.

## 5. Open findings — P3
`format-detection` meta absent · theme-color meta never tracks 7 themes × 2 modes · haptics toggle shown where unsupported · nightguard hold lacks touch-action/callout hardening + progress feedback + keyboard path · crop canvas lacks `touchcancel` · scratchpad hover-dim on touch · KaTeX dead `.woff/.ttf` fallback URLs · `_doSaveAll` reads username from DOM (missing node rejects whole commit) · bounty stored under two keys every save · metronome visual loop 60fps while closed · KaTeX fallback poll never cleared · streak MutationObserver watches whole document · legacy/*.orig.js shipped · nav-menu overflow affordance invisible at ≤375px · midnight watermark not reset on rollover (post-midnight credits ride unsaved) · clock-regression triggers day cycle westward-travel misattribution.

## 6. Verified-solid (do not re-audit)
Save coalescing + pagehide flush + single-transaction boot read · atomic multi-key commits · signature-gated vault writes · persistence-failure banner on every write path · ICU-safe local day keys + settlement sentinel + max-fold-before-zero rollover · append-only self-healing ledger · Elo LWW merge with legacy max fallback · BroadcastChannel echo filters · tombstones block local resurrection · rAF loops self-cancel when hidden/offscreen · zero duplicate-listener accumulation (all global listeners flag-guarded or paired) · singleton AudioContexts · heatmap fingerprinting + 1yr bound · IO-based lazy image loaders with bitmap freeing · all blob URLs revoked · bounded historyLogs/calibrationLog · search debounced + class-toggled · zero `JSON.parse(JSON.stringify(state))` abuse · viewport/touch-action/double-tap fundamentals correct · scratchpad pointer pipeline exemplary · bento DnD fully Pointer-Events · DPR caps + adaptive quality tiers on all GPU canvases · guided empty states everywhere · mock runner refresh-safe · zero unconfirmed destructive actions · boot briefing defers to critical overlays.

## 7. Suggested roadmap (next rounds)
1. ~~iPad input batch~~ → **DONE (F13)**: 16px inputs, slider hit-boxes, FAB de-collision, safe-area insets, wide-modal fix, hit halos.
2. ~~SessionFocus gate~~ → **DONE (F16)** — P0-1 structurally resolved.
3. ~~Full backup/export+import~~ → **DONE (F21)**, round-trip proven 10/10.
4. **WebGL context-loss recovery** for forest-bg + grove renderers (P1-5).
5. **Vault drawer 3-tap flow** remainder (friction now optional ✓; next: default autonomy preselect + auto-suggest tags from errorReason) + **draft persistence** for manual-entry/Gem forms (P1-9) + **jargon tooltips/briefing slides** (P1-10).
6. **Persistence shape staging** (P1-11): strip all 4 image fields locally → cache Drive fileId + integer rev counters → per-question records.
7. **Blob vault + prefetch LRU** (P1-12), gallery-break static blit (P1-13).
8. **CSS compositing diet** with screenshot A/B at each step (22.7%→1.6% dropped-frame headroom measured).
9. Modal grammar unification (one delegated Escape handler), alert→toast migration on practice/ingestion paths, tombstone sync across devices, update-available UX, multi-tab delta merge.
10. Consistency-audit backlog (from the round-2 report): delete dead `renderMomentumCandles` chain + ~142 orphan CSS classes; single daily-forest writer via one bridge owner; README/docs refresh (nonexistent modules, stale SW version, Time-Bank/sparkline claims); consolidate 7 subject normalizers / 4 escapeHtml copies / 4 toast systems; remove stale `window.bounty` mirrors; K=32 gem-path documentation.

**Session tooling added:** `scripts/audit-runtime-probe.mjs` (boot/touch/overflow probe), `audit-cpu-profile.mjs` (startup CPU profile), `audit-scroll-perf.mjs` (backdrop-filter A/B), `audit-overflow-detail.mjs`, `audit-verify-batch3.mjs` (iPad-batch regression check), `audit-backup-roundtrip.mjs` (backup/restore proof). Baseline A/B worktree: `C:\Users\Chaksh\Desktop\jmx-baseline` (HEAD c295a2c + node_modules junction).

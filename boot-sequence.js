// ============================================================================
// boot-sequence.js — "Daily Briefing" cyberpunk boot sequence (P6)
// ----------------------------------------------------------------------------
// Shows ONCE per local calendar day, the first time the app opens after the
// daily reset (hooked into runNewDayCycle in app.js, replacing the bare Vibe
// Check popup). Self-wiring IIFE — injects its own overlay + styles at
// runtime, following the gallery-break.js / checkpoint.js convention so
// index.html stays a single script tag and app.js stays a one-line swap.
//
// Step machine (P3):
//   S1 boot     — terminal typing animation (SKIP/ANY KEY → S2)
//   S2 subject  — pick the arena first: Physics / Chemistry / Maths
//   S3 mood     — vibe check, folds in app.js's calibrateMood() (targets
//                 rescale live; this REPLACES the old Vibe Check popup)
//   S4 path     — Error Matrix vs Question Bank (lands in the matching tab;
//                 P4/P5 will deepen the Question Bank / Matrix branches)
//
// Global controls every step:
//   [ESC] abort the whole briefing (writes the daily guard — seen today)
//   [⌫ BACK] back one step (mood/path only; also aborts a pending timer arm)
//   [1-9] pick an option on choice screens · any key skips the boot animation
// SFX: FX-gated hooks (blip/select/tick/success/confirm/modalClose/soft) play
// at every user action; reduced-motion users get the same flow with no motion.
//
// Deferral: never stacks on a Night Guard modal or checkpoint lockdown —
// backs off (capped retries) and retries once the screen is clear.
// ============================================================================
(function () {
    'use strict';
    if (window.__bootSeqInit) return;
    window.__bootSeqInit = true;

    const LS_KEY = 'jeemax_boot_seq_date';
    const RETRY_MS = 5000;   // defer retry when a conflicting overlay owns the screen
    const MAX_DEFER_RETRIES = 6; // give up after ~30s of persistent conflict
    const CHAR_MS = 16;      // ms per typed character (instant when reduced-motion)
    const LINE_PAUSE_MS = 200;

    const BOOT_LINES = [
        '> INITIALIZING GRIND PROTOCOL v2.7',
        '> SPACED REPETITION ENGINE .......... ONLINE',
        '> ELO CORE .......................... NOMINAL',
        '> ERROR VAULT ....................... SEALED',
        '> WELCOME BACK, OPERATOR.'
    ];

    const STEPS = ['boot', 'subject', 'mood', 'path', 'pomo', 'chapter', 'mode'];
    const IDX = {};
    STEPS.forEach((s, i) => { IDX[s] = i; });
    const HARDCORE_CAP = 8;  // mirrors MODE_TUNING.hardcore.capPerDay in app.js

    let _active = false;       // overlay currently mounted
    let _overlay = null;
    let _backBtn = null;
    let _hintEl = null;
    let _progressEl = null;
    let _bodyEl = null;
    let _timers = [];          // pending intervals/timeouts (cleared on finish)
    let _deferRetries = 0;     // consecutive conflict-deferrals (capped)
    let _stepIdx = 0;
    let _armActive = false;    // pomo step currently showing the 3s arming countdown
    let _currentOptions = [];  // {key, select} handlers for the active step
    let _ctx = { subject: null, mood: null, path: null, chapter: null, mode: null };

    // ------------------------------------------------------------------ utils
    function _todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function _reducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_) { return false; }
    }

    // FX-gated sound hook. window.FX.sound() self-gates on the user's sound
    // pref and no-ops when FX isn't loaded (stubs, very first boot), so these
    // hooks are safe to fire unconditionally.
    function _sfx(name) {
        try {
            if (window.FX && typeof window.FX.sound === 'function') window.FX.sound(name);
        } catch (_) {}
    }

    // A conflicting overlay (Night Guard, checkpoint lockdown) must keep the
    // screen; defer the briefing until it's clear instead of stacking popups.
    // NOTE: on cold boot window.__checkpoint isn't assigned yet (checkpoint.js
    // inits on DOMContentLoaded, after app.js's listener), so the phase check
    // only bites on the live-midnight path — the Night Guard check covers boot.
    function _conflictingOverlay() {
        try {
            const ng = document.getElementById('nightguard-modal');
            if (ng && ng.classList.contains('active')) return true;
        } catch (_) {}
        try {
            const phase = window.__checkpoint && window.__checkpoint.getPhase();
            if (phase === 'grace' || phase === 'active' || phase === 'penalty') return true;
        } catch (_) {}
        return false;
    }

    // ---------------------------------------------------------------- styles
    function _injectStyles() {
        if (document.getElementById('boot-seq-styles')) return;
        const st = document.createElement('style');
        st.id = 'boot-seq-styles';
        st.textContent = [
            '.bootseq{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
            'font-family:"Chakra Petch","IBM Plex Sans",monospace;color:#c4b5fd;overflow:hidden;',
            'background:radial-gradient(1200px 800px at 20% -10%,rgba(124,58,237,.22),transparent 60%),',
            'radial-gradient(1000px 700px at 90% 110%,rgba(6,182,212,.16),transparent 60%),',
            'linear-gradient(180deg,#05030f 0%,#0b0618 55%,#070410 100%);',
            'box-shadow:inset 0 0 200px rgba(1,0,10,.6);}',
            '.bootseq::before{content:"";position:absolute;inset:0;pointer-events:none;',
            'background-image:linear-gradient(rgba(139,92,246,.08) 1px,transparent 1px),',
            'linear-gradient(90deg,rgba(139,92,246,.08) 1px,transparent 1px);background-size:44px 44px;',
            '-webkit-mask-image:radial-gradient(circle at 50% 45%,#000,transparent 80%);mask-image:radial-gradient(circle at 50% 45%,#000,transparent 80%);}',
            '.bootseq::after{content:"";position:absolute;inset:0;pointer-events:none;',
            'background:repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0 1px,transparent 1px 3px);',
            'animation:bootseq-scroll 9s linear infinite;}',
            '@keyframes bootseq-scroll{from{background-position:0 0}to{background-position:0 24px}}',
            '.bootseq-panel{position:relative;width:min(560px,88vw);border:1px solid rgba(139,92,246,.45);',
            'border-radius:12px;padding:28px 30px 24px;background:rgba(10,6,22,.82);',
            'box-shadow:0 0 0 1px rgba(6,182,212,.08),0 0 44px rgba(124,58,237,.35),inset 0 0 60px rgba(124,58,237,.08);',
            'backdrop-filter:blur(6px);',
            'animation:bootseq-rise .5s cubic-bezier(.22,.9,.3,1) both,bootseq-breathe 4.5s ease-in-out .6s infinite alternate;}',
            '@keyframes bootseq-rise{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}',
            '@keyframes bootseq-breathe{from{box-shadow:0 0 0 1px rgba(6,182,212,.08),0 0 44px rgba(124,58,237,.35),inset 0 0 60px rgba(124,58,237,.08)}',
            'to{box-shadow:0 0 0 1px rgba(34,211,238,.22),0 0 62px rgba(124,58,237,.5),inset 0 0 72px rgba(124,58,237,.13)}}',
            '.bootseq-title{font-size:13px;letter-spacing:.34em;color:#22d3ee;text-transform:uppercase;',
            'margin:0 0 14px;text-shadow:0 0 14px rgba(34,211,238,.65);}',
            '.bootseq-progress{display:flex;gap:7px;margin:0 0 18px;}',
            '.bootseq-dot{width:9px;height:9px;border-radius:50%;background:rgba(139,92,246,.22);transition:all .2s ease;}',
            '.bootseq-dot.is-done{background:rgba(139,92,246,.75);box-shadow:0 0 8px rgba(139,92,246,.5);}',
            '.bootseq-dot.is-active{background:#22d3ee;box-shadow:0 0 10px rgba(34,211,238,.9);transform:scale(1.25);}',
            '.bootseq-body{min-height:224px;}',
            '.bootseq-term{font-size:13.5px;line-height:1.75;color:#a5b4fc;word-break:break-word;min-height:132px;}',
            '.bootseq-line{white-space:pre-wrap;min-height:1.5em;}',
            '.bootseq-cursor{display:inline-block;width:8px;height:15px;background:#22d3ee;vertical-align:-2px;',
            'margin-left:2px;animation:bootseq-blink 1s steps(2) infinite;box-shadow:0 0 10px rgba(34,211,238,.8);}',
            '@keyframes bootseq-blink{50%{opacity:0}}',
            '.bootseq-screen-title{font-size:17px;letter-spacing:.14em;text-transform:uppercase;color:#e9d5ff;',
            'margin:4px 0 6px;text-shadow:0 0 16px rgba(139,92,246,.5);}',
            '.bootseq-screen-sub{font-size:12px;color:rgba(165,180,252,.6);margin:0 0 20px;}',
            '.bootseq-opts{display:flex;flex-direction:column;gap:12px;}',
            '.bootseq-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;font-family:inherit;',
            'font-size:14px;letter-spacing:.06em;color:#c4b5fd;background:rgba(124,58,237,.08);',
            'border:1px solid rgba(139,92,246,.4);border-radius:10px;padding:14px 16px;cursor:pointer;transition:all .16s ease;}',
            '.bootseq-opt:hover{color:#fff;border-color:#22d3ee;background:rgba(34,211,238,.12);',
            'box-shadow:0 0 20px rgba(34,211,238,.3);transform:translateX(4px);}',
            '.bootseq-opt:active{transform:translateX(0) scale(.99);}',
            '.bootseq-opt-icon{font-size:20px;width:28px;text-align:center;filter:drop-shadow(0 0 8px rgba(139,92,246,.6));}',
            '.bootseq-opt-label{flex:1;text-transform:uppercase;letter-spacing:.08em;}',
            '.bootseq-opt-desc{font-size:11px;color:rgba(165,180,252,.55);display:block;margin-top:2px;letter-spacing:.02em;text-transform:none;}',
            '.bootseq-opt-key{font-size:11px;color:#22d3ee;border:1px solid rgba(34,211,238,.4);border-radius:6px;padding:2px 7px;}',
            '.bootseq-opt.is-disabled{opacity:.4;cursor:not-allowed;transform:none!important;box-shadow:none!important;}',
            '.bootseq-opt.is-disabled:hover{color:#c4b5fd;border-color:rgba(139,92,246,.4);background:rgba(124,58,237,.08);}',
            '.bootseq button:focus-visible{outline:2px solid #22d3ee;outline-offset:2px;border-radius:6px;}',
            '.bootseq-opt-chmeta{font-size:10.5px;color:rgba(165,180,252,.5);margin-left:auto;letter-spacing:.04em;white-space:nowrap;}',
            '.bootseq-arm{display:flex;flex-direction:column;align-items:center;gap:12px;padding:30px 0 8px;text-align:center;}',
            '.bootseq-arm-num{font-size:46px;font-weight:700;color:#22d3ee;text-shadow:0 0 26px rgba(34,211,238,.65);}',
            '.bootseq-arm-sub{font-size:12px;color:rgba(165,180,252,.6);letter-spacing:.14em;text-transform:uppercase;}',
            '.bootseq-arm-config{font-size:11px;color:rgba(34,211,238,.85);letter-spacing:.06em;}',
            '.bootseq-footer{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:10px;}',
            '.bootseq-footleft{display:flex;align-items:center;gap:10px;min-width:0;}',
            '.bootseq-hint{font-size:11px;letter-spacing:.18em;color:rgba(165,180,252,.55);white-space:nowrap;}',
            '.bootseq-back{font-family:inherit;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#a5b4fc;',
            'background:transparent;border:1px solid rgba(139,92,246,.35);border-radius:6px;padding:6px 10px;cursor:pointer;',
            'transition:all .16s ease;}',
            '.bootseq-back:hover{color:#fff;border-color:#22d3ee;background:rgba(34,211,238,.1);}',
            '.bootseq-skip{font-family:inherit;font-size:12px;letter-spacing:.22em;text-transform:uppercase;',
            'color:#c4b5fd;background:transparent;border:1px solid rgba(139,92,246,.5);border-radius:8px;',
            'padding:8px 18px;cursor:pointer;transition:all .18s ease;}',
            '.bootseq-skip:hover{color:#fff;border-color:#22d3ee;background:rgba(34,211,238,.12);',
            'box-shadow:0 0 18px rgba(34,211,238,.35);transform:translateY(-1px);}',
            '.bootseq-skip:active{transform:translateY(0);}',
            '@media (prefers-reduced-motion:reduce){.bootseq::after{display:none}.bootseq-cursor,.bootseq-panel{animation:none}',
            '.bootseq-opt,.bootseq-skip,.bootseq-back,.bootseq-dot{transition:none}.bootseq-opt:hover,.bootseq-skip:hover,.bootseq-back:hover{transform:none}}',
            '@media (max-width:520px){.bootseq-panel{padding:22px 18px;}.bootseq-hint{display:none;}.bootseq-opt{padding:12px 12px;}}'
        ].join('');
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------ build
    function _buildOverlay() {
        _overlay = document.createElement('div');
        _overlay.className = 'bootseq';
        _overlay.setAttribute('role', 'dialog');
        _overlay.setAttribute('aria-modal', 'true');
        _overlay.setAttribute('aria-label', 'Daily Briefing');
        _overlay.innerHTML =
            '<div class="bootseq-panel">' +
                '<p class="bootseq-title">JEEMaxxing // Daily Briefing</p>' +
                // Step content renders here; boot typing is decorative, so no
                // aria-live (a screen reader would announce every character).
                '<div class="bootseq-progress"></div>' +
                '<div class="bootseq-body"></div>' +
                '<div class="bootseq-footer">' +
                    '<div class="bootseq-footleft">' +
                        '<button class="bootseq-back" type="button" style="display:none">‹ BACK</button>' +
                        '<span class="bootseq-hint"></span>' +
                    '</div>' +
                    '<button class="bootseq-skip" type="button">SKIP ▸</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(_overlay);

        _backBtn = _overlay.querySelector('.bootseq-back');
        _hintEl = _overlay.querySelector('.bootseq-hint');
        _progressEl = _overlay.querySelector('.bootseq-progress');
        _bodyEl = _overlay.querySelector('.bootseq-body');
        const skipBtn = _overlay.querySelector('.bootseq-skip');
        if (skipBtn) skipBtn.addEventListener('click', () => finish());
        if (_backBtn) _backBtn.addEventListener('click', back);
        document.addEventListener('keydown', _onKey);
        _renderStep();
        _sfx('blip');
        // Keyboard control works without a click — claim focus on the dialog.
        // (Guarded: minimal DOM stubs used by the smoke harness have no focus.)
        if (typeof _overlay.focus === 'function') {
            try { _overlay.focus({ preventScroll: true }); } catch (_) {}
        }
    }

    // ----------------------------------------------------------- step machine
    function _renderStep() {
        const step = STEPS[_stepIdx];
        // Any re-render leaves the arming countdown (it owns the pomo step's
        // body, not _renderStep) — flag it off so hint/progress reset.
        _armActive = false;
        if (_backBtn) {
            _backBtn.style.display = _stepIdx >= IDX.mood ? 'inline-block' : 'none';
        }
        switch (step) {
            case 'boot': _renderBoot(); break;
            case 'subject': _renderSubject(); break;
            case 'mood': _renderMood(); break;
            case 'path': _renderPath(); break;
            case 'pomo': _renderPomo(); break;
            case 'chapter': _renderChapter(); break;
            case 'mode': _renderMode(); break;
        }
        _renderProgress();
        // Hint AFTER the step renders so the option count is known.
        if (_hintEl) {
            const n = Math.min(_currentOptions.length, 9);
        // (The arming screen sets its own hint in _armPomodoro — _armActive is
        // always false by the time this runs, so no arm branch is needed here.)
        _hintEl.textContent = step === 'boot'
            ? '[ESC] ABORT · ANY KEY TO SKIP'
            : '[1-' + n + '] SELECT · [ESC] ABORT';
        }
    }

    // HUD step dots — one per goal step (boot is intro, not a goal). Marked
    // done once passed, glowing while active.
    function _renderProgress() {
        if (!_progressEl) return;
        _progressEl.innerHTML = '';
        for (let i = 1; i < STEPS.length; i++) {
            const dot = document.createElement('span');
            dot.className = 'bootseq-dot';
            if (i === _stepIdx) dot.classList.add('is-active');
            else if (i < _stepIdx) dot.classList.add('is-done');
            _progressEl.appendChild(dot);
        }
    }

    function _next(stepName) {
        const idx = STEPS.indexOf(stepName);
        if (idx < 0) return;
        // Leaving a step kills its timers FIRST — back()/finish() already did
        // this, but the boot-skip key path didn't: the orphaned typing chain
        // kept running and its queued setTimeout(onDone) re-fired
        // _next('subject') seconds later, yanking the user back a screen.
        _clearTimers();
        _stepIdx = idx;
        _renderStep();
    }

    function back() {
        if (_stepIdx <= IDX.subject) return;
        // Leaving a step must kill its timers first — Backspace mid-arming
        // would otherwise let the countdown fire startTimer on the wrong screen.
        _clearTimers();
        _stepIdx--;
        _sfx('soft');
        _renderStep();
    }

    // S1 — boot animation
    function _renderBoot() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const termEl = document.createElement('div');
        termEl.className = 'bootseq-term';
        _bodyEl.appendChild(termEl);
        _playTyping(termEl, () => _next('subject'));
    }

    function _playTyping(termEl, onDone) {
        const lines = BOOT_LINES.slice();
        let cursorEl = null;
        const reduced = _reducedMotion();

        const step = () => {
            if (!lines.length) {
                // All lines rendered — advance to the next step.
                if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
                _timers.push(setTimeout(onDone, 700));
                return;
            }
            const text = lines.shift();
            const line = document.createElement('div');
            line.className = 'bootseq-line';
            termEl.appendChild(line);
            if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
            cursorEl = document.createElement('span');
            cursorEl.className = 'bootseq-cursor';

            if (reduced) {
                line.textContent = text;
                termEl.appendChild(cursorEl);
                _timers.push(setTimeout(step, LINE_PAUSE_MS));
                return;
            }
            let i = 0;
            const tick = setInterval(() => {
                i++;
                line.textContent = text.slice(0, i);
                if (i >= text.length) {
                    clearInterval(tick);
                    termEl.appendChild(cursorEl);
                    _timers.push(setTimeout(step, LINE_PAUSE_MS));
                }
            }, CHAR_MS);
            _timers.push(tick);
        };
        step();
    }

    // S2 — subject picker
    function _renderSubject() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const title = document.createElement('h2');
        title.className = 'bootseq-screen-title';
        title.textContent = 'PICK YOUR ARENA, OPERATOR.';
        _bodyEl.appendChild(title);
        const sub = document.createElement('p');
        sub.className = 'bootseq-screen-sub';
        sub.textContent = 'The briefing focuses today\'s grind on one subject.';
        _bodyEl.appendChild(sub);

        const grid = document.createElement('div');
        grid.className = 'bootseq-opts';
        const opts = [
            { val: 'physics', icon: '⚛️', label: 'Physics' },
            { val: 'chemistry', icon: '🧪', label: 'Chemistry' },
            { val: 'maths', icon: '📐', label: 'Maths' },
        ];
        opts.forEach((o, i) => {
            const pick = () => _chooseSubject(o.val);
            const b = _makeOptButton(o, i);
            b.addEventListener('click', pick);
            grid.appendChild(b);
            _currentOptions.push({ key: i + 1, select: pick });
        });
        _bodyEl.appendChild(grid);
    }

    function _chooseSubject(s) {
        _ctx.subject = s;
        _sfx('select');
        _next('mood');
    }

    // S3 — vibe check (folds in app.js calibrateMood)
    function _renderMood() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const title = document.createElement('h2');
        title.className = 'bootseq-screen-title';
        title.textContent = 'HOW\'S THE BRAIN BATTERY?';
        _bodyEl.appendChild(title);
        const sub = document.createElement('p');
        sub.className = 'bootseq-screen-sub';
        sub.textContent = 'Your daily targets rescale to how locked in you are.';
        _bodyEl.appendChild(sub);

        const grid = document.createElement('div');
        grid.className = 'bootseq-opts';
        const opts = [
            { val: 'sad', icon: '🥱', label: 'Fried', desc: 'targets × 0.70' },
            { val: 'neutral', icon: '😐', label: 'Steady', desc: 'targets × 1.00' },
            { val: 'happy', icon: '🔥', label: 'Locked', desc: 'targets × 1.20' },
        ];
        opts.forEach((o, i) => {
            const pick = () => _chooseMood(o.val);
            const b = _makeOptButton(o, i);
            b.addEventListener('click', pick);
            grid.appendChild(b);
            _currentOptions.push({ key: i + 1, select: pick });
        });
        _bodyEl.appendChild(grid);
    }

    function _chooseMood(m) {
        _ctx.mood = m;
        _sfx('select');
        // Same call the old Vibe Check modal made — rescales activeTargets and
        // persists jeemax_mood_multiplier. Fire-and-forget; it saves async.
        if (typeof window.calibrateMood === 'function') {
            try { window.calibrateMood(m); } catch (_) {}
        }
        _next('path');
    }

    // S4 — Error Matrix vs Question Bank
    function _renderPath() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const title = document.createElement('h2');
        title.className = 'bootseq-screen-title';
        title.textContent = 'WHAT ARE WE COOKING TODAY?';
        _bodyEl.appendChild(title);
        const sub = document.createElement('p');
        sub.className = 'bootseq-screen-sub';
        sub.textContent = 'Hunt yesterday\'s errors or push fresh questions.';
        _bodyEl.appendChild(sub);

        const grid = document.createElement('div');
        grid.className = 'bootseq-opts';
        const opts = [
            { val: 'matrix', icon: '☣', label: 'Error Matrix', desc: 'Priority queue — weakest errors first' },
            { val: 'bank', icon: '📖', label: 'Question Bank', desc: 'Fresh grind — chapters, flow & hardcore' },
        ];
        opts.forEach((o, i) => {
            const pick = () => _choosePath(o.val);
            const b = _makeOptButton(o, i);
            b.addEventListener('click', pick);
            grid.appendChild(b);
            _currentOptions.push({ key: i + 1, select: pick });
        });
        _bodyEl.appendChild(grid);
    }

    function _choosePath(v) {
        _ctx.path = v;
        // Question Bank branch continues in-flow (pomodoro → chapter → mode);
        // Error Matrix branch lands on the vault's priority queue. The matrix
        // pick is the final action of that branch → confirm; bank is a waypoint.
        if (v === 'bank') { _sfx('select'); _next('pomo'); return; }
        if (v === 'matrix') { _sfx('confirm'); _launchMatrixQueue(); return; }
    }

    // Shared option-button builder for the choice screens.
    function _makeOptButton(o, i, disabled) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bootseq-opt' + (disabled ? ' is-disabled' : '');
        b.innerHTML =
            '<span class="bootseq-opt-icon">' + o.icon + '</span>' +
            '<span class="bootseq-opt-label">' + o.label +
                (o.desc ? '<span class="bootseq-opt-desc">' + o.desc + '</span>' : '') +
            '</span>' +
            (o.meta ? '<span class="bootseq-opt-chmeta">' + o.meta + '</span>' : '') +
            '<span class="bootseq-opt-key">' + (i + 1) + '</span>';
        return b;
    }

    // S5 — pomodoro prompt (arm with last config, 3s cancel grace)
    function _renderPomo() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const title = document.createElement('h2');
        title.className = 'bootseq-screen-title';
        title.textContent = 'LOCK IN WITH A TIMER?';
        _bodyEl.appendChild(title);

        let cfgLine = 'no saved config — defaults 50/10';
        try {
            const lastCfg = window.__pomodoro && typeof window.__pomodoro.getConfig === 'function'
                ? window.__pomodoro.getConfig() : null;
            if (lastCfg) {
                cfgLine = lastCfg.study + ' min focus · ' + lastCfg.break + ' min chill · ' +
                    lastCfg.sessions + ' round' + (lastCfg.stopwatch ? ' · stopwatch' : '') +
                    ' · ' + String(lastCfg.subject).toUpperCase();
            }
        } catch (_) {}
        const sub = document.createElement('p');
        sub.className = 'bootseq-screen-sub';
        sub.textContent = 'Last setup: ' + cfgLine + '.';
        _bodyEl.appendChild(sub);

        const grid = document.createElement('div');
        grid.className = 'bootseq-opts';
        const opts = [
            { val: 'yes', icon: '⚡', label: 'Lock In', desc: 'Arm the timer with your last config' },
            { val: 'no', icon: '⏩', label: 'Raw Dog', desc: 'No timer — straight to the grind' },
        ];
        opts.forEach((o, i) => {
            const pick = () => {
                if (o.val === 'yes') { _armPomodoro(); return; }
                _sfx('select');
                _next('chapter');
            };
            const b = _makeOptButton(o, i);
            b.addEventListener('click', pick);
            grid.appendChild(b);
            _currentOptions.push({ key: i + 1, select: pick });
        });
        _bodyEl.appendChild(grid);
    }

    function _armPomodoro() {
        _sfx('confirm');
        // Unlock the pomodoro AudioContext inside this click gesture so the
        // ignition chime can play when the timer auto-starts from a timer.
        if (window.initAudioContext) { try { window.initAudioContext(); } catch (_) {} }
        let wasStopwatch = false;
        try {
            const lastCfg = window.__pomodoro && typeof window.__pomodoro.getConfig === 'function'
                ? window.__pomodoro.getConfig() : null;
            wasStopwatch = !!(lastCfg && lastCfg.stopwatch);
        } catch (_) {}
        // Pre-fill Focus Mode with the last-used config, then point the timer
        // at the arena subject chosen in this briefing.
        if (window.applyPomoConfig) { try { window.applyPomoConfig(); } catch (_) {} }
        const subjEl = document.getElementById('pomo-subject');
        if (subjEl && _ctx.subject) {
            subjEl.value = _ctx.subject;
            if (window.changeStudySubject) { try { window.changeStudySubject(); } catch (_) {} }
        }

        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const box = document.createElement('div');
        box.className = 'bootseq-arm';
        const num = document.createElement('div');
        num.className = 'bootseq-arm-num';
        num.textContent = '3';
        const sub = document.createElement('div');
        sub.className = 'bootseq-arm-sub';
        sub.textContent = wasStopwatch ? 'Arming stopwatch tracking' : 'Arming focus timer';
        const cfg = document.createElement('div');
        cfg.className = 'bootseq-arm-config';
        cfg.textContent = String(_ctx.subject).toUpperCase();
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'bootseq-skip';
        cancel.textContent = 'CANCEL';
        // CANCEL means "undo the arm" — same as Backspace: back to the Lock In
        // / Raw Dog prompt. (Advancing to chapter is what Raw Dog does.)
        cancel.addEventListener('click', _abortArm);
        box.appendChild(num);
        box.appendChild(sub);
        box.appendChild(cfg);
        box.appendChild(cancel);
        _bodyEl.appendChild(box);
        _armActive = true;
        if (_hintEl) _hintEl.textContent = '[ESC] ABORT ARM · IGNITING IN 3';

        let n = 3;
        const tick = setInterval(() => {
            n--;
            num.textContent = String(Math.max(0, n));
            if (_hintEl) _hintEl.textContent = '[ESC] ABORT ARM · IGNITING IN ' + Math.max(0, n);
            _sfx('tick');
            if (n <= 0) {
                clearInterval(tick);
                _armComplete();
            }
        }, 1000);
        _timers.push(tick);
    }

    function _armComplete() {
        _clearTimers();
        _sfx('success');
        try { if (window.startTimer) window.startTimer(); } catch (_) {}
        _next('chapter');
    }

    // Backspace / CANCEL mid-arming: kill the countdown (it must never fire
    // startTimer on a different screen) and re-show the Lock In / Raw Dog
    // prompt, where the user can re-arm or pick Raw Dog instead.
    function _abortArm() {
        _clearTimers();
        _sfx('soft');
        _renderStep();
    }

    // S6 — chapter picker (weakest chapter first)
    function _renderChapter() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const subject = _ctx.subject || 'physics';
        const state = window.AppState;
        const subjectChapters = (state && state.chapters) ? state.chapters[subject] : null;
        const list = Array.isArray(subjectChapters) ? subjectChapters : [];

        const title = document.createElement('h2');
        title.className = 'bootseq-screen-title';
        title.textContent = 'CHOOSE A CHAPTER, OPERATOR.';
        _bodyEl.appendChild(title);
        const sub = document.createElement('p');
        sub.className = 'bootseq-screen-sub';
        sub.textContent = 'Arena: ' + subject.toUpperCase() + ' — weakest chapter first.';
        _bodyEl.appendChild(sub);

        if (!list.length) {
            // Empty bank — route to Feed Questions instead of dead-ending.
            const msg = document.createElement('p');
            msg.className = 'bootseq-screen-sub';
            msg.textContent = 'No chapters in ' + subject.toUpperCase() + ' yet — feed some questions to get cooking.';
            _bodyEl.appendChild(msg);
            const feed = document.createElement('button');
            feed.type = 'button';
            feed.className = 'bootseq-skip';
            feed.textContent = 'FEED QUESTIONS ▸';
            feed.addEventListener('click', () => {
                finish();
                if (typeof window.openModal === 'function') {
                    try { window.openModal('upload-modal'); } catch (_) {}
                }
            });
            _bodyEl.appendChild(feed);
            return;
        }

        const ranked = list
            .map(ch => ({
                name: ch,
                health: _chapterHealth(subject, ch),
                count: _chapterCount(subject, ch),
            }))
            .sort((a, b) => a.health - b.health);

        const grid = document.createElement('div');
        grid.className = 'bootseq-opts';
        ranked.forEach((c, i) => {
            const o = { icon: '📘', label: c.name, desc: 'chapter health ' + c.health + '%', meta: c.count + ' Q' };
            const pick = () => _chooseChapter(c.name);
            const b = _makeOptButton(o, i);
            b.addEventListener('click', pick);
            grid.appendChild(b);
            _currentOptions.push({ key: i + 1, select: pick });
        });
        _bodyEl.appendChild(grid);
    }

    function _normSubjectKey(s) {
        s = String(s || '').toLowerCase().trim();
        if (s === 'math' || s === 'mathematics') return 'maths';
        return (s === 'physics' || s === 'chemistry' || s === 'maths') ? s : 'physics';
    }

    function _chapterCount(subject, chapter) {
        const state = window.AppState;
        if (!state || !Array.isArray(state.questionBank)) return 0;
        const s = _normSubjectKey(subject);
        return state.questionBank.filter(q =>
            _normSubjectKey(q.subject) === s && q.chapter === chapter).length;
    }

    // Mirrors app.js _isUnexecutedModeQuestion: a Flow/Hardcore question must
    // be genuinely untouched (status alone isn't enough — older records can
    // keep an 'unsolved' status after an attempt).
    function _isUnexecuted(q) {
        if (!q) return false;
        const s = q.status;
        const untouched = s == null || s === 'unsolved' || s === 'unexecuted';
        const hasHistory = Array.isArray(q.historyLogs) && q.historyLogs.length > 0;
        const hasFirst = q.firstAttemptResult === 'correct' || q.firstAttemptResult === 'incorrect';
        const hasTelemetry = Number(q.solveCount) > 0 || !!q.lastReviewedAt || !!q.lastSolvedAt ||
            (typeof q.timeTaken === 'number' && q.timeTaken > 0);
        return untouched && !hasHistory && !hasFirst && !hasTelemetry && !q.errorReason;
    }

    function _chapterUnexecutedCount(subject, chapter) {
        const state = window.AppState;
        if (!state || !Array.isArray(state.questionBank)) return 0;
        const s = _normSubjectKey(subject);
        return state.questionBank.filter(q =>
            _normSubjectKey(q.subject) === s && q.chapter === chapter && _isUnexecuted(q)).length;
    }

    // Health comes from the SAME model the app's Chapter Health Grid renders
    // (matrix.js's retrieval-strength engine), so "weakest chapter first" in
    // the boot flow always matches the order the user sees in-app.
    function _chapterHealth(subject, chapter) {
        if (typeof window.getChapterHealth === 'function') {
            try { return window.getChapterHealth(subject, chapter); } catch (_) {}
        }
        return 50;
    }

    function _chooseChapter(ch) {
        _ctx.chapter = ch;
        _sfx('select');
        _next('mode');
    }

    // S7 — challenge level (Flow / Hardcore / Standard)
    function _renderMode() {
        _bodyEl.innerHTML = '';
        _currentOptions = [];
        const state = window.AppState;
        // Read the engine's real cap so this gate can't drift from MODE_TUNING.
        const cap = (window.MODE_TUNING && window.MODE_TUNING.hardcore &&
            window.MODE_TUNING.hardcore.capPerDay) || HARDCORE_CAP;
        const hardcoreCapped = !!(state &&
            state.hardcoreDailyDate === _todayKey() &&
            state.hardcoreDailyCount >= cap);
        const freshQs = _chapterUnexecutedCount(_ctx.subject, _ctx.chapter) > 0;

        const title = document.createElement('h2');
        title.className = 'bootseq-screen-title';
        title.textContent = 'SELECT YOUR CHALLENGE LEVEL.';
        _bodyEl.appendChild(title);
        const sub = document.createElement('p');
        sub.className = 'bootseq-screen-sub';
        sub.textContent = 'Chapter: ' + _ctx.chapter + ' — how spicy?';
        _bodyEl.appendChild(sub);

        const grid = document.createElement('div');
        grid.className = 'bootseq-opts';
        const noFresh = 'No untouched questions in this chapter — pick Standard';
        const opts = [
            { val: 'flow', icon: '🎯', label: 'Flow State', desc: freshQs ? 'P_win 0.75–0.85 · gentle cadence' : noFresh },
            {
                val: 'hardcore', icon: '⚡', label: 'Hardcore',
                desc: hardcoreCapped
                    ? 'Daily cap reached — come back tomorrow'
                    : (freshQs ? 'P_win 0.35–0.50 · 1.8× payout · ' + cap + '/day cap' : noFresh),
            },
            { val: 'standard', icon: '🧱', label: 'Standard', desc: 'All questions, no gimmicks' },
        ];
        opts.forEach((o, i) => {
            const disabled = (o.val === 'hardcore' && hardcoreCapped) ||
                ((o.val === 'flow' || o.val === 'hardcore') && !freshQs);
            const pick = () => { if (!disabled) _chooseMode(o.val); };
            const b = _makeOptButton(o, i, disabled);
            b.addEventListener('click', pick);
            grid.appendChild(b);
            _currentOptions.push({ key: i + 1, select: pick });
        });
        _bodyEl.appendChild(grid);
    }

    function _chooseMode(m) {
        _ctx.mode = m;
        _sfx('confirm');
        _launchQBPractice();
    }

    // ----------------------------------------------------------------- finish
    function _clearTimers() {
        _timers.forEach(t => { try { clearInterval(t); clearTimeout(t); } catch (_) {} });
        _timers = [];
    }

    function finish(noSound) {
        if (!_active) return;
        _active = false;
        _armActive = false;
        _clearTimers();
        document.removeEventListener('keydown', _onKey);
        if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
        _overlay = null;
        _backBtn = null;
        _hintEl = null;
        _progressEl = null;
        _bodyEl = null;
        _currentOptions = [];
        // Abort/skip plays the close chime; launch paths call finish(true) and
        // play their own confirm at the user action (no double-chime).
        if (!noSound) _sfx('modalClose');

        // Never re-ask today — even a SKIP counts as seen.
        try { localStorage.setItem(LS_KEY, _todayKey()); } catch (_) {}

        // Skipping the whole briefing leaves moodMultiplier untouched — exactly
        // equivalent to closing the old Vibe Check modal without picking (which
        // also left it unchanged). Don't "fix" this into a mood mutation.
    }

    // Path choice lands in the matching tab. (P4 deepens the Question Bank
    // branch with pomodoro → chapter → mode; P5 deepens the Matrix branch
    // with the priority queue.)
    // switchTab resolves AFTER its own renders, so follow-up work must wait for
    // it or it would run on the wrong view (switchTab re-shows the subview).
    function _afterTab(tab, fn) {
        if (typeof window.switchTab === 'function') {
            try {
                const navEl = document.querySelector('.nav-item[data-tab="' + tab + '"]');
                Promise.resolve(window.switchTab(tab, navEl || null)).then(fn, fn);
                return;
            } catch (_) {}
        }
        fn();
    }

    // Error Matrix landing: vault + Daily Fix Queue (most-priority first) with
    // the priority pool auto-opened in the practice modal. Solving advances
    // through the queue in order via the app's own Next/Prev loop.
    function _launchMatrixQueue() {
        finish(true); // confirm already played on the matrix path choice
        _afterTab('errors', () => {
            // Force-arm the vault's priority list (never toggle — a stale
            // on-state from a previous session must not flip it back off).
            if (window.activateDailyQueue) {
                try { window.activateDailyQueue(); } catch (_) {}
            } else if (window.toggleDailyQueue) {
                try { window.toggleDailyQueue(); } catch (_) {}
            }
            // Resolve the locked-in queue ids (priority order) into live bank
            // objects and open practice at index 0.
            let ids = [];
            if (typeof window._getDailyQueueSnapshot === 'function') {
                try { ids = window._getDailyQueueSnapshot() || []; } catch (_) {}
            }
            const state = window.AppState;
            const qs = [];
            if (state && Array.isArray(state.questionBank)) {
                for (const id of ids) {
                    const q = state.questionBank.find(x =>
                        x.id != null && String(x.id) === String(id));
                    if (q) qs.push(q);
                }
            }
            if (qs.length) {
                // Seed the vault context so the post-run question-list landing
                // is coherent (this flow never browsed a chapter explicitly).
                if (state) {
                    if (qs[0].subject) state.currentSubject = qs[0].subject;
                    if (qs[0].chapter) state.currentChapter = qs[0].chapter;
                }
                if (window.startPracticeWithQuestion) {
                    try { window.startPracticeWithQuestion(qs, 0); } catch (_) {}
                }
            }
        });
    }

    // Question Bank landing: enter the chapter (weakest-first pick), arm the
    // chosen mode, and auto-open practice.
    function _launchQBPractice() {
        finish(true); // confirm already played on the mode choice
        const subject = _ctx.subject || 'physics';
        const chapter = _ctx.chapter;

        const doLaunch = () => {
            try { if (window.selectSubject) window.selectSubject(subject); } catch (_) {}
            try { if (window.openChapterDetail) window.openChapterDetail(chapter); } catch (_) {}
            const state = window.AppState;
            const chapterQs = (state && Array.isArray(state.currentChapterQuestions))
                ? state.currentChapterQuestions : [];
            if (!chapterQs.length) return; // empty chapter — the list view shows the empty state
            if (_ctx.mode === 'standard' || _chapterUnexecutedCount(subject, chapter) === 0) {
                // Standard, or a mode with no untouched candidates — land in
                // standard practice instead of tripping the app's "No more
                // Flow-eligible questions" alert mid-flow.
                try { if (window.startPracticeWithQuestion) window.startPracticeWithQuestion(chapterQs, 0); } catch (_) {}
                return;
            }
            // Flow / Hardcore — the app's own launcher picks a mode-appropriate
            // question, opens the practice modal and starts the timer.
            if (_ctx.mode === 'flow' && window.startFlowPractice) {
                try { window.startFlowPractice(); } catch (_) {}
            } else if (_ctx.mode === 'hardcore' && window.startHardcorePractice) {
                try { window.startHardcorePractice(); } catch (_) {}
            }
        };

        _afterTab('practice', doLaunch);
    }

    // ------------------------------------------------------------ key control
    function _onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
        if (e.key === 'Backspace') {
            e.preventDefault();
            // Mid-arming, Backspace undoes the arm and returns to the timer
            // prompt — the countdown is cleared, never a phantom startTimer.
            if (_armActive) { _abortArm(); return; }
            back();
            return;
        }
        if (_stepIdx === IDX.boot) {
            // Boot animation is skippable — any key jumps to the subject step.
            e.preventDefault();
            _next('subject');
            return;
        }
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= _currentOptions.length && num <= 9) {
            const opt = _currentOptions[num - 1];
            if (opt && typeof opt.select === 'function') opt.select();
        }
    }

    // ----------------------------------------------------------------- public
    function maybeShow() {
        if (_active) return;
        try {
            if (localStorage.getItem(LS_KEY) === _todayKey()) return;
        } catch (_) { return; }
        if (_conflictingOverlay()) {
            // Cap the defer chain — a never-clearing conflict (e.g. checkpoint
            // stuck active) must not leave a periodic retry for the whole session.
            if (_deferRetries >= MAX_DEFER_RETRIES) return;
            _deferRetries++;
            _timers.push(setTimeout(maybeShow, RETRY_MS));
            return;
        }
        if (!document.body) { _timers.push(setTimeout(maybeShow, 500)); return; }
        _deferRetries = 0;
        _active = true;
        // A fresh briefing always starts at the boot step — a second maybeShow
        // (live-midnight path) must not resume the previous run's last step.
        _stepIdx = 0;
        _ctx = { subject: null, mood: null, path: null, chapter: null, mode: null };
        _injectStyles();
        try {
            _buildOverlay();
        } catch (e) {
            // Never leave the app half-blacked-out: tear down whatever mounted
            // (the key listener AND any partial overlay — finish() can't do it
            // because it early-returns on !_active) and fall back to the
            // classic Vibe Check so mood calibration is never lost.
            try { document.removeEventListener('keydown', _onKey); } catch (_) {}
            try { if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay); } catch (_) {}
            _overlay = null; _backBtn = null; _hintEl = null; _progressEl = null; _bodyEl = null;
            _currentOptions = [];
            _active = false;
            _armActive = false;
            _clearTimers();
            if (typeof window.openModal === 'function') {
                try { window.openModal('mood-modal'); } catch (_) {}
            }
        }
    }

    window.BootSequence = {
        maybeShow: maybeShow,
        skip: finish,
        // test hook — exposes internals for the Node smoke harness
        _test: {
            get isActive() { return _active; },
            get step() { return STEPS[_stepIdx]; },
            get ctx() { return _ctx; },
            get pendingTimers() { return _timers.length; },
            get arming() { return _armActive; },
            press(key) { const e = { key: key, preventDefault() {} }; _onKey(e); },
            armNow() { _armComplete(); },
            lsKey: LS_KEY,
            todayKey: _todayKey,
        },
    };
})();

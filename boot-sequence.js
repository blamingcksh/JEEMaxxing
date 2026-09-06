// ============================================================================
// boot-sequence.js — Daily Mood Check (soft pastel popup)
// ----------------------------------------------------------------------------
// Shows ONCE per local calendar day, the first time the app opens after the
// daily reset (hooked into runNewDayCycle in app.js). Replaces the old
// multi-step "Daily Briefing" cyberpunk boot sequence with a single cute mood
// check that folds into app.js's calibrateMood() — the same call the Vibe
// Check modal makes, so targets rescale and persist exactly as before.
// Intentionally UNDISMISSABLE: no skip link, no ✕, no Esc — picking a mood
// is the only way the popup closes, so calibration always happens.
//
// Self-wiring IIFE — injects its own overlay + styles at runtime. The public
// surface (window.BootSequence.maybeShow / .skip) and the daily guard key
// (jeemax_boot_seq_date) are unchanged from the briefing era: app.js seeds
// its day-settlement gate from that key, and QA scripts dismiss the popup
// via the .bootseq overlay class — keep both stable.
//
// Deferral: never stacks on a Night Guard modal or checkpoint lockdown —
// backs off (capped retries) and retries once the screen is clear.
// SFX: FX-gated hooks (blip on open, select on pick, modalClose on skip).
// ============================================================================

(function () {
    'use strict';
    if (window.__bootSeqInit) return;
    window.__bootSeqInit = true;

    const LS_KEY = 'jeemax_boot_seq_date';
    const RETRY_MS = 5000;   // defer retry when a conflicting overlay owns the screen
    const MAX_DEFER_RETRIES = 6; // give up after ~30s of persistent conflict

    const MOODS = [
        { val: 'sad', cls: 'is-sad', emoji: '🥱', label: 'fried', desc: 'running on fumes', targets: 'targets ×0.70' },
        { val: 'neutral', cls: 'is-neutral', emoji: '🌤️', label: 'steady', desc: 'calm and cruising', targets: 'targets ×1.00' },
        { val: 'happy', cls: 'is-happy', emoji: '✨', label: 'locked in', desc: 'ready to crush it today', targets: 'targets ×1.20' },
    ];

    let _active = false;       // overlay currently mounted
    let _overlay = null;
    let _timers = [];          // pending deferral retries (cleared on finish)
    let _deferRetries = 0;     // consecutive conflict-deferrals (capped)
    let _currentOptions = [];  // {key, select} for keyboard picks

    // ------------------------------------------------------------------ utils
    function _todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    // FX-gated sound hook. window.FX.sound() self-gates on the user's sound
    // pref and no-ops when FX isn't loaded (stubs, very first boot), so this
    // hook is safe to fire unconditionally.
    function _sfx(name) {
        try {
            if (window.FX && typeof window.FX.sound === 'function') window.FX.sound(name);
        } catch (_) {}
    }

    // A conflicting overlay (Night Guard, checkpoint lockdown) must keep the
    // screen; defer the mood check until it's clear instead of stacking.
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
            'font-family:"IBM Plex Sans","Chakra Petch",sans-serif;overflow:hidden;padding:20px;',
            'background:radial-gradient(900px 620px at 15% 0%,rgba(248,187,217,.20),transparent 60%),',
            'radial-gradient(820px 620px at 85% 100%,rgba(167,199,255,.20),transparent 60%),',
            'radial-gradient(700px 500px at 80% 10%,rgba(216,180,254,.14),transparent 60%),',
            'rgba(10,6,20,.55);backdrop-filter:blur(8px);}',
            '.moodpop{position:relative;width:min(440px,92vw);border-radius:36px;padding:40px 30px 30px;text-align:center;',
            'background:linear-gradient(170deg,#fff5fa 0%,#f3ecff 48%,#e8f3ff 100%);overflow:hidden;',
            'box-shadow:0 34px 90px rgba(80,40,120,.5),inset 0 0 0 1.5px rgba(255,255,255,.85);',
            'animation:moodpop-in .7s cubic-bezier(.34,1.56,.64,1) both;}',
            '@keyframes moodpop-in{from{opacity:0;transform:translateY(30px) scale(.8) rotate(-1.5deg)}',
            '60%{transform:translateY(-4px) scale(1.02) rotate(.5deg)}to{opacity:1;transform:none}}',
            // dreamy halo bleeding past the card's top edge
            '.moodpop::before{content:"";position:absolute;top:-70px;left:50%;width:280px;height:160px;',
            'transform:translateX(-50%);pointer-events:none;',
            'background:radial-gradient(ellipse at center,rgba(248,187,217,.5),transparent 70%);',
            'animation:moodpop-halo 4.5s ease-in-out infinite alternate;}',
            '@keyframes moodpop-halo{from{opacity:.6}to{opacity:1}}',
            // drifting hearts/sparkles inside the card
            '.moodpop-float{position:absolute;bottom:-24px;color:#e9a8c9;font-size:13px;opacity:0;pointer-events:none;',
            'animation:moodpop-drift 8s linear infinite;}',
            '.moodpop-float.f1{left:8%;animation-delay:0s;}',
            '.moodpop-float.f2{left:24%;font-size:10px;color:#b9a8e8;animation-delay:2.6s;}',
            '.moodpop-float.f3{left:42%;font-size:11px;color:#8fb8ec;animation-delay:5.2s;}',
            '.moodpop-float.f4{left:60%;font-size:14px;color:#f4c2a1;animation-delay:1.4s;}',
            '.moodpop-float.f5{left:76%;font-size:10px;color:#b9a8e8;animation-delay:4s;}',
            '.moodpop-float.f6{left:90%;font-size:12px;color:#e9a8c9;animation-delay:6.4s;}',
            '@keyframes moodpop-drift{0%{opacity:0;transform:translateY(0) rotate(-10deg)}',
            '12%{opacity:.65}80%{opacity:.4}100%{opacity:0;transform:translateY(-340px) rotate(14deg)}}',
            // twinkles beside the mascot
            '.moodpop-spark{position:absolute;top:34px;font-size:13px;color:#c9a8e0;pointer-events:none;',
            'animation:moodpop-twinkle 2.4s ease-in-out infinite;}',
            '.moodpop-spark.s1{left:calc(50% - 74px);}',
            '.moodpop-spark.s2{right:calc(50% - 74px);font-size:11px;animation-delay:1.2s;}',
            '@keyframes moodpop-twinkle{0%,100%{opacity:.25;transform:scale(.8) rotate(0deg)}',
            '50%{opacity:.9;transform:scale(1.15) rotate(18deg)}}',
            // mascot in a glowing pastel badge
            '.moodpop-mascot{position:relative;display:inline-flex;align-items:center;justify-content:center;',
            'width:86px;height:86px;border-radius:50%;font-size:44px;line-height:1;',
            'background:radial-gradient(circle at 32% 26%,#ffffff,#ffe9f3 58%,#f3e6ff);',
            'box-shadow:0 12px 28px rgba(240,166,200,.5),inset 0 0 0 2px rgba(255,255,255,.95);',
            'animation:moodpop-float 3.4s ease-in-out infinite;}',
            '@keyframes moodpop-float{0%,100%{transform:translateY(0) rotate(-2.5deg)}50%{transform:translateY(-9px) rotate(3deg)}}',
            '.moodpop-title{position:relative;margin:16px 0 6px;font-size:23px;font-weight:800;letter-spacing:.01em;',
            'color:#7d5bb5;background:linear-gradient(92deg,#c05c8e 0%,#8a63c9 55%,#5f8fd6 100%);',
            '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}',
            '.moodpop-sub{position:relative;font-size:12.5px;color:#a08cb4;margin:0 0 24px;}',
            '.moodpop-opts{position:relative;display:flex;flex-direction:column;gap:12px;}',
            '.moodpop-opt{display:flex;align-items:center;gap:14px;width:100%;text-align:left;font-family:inherit;',
            'background:rgba(255,255,255,.92);border:1.5px solid rgba(190,160,220,.35);border-radius:22px;',
            'padding:11px 16px;cursor:pointer;',
            'transition:transform .2s cubic-bezier(.34,1.56,.64,1),border-color .18s ease,box-shadow .18s ease;}',
            '.moodpop-emoji{flex:none;display:flex;align-items:center;justify-content:center;',
            'width:50px;height:50px;border-radius:18px;font-size:26px;line-height:1;',
            'transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .18s ease;}',
            '.moodpop-optlabel{flex:1;min-width:0;}',
            '.moodpop-label{display:block;font-size:15px;font-weight:700;color:#4a3a5e;}',
            '.moodpop-desc{display:block;font-size:11.5px;color:#a08cb4;margin-top:2px;}',
            '.moodpop-key{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;',
            'font-size:11px;font-weight:600;color:#a78bba;border:1px solid rgba(190,160,220,.5);',
            'border-radius:50%;background:rgba(255,255,255,.7);}',
            // per-mood pastel accents
            '.moodpop-opt.is-sad .moodpop-emoji{background:#f1e9ff;}',
            '.moodpop-opt.is-neutral .moodpop-emoji{background:#e3f2ff;}',
            '.moodpop-opt.is-happy .moodpop-emoji{background:#fff0e0;}',
            '.moodpop-opt.is-sad:hover{border-color:#c9a8e8;box-shadow:0 12px 28px rgba(201,168,232,.45);}',
            '.moodpop-opt.is-neutral:hover{border-color:#93c1ec;box-shadow:0 12px 28px rgba(147,193,236,.45);}',
            '.moodpop-opt.is-happy:hover{border-color:#f4c290;box-shadow:0 12px 28px rgba(244,194,144,.5);}',
            '.moodpop-opt:hover{transform:translateY(-3px) scale(1.025);}',
            '.moodpop-opt:hover .moodpop-emoji{transform:scale(1.15) rotate(-8deg);',
            'box-shadow:0 8px 18px rgba(80,40,120,.15);}',
            '.moodpop-opt:active{transform:translateY(0) scale(.99);}',
            '.bootseq button:focus-visible{outline:2px solid #f0a6c8;outline-offset:2px;}',
            '@media (prefers-reduced-motion:reduce){.moodpop,.moodpop-mascot,.moodpop-float,',
            '.moodpop-spark,.moodpop-emoji{animation:none!important;}',
            '.moodpop-float,.moodpop-spark{opacity:.35!important;transform:none!important;}',
            '.moodpop-opt,.moodpop-emoji{transition:none!important;}',
            '.moodpop-opt:hover,.moodpop-emoji{transform:none!important;}}',
            '@media (max-width:420px){.moodpop{padding:32px 18px 24px;}.moodpop-key{display:none;}}'
        ].join('');
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------ build
    function _buildOverlay() {
        _overlay = document.createElement('div');
        _overlay.className = 'bootseq';
        _overlay.setAttribute('role', 'dialog');
        _overlay.setAttribute('aria-modal', 'true');
        _overlay.setAttribute('aria-label', 'Daily mood check');
        _overlay.innerHTML =
            '<div class="moodpop">' +
                '<span class="moodpop-float f1" aria-hidden="true">♡</span>' +
                '<span class="moodpop-float f2" aria-hidden="true">✦</span>' +
                '<span class="moodpop-float f3" aria-hidden="true">✿</span>' +
                '<span class="moodpop-float f4" aria-hidden="true">♡</span>' +
                '<span class="moodpop-float f5" aria-hidden="true">✦</span>' +
                '<span class="moodpop-float f6" aria-hidden="true">♪</span>' +
                '<span class="moodpop-spark s1" aria-hidden="true">✦</span>' +
                '<span class="moodpop-spark s2" aria-hidden="true">✧</span>' +
                '<span class="moodpop-mascot" aria-hidden="true">🌷</span>' +
                '<h2 class="moodpop-title">how are you feeling today?</h2>' +
                '<p class="moodpop-sub">your daily targets will tune themselves to match ♡</p>' +
                '<div class="moodpop-opts"></div>' +
            '</div>';
        document.body.appendChild(_overlay);

        const optsEl = _overlay.querySelector('.moodpop-opts');
        _currentOptions = [];
        MOODS.forEach((m, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'moodpop-opt ' + m.cls;
            b.innerHTML =
                '<span class="moodpop-emoji">' + m.emoji + '</span>' +
                '<span class="moodpop-optlabel">' +
                    '<span class="moodpop-label">' + m.label + '</span>' +
                    '<span class="moodpop-desc">' + m.desc + ' · ' + m.targets + '</span>' +
                '</span>' +
                '<span class="moodpop-key">' + (i + 1) + '</span>';
            b.addEventListener('click', () => _chooseMood(m.val));
            optsEl.appendChild(b);
            _currentOptions.push({ key: i + 1, select: () => _chooseMood(m.val) });
        });

        document.addEventListener('keydown', _onKey);
        _sfx('blip');
        // Keyboard control works without a click — claim focus on the dialog.
        // (Guarded: minimal DOM stubs used by the smoke harness have no focus.)
        if (typeof _overlay.focus === 'function') {
            try { _overlay.focus({ preventScroll: true }); } catch (_) {}
        }
    }

    function _chooseMood(m) {
        _sfx('select');
        // Same call the Vibe Check modal makes — rescales activeTargets and
        // persists jeemax_mood_multiplier. Fire-and-forget; it saves async.
        if (typeof window.calibrateMood === 'function') {
            try { window.calibrateMood(m); } catch (_) {}
        }
        finish();
    }

    // ------------------------------------------------------------ key control
    // Mood picks only — there is deliberately no Esc dismiss: the popup must
    // be answered (a pick is the only way it closes).
    function _onKey(e) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= _currentOptions.length) {
            const opt = _currentOptions[num - 1];
            if (opt && typeof opt.select === 'function') opt.select();
        }
    }

    // ----------------------------------------------------------------- finish
    // Only reachable through a mood pick — the guard is written here and the
    // multiplier is always calibrated before the popup leaves the screen.
    function finish(noSound) {
        if (!_active) return;
        _active = false;
        _clearTimers();
        document.removeEventListener('keydown', _onKey);
        if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
        _overlay = null;
        _currentOptions = [];
        if (!noSound) _sfx('modalClose');
        try { localStorage.setItem(LS_KEY, _todayKey()); } catch (_) {}
    }

    function _clearTimers() {
        _timers.forEach(t => { try { clearTimeout(t); } catch (_) {} });
        _timers = [];
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
            _overlay = null;
            _currentOptions = [];
            _active = false;
            _clearTimers();
            if (typeof window.openModal === 'function') {
                try { window.openModal('mood-modal'); } catch (_) {}
            }
        }
    }

    window.BootSequence = {
        maybeShow: maybeShow,
        // QA/test escape hatch only — the UI itself has no dismiss path.
        skip: finish,
        // test hook — exposes internals for the Node smoke harness
        _test: {
            get isActive() { return _active; },
            get pendingTimers() { return _timers.length; },
            press(key) { const e = { key: key, preventDefault() {} }; _onKey(e); },
            lsKey: LS_KEY,
            todayKey: _todayKey,
        },
    };
})();

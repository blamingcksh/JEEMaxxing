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
        {
            val: 'sad',
            cls: 'is-sad',
            emoji: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15.5A7.5 7.5 0 1 1 10.5 4a6 6 0 0 0 7.5 11.5Z"/><circle cx="15.5" cy="7.5" r="1" fill="currentColor"/></svg>',
            label: 'Low',
            desc: 'Waning crescent · running on fumes',
            targets: 'targets ×0.70'
        },
        {
            val: 'neutral',
            cls: 'is-neutral',
            emoji: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><line x1="12" y1="3.5" x2="12" y2="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
            label: 'Steady',
            desc: 'Equinox horizon · calm and cruising',
            targets: 'targets ×1.00'
        },
        {
            val: 'happy',
            cls: 'is-happy',
            emoji: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/></svg>',
            label: 'Sharp',
            desc: 'Solar corona · locked in and ready',
            targets: 'targets ×1.20'
        },
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
            'font-family:"IBM Plex Sans","JetBrains Mono",sans-serif;overflow:hidden;padding:20px;',
            'background:rgba(6,7,10,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}',
            '.moodpop{position:relative;width:min(440px,92vw);border-radius:18px;padding:36px 28px 28px;text-align:center;',
            'background:#0B0E16;border:1px solid rgba(229,192,123,0.28);overflow:hidden;',
            'box-shadow:0 34px 90px rgba(0,0,0,.85),0 0 40px rgba(229,192,123,.08);',
            'animation:moodpop-in .5s cubic-bezier(.23,1,.32,1) both;}',
            '@keyframes moodpop-in{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:none}}',
            '.moodpop-mascot{position:relative;display:inline-flex;align-items:center;justify-content:center;',
            'width:78px;height:78px;border-radius:50%;margin-bottom:14px;',
            'background:rgba(229,192,123,0.06);border:1px solid rgba(229,192,123,0.38);',
            'box-shadow:0 0 24px rgba(229,192,123,0.12);}',
            '.moodpop-mascot img{width:56px;height:56px;object-fit:contain;}',
            '.moodpop-micro{display:block;font-family:"JetBrains Mono","IBM Plex Mono",monospace;font-size:9.5px;',
            'font-weight:600;letter-spacing:.22em;color:rgba(229,192,123,0.85);text-transform:uppercase;margin-bottom:6px;}',
            '.moodpop-title{position:relative;margin:0 0 6px;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;',
            'font-size:28px;font-weight:500;color:#F2EDE3;letter-spacing:.02em;}',
            '.moodpop-sub{position:relative;font-size:12px;color:rgba(242,237,227,0.6);margin:0 0 24px;}',
            '.moodpop-opts{position:relative;display:flex;flex-direction:column;gap:10px;}',
            '.moodpop-opt{display:flex;align-items:center;gap:14px;width:100%;text-align:left;font-family:inherit;',
            'background:rgba(18,23,36,0.72);border:1px solid rgba(229,192,123,0.18);border-radius:12px;',
            'padding:10px 14px;cursor:pointer;color:#F2EDE3;',
            'transition:transform .2s cubic-bezier(.23,1,.32,1),border-color .18s ease,background .18s ease,box-shadow .18s ease;}',
            '.moodpop-emoji{flex:none;display:flex;align-items:center;justify-content:center;',
            'width:42px;height:42px;border-radius:8px;line-height:1;',
            'background:rgba(229,192,123,0.06);border:1px solid rgba(229,192,123,0.22);color:#E5C07B;',
            'transition:transform .2s cubic-bezier(.23,1,.32,1),border-color .18s ease;}',
            '.moodpop-optlabel{flex:1;min-width:0;}',
            '.moodpop-label{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:19px;font-weight:600;color:#F2EDE3;}',
            '.moodpop-desc{display:block;font-family:"JetBrains Mono","IBM Plex Mono",monospace;font-size:10.5px;color:rgba(242,237,227,0.55);margin-top:2px;}',
            '.moodpop-key{flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;',
            'font-family:"JetBrains Mono","IBM Plex Mono",monospace;font-size:10.5px;font-weight:600;color:#E5C07B;border:1px solid rgba(229,192,123,0.35);',
            'border-radius:4px;background:rgba(229,192,123,0.08);}',
            '.moodpop-opt:hover{border-color:rgba(229,192,123,0.65);background:rgba(26,33,52,0.95);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.5),0 0 16px rgba(229,192,123,0.12);}',
            '.moodpop-opt:hover .moodpop-emoji{border-color:rgba(229,192,123,0.6);transform:scale(1.08);}',
            '.moodpop-opt:active{transform:translateY(0) scale(.99);}',
            '.bootseq button:focus-visible{outline:2px solid #E5C07B;outline-offset:2px;}',
            '@media (prefers-reduced-motion:reduce){.moodpop,.moodpop-mascot,.moodpop-opt,.moodpop-emoji{animation:none!important;transition:none!important;}}',
            '@media (max-width:420px){.moodpop{padding:28px 16px 20px;}.moodpop-key{display:none;}}'
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
                '<div class="moodpop-mascot" aria-hidden="true"><img src="atlas/atmos-v-armillary.svg" alt="" aria-hidden="true"></div>' +
                '<span class="moodpop-micro">MERIDIAN CHECK · DAILY CALIBRATION</span>' +
                '<h2 class="moodpop-title">How’s the head today?</h2>' +
                '<p class="moodpop-sub">Calibrating today’s meridian capacity &amp; target scaling</p>' +
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

// ==UserScript==
// @name         supermicro-ipmi: paste from clipboard
// @namespace    https://github.com/stvhay/supermicro-ipmi
// @version      0.1.0
// @description  Type browser-clipboard text into the iKVM/HTML5 console as keystrokes
// @match        https://*/cgi/url_redirect.cgi?url_name=man_ikvm_html5_bootstrap*
// @match        https://*/cgi/url_redirect.cgi?url_name=man_ikvm_html5_auto*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---- Constants ----
    const XK_Shift_L = 0xffe1;
    const XK_Tab     = 0xff09;
    const XK_Return  = 0xff0d;
    const RFB_READY_POLL_MS    = 250;
    const RFB_READY_TIMEOUT_MS = 30_000;
    const TOAST_FADE_MS        = 3_000;

    const KEYSYMS = buildKeysyms();
    function buildKeysyms() {
        const m = new Map();
        const SHIFTED_PUNCT = '~!@#$%^&*()_+{}|:"<>?';
        for (let cp = 0x20; cp <= 0x7e; cp++) {
            const ch = String.fromCharCode(cp);
            const isUpper = ch >= 'A' && ch <= 'Z';
            const isShifted = isUpper || SHIFTED_PUNCT.indexOf(ch) !== -1;
            m.set(cp, { keysym: cp, shift: isShifted });
        }
        m.set(0x09, { keysym: XK_Tab,    shift: false });
        m.set(0x0a, { keysym: XK_Return, shift: false });
        return m;
    }

    let _pasteInFlight = false;

    // ---- Toast ----

    function ensureToastEl() {
        let el = document.getElementById('smc_paste_toast');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'smc_paste_toast';
        el.style.cssText = [
            'position:fixed',
            'top:16px',
            'right:16px',
            'z-index:2147483647',
            'max-width:420px',
            'padding:10px 14px',
            'background:rgba(30,30,30,0.92)',
            'color:#fff',
            'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            'border-radius:4px',
            'box-shadow:0 2px 10px rgba(0,0,0,0.3)',
            'cursor:pointer',
            'opacity:0',
            'transition:opacity 200ms ease',
            'pointer-events:none',
        ].join(';');
        el.addEventListener('click', () => {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
        });
        if (document.body) {
            document.body.appendChild(el);
        } else {
            document.documentElement.appendChild(el);
        }
        return el;
    }

    let _toastTimer = null;
    function toast(msg) {
        const el = ensureToastEl();
        el.textContent = msg;
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
        if (_toastTimer) clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
        }, TOAST_FADE_MS);
    }

    // ---- RFB readiness ----

    function waitForRFB() {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const tick = () => {
                try {
                    if (window.UI && window.UI.rfb &&
                        window.UI.rfb._rfb_state === 'normal') {
                        resolve();
                        return;
                    }
                } catch (_) {
                    // fall through to retry
                }
                if (Date.now() - started >= RFB_READY_TIMEOUT_MS) {
                    reject(new Error(
                        "iKVM didn't connect within 30s — paste-userscript inactive."
                    ));
                    return;
                }
                setTimeout(tick, RFB_READY_POLL_MS);
            };
            tick();
        });
    }

    // ---- Validation ----

    function validatePaste(text) {
        const badChars = new Set();
        let firstOffset = -1;
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (cp === 0x0d) continue; // \r filtered to coalesce CRLF -> LF
            if (!KEYSYMS.has(cp)) {
                if (firstOffset === -1) firstOffset = i;
                badChars.add(text.charAt(i));
            }
        }
        if (firstOffset === -1) {
            return { ok: true };
        }
        return {
            ok: false,
            badChars: Array.from(badChars),
            firstOffset,
            firstChar: text.charAt(firstOffset),
        };
    }

    // ---- Wire send ----

    function sendKeyEvent(keysym, down) {
        const RFB = window.RFB;
        const rfb = window.UI && window.UI.rfb;
        if (!RFB || !RFB.messages || typeof RFB.messages.keyEvent !== 'function') {
            throw new Error(
                'This iKVM build is missing RFB.messages.keyEvent — paste-userscript not compatible.'
            );
        }
        if (!rfb || !rfb._sock || typeof rfb._sock.send !== 'function') {
            throw new Error(
                'This iKVM build is missing RFB.messages.keyEvent — paste-userscript not compatible.'
            );
        }
        const bytes = RFB.messages.keyEvent(keysym, down ? 1 : 0);
        rfb._sock.send(bytes);
    }

    function sendChar(entry) {
        const { keysym, shift } = entry;
        if (shift) sendKeyEvent(XK_Shift_L, 1);
        sendKeyEvent(keysym, 1);
        sendKeyEvent(keysym, 0);
        if (shift) sendKeyEvent(XK_Shift_L, 0);
    }

    async function sendPaste(text) {
        const validation = validatePaste(text);
        if (!validation.ok) {
            const ch = validation.firstChar;
            const offset = validation.firstOffset;
            toast(
                `Cannot paste: character '${ch}' at position ${offset} isn't on the US-ANSI layout. Aborting.`
            );
            return;
        }

        let sentChars = 0;
        try {
            for (let i = 0; i < text.length; i++) {
                const cp = text.charCodeAt(i);
                if (cp === 0x0d) continue; // skip \r (CRLF -> LF)
                const entry = KEYSYMS.get(cp);
                sendChar(entry);
                sentChars++;
                // Yield between chars; effective rate well under USB HID limit.
                await new Promise((r) => setTimeout(r, 0));
            }
        } catch (err) {
            // Wire send failure: defensive Shift release, then toast.
            try { sendKeyEvent(XK_Shift_L, 0); } catch (_) { /* ignore */ }
            // Distinguish missing-builder error from a generic send throw.
            const msg = err && err.message ? err.message : String(err);
            if (msg.indexOf('RFB.messages.keyEvent') !== -1) {
                toast(msg);
            } else {
                toast('WebSocket error — paste interrupted.');
            }
            return;
        }

        // INV-5: defensive Shift release after success too.
        try { sendKeyEvent(XK_Shift_L, 0); } catch (_) { /* ignore */ }
        toast(`Pasted ${sentChars} chars`);
    }

    // ---- Top-level orchestrator ----

    async function pasteFromClipboard() {
        if (_pasteInFlight) {
            toast('Paste already in progress.');
            return;
        }

        // Re-check RFB readiness at paste time.
        try {
            if (!(window.UI && window.UI.rfb &&
                  window.UI.rfb._rfb_state === 'normal')) {
                toast('iKVM not connected — try again once the console is live.');
                return;
            }
        } catch (_) {
            toast('iKVM not connected — try again once the console is live.');
            return;
        }

        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (_) {
            toast('Clipboard read denied — grant permission in the browser address bar.');
            return;
        }

        if (!text || text.length === 0) {
            toast('Clipboard is empty.');
            return;
        }

        _pasteInFlight = true;
        try {
            await sendPaste(text);
        } finally {
            _pasteInFlight = false;
        }
    }

    // ---- UI install ----

    function installUI() {
        // Feature-detect the RFB.messages.keyEvent builder up front so the
        // user gets a clear failure at install time, not at paste time.
        const RFB = window.RFB;
        if (!RFB || !RFB.messages || typeof RFB.messages.keyEvent !== 'function') {
            toast(
                'This iKVM build is missing RFB.messages.keyEvent — paste-userscript not compatible.'
            );
            return;
        }

        // Navbar dropdown "Clipboard" -> "Paste from clipboard"
        try {
            const navbar = document.querySelector('ul.nav.navbar-nav');
            if (navbar && !document.getElementById('smc_paste_li')) {
                const li = document.createElement('li');
                li.id = 'smc_paste_li';
                li.className = 'dropdown';

                const toggle = document.createElement('a');
                toggle.href = '#';
                toggle.className = 'dropdown-toggle';
                toggle.setAttribute('data-toggle', 'dropdown');
                toggle.setAttribute('role', 'button');
                toggle.setAttribute('aria-haspopup', 'true');
                toggle.setAttribute('aria-expanded', 'false');
                toggle.textContent = 'Clipboard ';
                const caret = document.createElement('span');
                caret.className = 'caret';
                toggle.appendChild(caret);

                const menu = document.createElement('ul');
                menu.className = 'dropdown-menu';

                const itemLi = document.createElement('li');
                const item = document.createElement('a');
                item.id = 'smc_paste';
                item.href = '#';
                item.textContent = 'Paste from clipboard';
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    pasteFromClipboard();
                });
                itemLi.appendChild(item);
                menu.appendChild(itemLi);

                li.appendChild(toggle);
                li.appendChild(menu);
                navbar.appendChild(li);
            }
        } catch (_) {
            // Navbar absent or shape changed: hotkey still works.
        }

        // Capture-phase Ctrl+Shift+V.
        // INV-3: hotkey predicate REQUIRES e.shiftKey. Plain Ctrl+V (no Shift)
        // is NOT intercepted; it must keep flowing to the noVNC pipeline so
        // the host receives the keystroke.
        document.addEventListener('keydown', (e) => {
            const isV = (e.key === 'V' || e.key === 'v' ||
                         e.code === 'KeyV' || e.keyCode === 86);
            if (!isV) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (!e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            pasteFromClipboard();
        }, true);

        // Make sure the toast container exists so first toast doesn't lag.
        ensureToastEl();
    }

    // ---- Entrypoint ----

    waitForRFB()
        .then(installUI)
        .catch((err) => toast(err && err.message ? err.message : String(err)));

    window.smcPaste = pasteFromClipboard;
})();

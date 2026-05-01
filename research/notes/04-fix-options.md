# 04 — fix-option sketches

> **Probe results (logged):** Option A and Option D were both probed
> at runtime with `_rfb_state === "normal"`. Both failed: ClientCutText
> sent via `UI.rfb.clipboardPasteFrom(...)` produced nothing on the
> host, and `set_onClipboard(...)` never fired despite copies inside
> the guest. See `03-clipboard-gap.md` §Empirical for details.
>
> **v0.1 path is Option C.** Options A and B (and D) are kept here for
> documentation — they would only become viable if a future BMC or
> firmware revision actually wires an in-guest clipboard agent.

Three options below, ordered cheapest-first.

## Option A — wire the existing RFB clipboard plumbing

**Premise:** the BMC honours ClientCutText. Confirmed only after the
runtime probe.

**Userscript shape (sketch, not final code):**

1. Wait for `UI.rfb` to exist (poll for `window.UI && UI.rfb` or hook
   the `onUpdateState` callback for state `normal`).
2. Add a "Clipboard" navbar dropdown — `<li>` with a child `<a>` for
   "Paste from clipboard" and one for "Show last received…".
3. On click: `await navigator.clipboard.readText()` (browser
   permission prompt fires once per origin), then call
   `UI.rfb.clipboardPasteFrom(text)`.
4. Optionally also bind a keyboard shortcut. Use **Ctrl+Shift+V** —
   not Ctrl+V — because Ctrl+V is consumed by `keyboard.js` and
   forwarded as a keystroke to the host, which is what people want
   when running a paste-aware app. Bind on capture phase via
   `document.addEventListener('keydown', …, true)` so the listener
   runs before the noVNC `Keyboard.grab()` listener and can
   `stopPropagation()` + `preventDefault()` on the chord.

**Tradeoffs:**
- Cleanest path. ~30–60 lines of code.
- Relies on the BMC to actually deliver ClientCutText. **Untested.**
- No keystroke timing issues, no Unicode mapping, no shift-state
  guessing.
- Will paste binary-correct strings, including newlines / tabs.

## Option B — same as A, but bind paste on a hidden textarea

**Premise:** A is viable, but you want native paste UX (`Ctrl+V` /
right-click → Paste, browser's own permission prompt).

Insert an off-screen `<textarea>`, focus it when the user invokes
"Paste mode" (via menu item, hotkey, or focus-stealing trick), and
listen for the DOM `paste` event:

```js
ta.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    UI.rfb.clipboardPasteFrom(text);
    canvas.focus();   // give focus back so keys keep going to the host
    e.preventDefault();
});
```

**Tradeoffs vs A:**
- Pleasanter UX in some browsers — the user gets the standard
  permission prompt (or none at all if site is trusted).
- More moving parts — focus management is fiddly. The noVNC
  keyboard listeners are bound to `document`, so a focused textarea
  doesn't actually divert them; we'd need to `ungrab()` while the
  textarea has focus or `stopPropagation()` on its events.
- Probably overkill for v1. Keep as a follow-up if the menu-item
  flow proves too clicky.

## Option C — type-as-keystrokes fallback

**Premise:** The probe shows ClientCutText is dropped by the BMC.
We can't use the RFB clipboard channel at all; we have to simulate
each character as a keypress that the BMC translates into USB HID.

**Userscript shape:**

1. Same UI hook as A (menu item or Ctrl+Shift+V).
2. Read clipboard text.
3. For each character, look up the X11 keysym (we already have
   `keysymdef.js` shipped on the page — it exports `XK_*` constants
   and `keysyms.lookup()`).
4. For uppercase / shifted chars, send Shift down → keysym down →
   keysym up → Shift up. For literal newlines, send Return. For tab,
   send Tab.
5. Send each as a `RFB.messages.keyEvent(keysym, 1)` followed by
   `keyEvent(keysym, 0)`, pumped via `UI.rfb._sock.send`.
6. Throttle. The BMC's USB HID emulation has limits; 50–100 chars/sec
   with a small delay between events is a reasonable starting point.

**Tradeoffs:**
- Works regardless of what the BMC does with ClientCutText.
- Bound to the *guest's* current keyboard layout. Pasting "@" on a
  guest with a French layout produces something else. Hard to fix
  without knowing the guest layout.
- Can't paste characters not on the guest's keyboard at all
  (e.g. emoji, accented chars on a US-ANSI guest).
- Can interact badly with auto-complete, paste-detection in shells
  that wrap pasted text in bracketed-paste sequences (the BMC
  emulates a USB keyboard, no bracketed-paste mode).
- Slower for long pastes; rates above ~150 chars/sec start dropping
  characters on most BMCs.
- Code is bigger — keysym map, shift-state planner, throttle queue.

This is the *escape hatch*. Bigger and uglier than A/B but is the
only thing guaranteed to work.

## Option D — surface host-cut-text to the browser clipboard

Independent of the paste direction, copy-out is broken too (see 03,
failure 1). One small hook fixes it:

```js
UI.rfb.set_onClipboard(function (rfb, text) {
    // Avoid silent overwrite — show a small "Copy host clipboard" toast
    // or stash in a global and offer a menu item that does the copy.
    window.lastHostClipboard = text;
    showToast("Host clipboard ready (click to copy)", () => {
        navigator.clipboard.writeText(text);
    });
});
```

Direct `navigator.clipboard.writeText(text)` from inside the callback
fails the user-gesture check, so we have to surface the text and let
the user click (or pick from a menu) to commit it. Cheap to implement
and orthogonal to A/B/C. Whether it ever fires depends on the BMC
emitting ServerCutText — that's probe 2 above.

## Recommendation (post-probe)

Ship Option C as v0.1.0. ~200 lines. Scope out host→browser entirely
for v0.1 — it's not implementable on this stack without OCR.

Option A/B/D are kept in this document for future reference: if a
later BMC firmware or board revision wires an in-guest clipboard
agent, A/D become trivially viable additions and we'd want to
runtime-feature-detect rather than rip C out.

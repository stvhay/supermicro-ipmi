# 03 — why paste is broken

The reason clipboard is dead in the iKVM HTML5 console is **not** that
the protocol doesn't support it, and **not** that the browser blocks
it. It's that Supermicro/Insyde stripped the UI layer that connects
the two. The RFB plumbing is intact and reachable from a userscript.

## Three independent failures, all in the UI layer

All three directions of the standard noVNC clipboard story are broken,
and each fails at a different point:

### Failure 1 — host → browser: callback never wired

`rfb.js`:

- `_handle_server_cut_text` (the RFB ServerCutText handler, msg type
  3) is fully implemented: it reads the length-prefixed payload and
  calls `this._onClipboard(this, text)`.
- `onClipboard` is declared as a configurable callback (`Util.set_defaults`
  line 6), with the default value being a no-op `function(){}`.

`nav_ui.js`:

- Greps for `onClipboard`, `set_onClipboard`, `clipboard`, `paste`,
  `Cut`, etc. all return zero matches.
- The `new RFB({...})` call passes `onUpdateState`,
  `onPasswordRequired`, `onFBUComplete`, `onFBUReceive`,
  `onMouseMode`, `onDesktopName`, `onMessage` and others — but
  **`onClipboard` is omitted**, leaving the no-op default in place.

Net effect: when the guest OS sends ServerCutText, the bytes are
parsed correctly and then dropped on the floor.

### Failure 2 — browser → host: no caller for `clipboardPasteFrom`

`rfb.js` exposes `clipboardPasteFrom(text)`:

```js
clipboardPasteFrom: function (text) {
    if (this._rfb_state !== "normal") return;
    this._sock.send(RFB.messages.clientCutText(text));
}
```

and the wire-format builder `RFB.messages.clientCutText` (RFB msg
type 6, length-prefixed payload, *not* Insyde-modified — only
`pointerEventInsyde` is overridden).

But `nav_ui.js` never calls `clipboardPasteFrom`, no DOM element
binds a `paste` handler that calls it, and there is no menu item or
shortcut anywhere that would. The UI is the only thing missing.

### Failure 3 — DOM has nowhere for paste to land

Stock noVNC drops a hidden `<textarea id="keyboardinput">` in the DOM
to receive touch-keyboard input on iPads and to capture browser-level
paste events. The Supermicro/Insyde build has no such textarea — see
`research/captures/ikvm-popup/html/man_ikvm_html5_bootstrap.html`. The
canvas alone can't natively receive `paste` events (it isn't a
contenteditable or input element).

On top of that, `keyboard.js`'s `process()` calls `preventDefault()`
on any `keydown` where Ctrl or Alt is held (see 02-input-path.md).
Even if a paste handler existed, Ctrl+V would never fire it from the
canvas — Ctrl+V is consumed by the keysym pipeline and forwarded to
the BMC as a literal Ctrl+V keystroke (which the host OS may or may
not interpret as paste, in whatever app is foregrounded).

## What is *not* broken

- **CSP does not block clipboard.** The site's CSP is `default-src
  'self'; connect-src 'self'`, with `script-src 'self' 'unsafe-inline'
  'unsafe-eval'`. There is no `clipboard-read` / `clipboard-write`
  Permissions-Policy restriction in the headers. A userscript reading
  `navigator.clipboard.readText()` will face the standard browser
  user-gesture / permission prompt, nothing more.
- **HTTPS/HTTP context.** Both endpoints (`http://10.64.38.8` and
  `https://10.64.38.8`) are exposed; the dashboard 301-redirects to
  HTTPS. `navigator.clipboard` requires a secure context, but HTTPS is
  available, so this isn't a blocker either.
- **The WebSocket and RFB session are healthy.** A captured 101
  upgrade and a working session prove the channel is up; messages 4
  (KeyEvent), 5 (PointerEvent), and the framebuffer updates all flow.
  Adding message 6 (ClientCutText) costs nothing extra on the wire.

## Empirical: the BMC drops clipboard in both directions

Two runtime probes were run on the test BMC (`10.64.38.8`, RFB state
`"normal"`, iKVM session active):

1. `UI.rfb.clipboardPasteFrom("PROBE_HOST\n")` with focus on a host
   shell prompt → **no characters appeared on the host.**
2. `UI.rfb.set_onClipboard((rfb, text) => console.log(text))` →
   copying text inside the guest OS produced **no callback.**

**This is what theory predicts** for hardware KVM-over-IP. The BMC
chip pretends to be a USB HID keyboard/mouse toward the motherboard;
there is no VNC server running inside the guest OS to (a) write
incoming clipboard bytes into the guest's clipboard, or (b) watch
the guest's clipboard for outgoing changes. Standard VNC clipboard
works because a cooperating in-guest server (RealVNC, x11vnc, …)
bridges that gap, and a BMC has no such helper.

**Consequence for the fix:** the RFB clipboard channel is unusable on
this stack. Browser→host paste must be implemented as type-as-
keystrokes (Option C in 04-fix-options.md). Host→browser copy is not
recoverable at the protocol layer — the only theoretical path would
be OCR of the framebuffer, which is a non-starter for v0.1.

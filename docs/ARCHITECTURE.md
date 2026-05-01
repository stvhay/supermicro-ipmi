# Architecture

## What this project ships

`supermicro-ipmi` ships userscripts (Tampermonkey / Violentmonkey /
Greasemonkey) that patch the Supermicro IPMI web UI in-page. Each
userscript is a single hand-written `.user.js` file under
`userscripts/`, with no build step. Scripts attach to specific IPMI
pages via narrow `@match` patterns and `@grant none` (no privileged
GM APIs).

The userscripts run in the page's normal JavaScript context, with the
same authority as the IPMI page's own scripts. This means they can
directly call into the page's globals — most importantly the noVNC
client.

## The iKVM/HTML5 console

The console most userscripts target is reachable via
`https://<bmc>/cgi/url_redirect.cgi?url_name=man_ikvm_html5_bootstrap`
(also `..._auto`). It is a fork of **noVNC** (circa 2014–2015) with
Aspeed-AST chip-specific video decoding and Supermicro/Insyde
extensions for power, virtual media, and macros.

The `Util.load_scripts(...)` block in the bootstrap HTML loads:

| File | Role |
|---|---|
| `rfb.js` | RFB protocol client; instantiated as `UI.rfb` |
| `display.js` | Canvas rendering |
| `websock.js` | WebSocket transport (binary + base64 fallback) |
| `keyboard.js`, `input.js` | DOM keyboard/mouse capture |
| `keysym.js`, `keysymdef.js` | Keysym tables and char→keysym lookup |
| `ast2100.js` | Aspeed AST framebuffer decoder |
| `nav_ui.js` | The `UI` controller; wires DOM controls to `UI.rfb` |
| `keymacros.js` | Macro definitions |
| `vmlib.js`, `*handler.js`, `mfapi.js`, `vstorage.js` | Virtual media |
| `lang.js` | i18n strings |

Plus Supermicro-specific helpers under `/js/`: `virtualkeyboard.js`,
`screenshot.js`, `RecordRTC.js`, `shortcut.js`.

## RFB instance

`UI.rfb` is the global RFB instance. Userscripts interact with the
console through this object:

- `UI.rfb._rfb_state` — `"normal"` once handshake completes.
- `UI.rfb._sock.send(bytes)` — push bytes onto the WebSocket.
- `RFB.messages.{keyEvent, pointerEvent, pointerEventInsyde,
  clientCutText, ...}` — wire-format builders.
- `UI.rfb.set_onClipboard(fn)` — subscribe to `ServerCutText` (works
  at the protocol level; see "Clipboard" below for the catch).
- `UI.rfb._SMC_*` — Supermicro extensions (power, mouse mode, video
  quality, hotplug).
- `UI.rfb.sendMacro`, `sendKeyHold`, `sendCtrlAltDel` — macro APIs.

The `pointerEvent` and `keyEvent` messages have an Insyde-specific
trailing 9-byte zero padding, which the page's `RFB.messages.keyEvent`
builder handles correctly. **Reuse the builder rather than
reimplementing it**, to stay compatible across firmware variants.

## Wire transport

WebSocket upgrade at `wss://<bmc>/` (root path), HTTP 101. Subprotocol
negotiation is `binary, base64`. Out-of-band configuration (port info,
power actions, mouse mode) flows over XML POSTs to `/cgi/ipmi.cgi`.

## Clipboard

The standard noVNC RFB clipboard is *intact in code* but
*non-functional in practice* on hardware KVM-over-IP. See
`research/notes/03-clipboard-gap.md` for the empirical findings (both
`ClientCutText` and `ServerCutText` were probed and confirmed no-ops
on the test BMC). The first userscript (`ikvm-paste`) routes around
this by typing characters as synthesized `KeyEvent` messages instead.

## Userscript attachment pattern

Userscripts targeting the iKVM console follow this lifecycle:

1. `@run-at document-end` runs the script after the popup HTML is
   parsed but before the noVNC modules finish loading.
2. Poll for `window.UI?.rfb?._rfb_state === "normal"` (250ms interval,
   30s timeout) before doing anything that touches RFB state.
3. Install UI (navbar additions, hotkeys) once `UI.rfb` is ready.
4. Bind hotkeys at capture phase on `document` to win against noVNC's
   `Keyboard.grab()` listeners (which are bubble-phase).

## Further reading

- `research/notes/02-input-path.md` — how DOM keyboard events become
  RFB `KeyEvent` messages on the wire.
- `research/notes/03-clipboard-gap.md` — empirical clipboard findings.
- `research/notes/04-fix-options.md` — implementation alternatives for
  the clipboard fix.

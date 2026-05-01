# 01 — iKVM HTML5 client architecture

Captured from `research/captures/ikvm-popup.har` (98 entries) and the JS
sources extracted to `research/captures/ikvm-popup/`. Test BMC was an
Insyde-firmware Supermicro board served at `https://10.64.38.8/`.

## TL;DR

The iKVM HTML5 console is a fork of **noVNC** with Aspeed-AST-specific
video decoding and Supermicro/Insyde extensions. The standard noVNC
RFB clipboard plumbing (`clipboardPasteFrom`, `clientCutText`,
`_handle_server_cut_text`, `onClipboard`) is preserved unchanged in
`rfb.js`. The clipboard UI layer was simply removed: the navbar has no
clipboard menu, no paste handler is bound anywhere in the DOM, and
`set_onClipboard()` is never called.

## Entry point and bootstrap

The console opens via `window.open()` with target
`/cgi/url_redirect.cgi?url_name=man_ikvm_html5_bootstrap` (see the
dashboard page `man_ikvm_html5` for the JS that performs the open).
The bootstrap page itself is a single static HTML document that:

1. Loads CSS (Bootstrap 3, jQuery UI, virtualkeyboard.css).
2. Loads jQuery 1.11, jQuery UI, Bootstrap, and an inline noVNC
   `Util.load_scripts([...])` call that serially loads the noVNC
   modules.
3. Renders a navbar of dropdowns: Virtual Keyboard, Virtual Media,
   Record, Macro, Options, User List, Capture, Power Control, Help.
   **There is no Clipboard or Copy/Paste menu.**
4. Hosts a single `<canvas id="noVNC_canvas" class="keyboardInput">`
   inside `#noVNC_container`.
5. Provides modal markup for User List, Virtual Media, Hotkey
   Settings, Preferences, etc.

## JS module layout

`/novnc/include/` carries a 2014–2015-vintage noVNC fork:

| File | Role |
|---|---|
| `rfb.js` | RFB protocol client; instantiated as `UI.rfb` |
| `display.js` | Canvas rendering |
| `websock.js` | WebSocket transport (binary + base64 fallback) |
| `keyboard.js` | DOM keyboard event capture, modifier tracking |
| `input.js` | Mouse + keyboard glue to RFB |
| `keysym.js`, `keysymdef.js` | Keysym tables and key-name → keysym lookup |
| `ast2100.js` | Aspeed AST chip-specific framebuffer decoder |
| `jsunzip.js` | Used by AST2100 decoder |
| `base64.js`, `des.js` | Auth and base64 transport |
| `nav_ui.js` | The `UI` controller — wires DOM controls to `UI.rfb` |
| `keymacros.js` | Macro definitions (Ctrl-Alt-Del, Alt-Tab, …) |
| `vmlib.js`, `imghandler.js`, `isohandler.js`, `folderhandler.js`, `imahandler.js`, `mfapi.js`, `vstorage.js` | Virtual media (ISO/IMG/folder mount, MFAPI, virtual storage) |
| `lang.js` | i18n strings |

`/js/` holds Supermicro-specific helpers: `virtualkeyboard.js`,
`screenshot.js`, `RecordRTC.js` (browser-side video recording),
`shortcut.js` (hotkey binding library), and the legacy stack used by
the dashboard (`prototype.js`, `utils.js`).

## Wire protocol

- **WebSocket upgrade:** `wss://10.64.38.8/` (root path), HTTP 101.
  Subprotocol negotiation lists `binary, base64`.
- **RFB messages** are constructed via `RFB.messages.{keyEvent,
  pointerEvent, pointerEventInsyde, clientCutText, …}` in
  `novnc/rfb.js`. `pointerEvent` has an Insyde-customized variant
  (`pointerEventInsyde`) — this is the only Insyde-specific wire-format
  override identified. `clientCutText` (msg type 6) is unmodified
  standard RFB.
- **Out-of-band signalling** (port info, power, mouse mode, KMHotPlug,
  GETPORTSINFO) goes through XML POST to `/cgi/ipmi.cgi`, the same
  endpoint the dashboard uses.

## Connection sequence

1. Bootstrap page loads → `nav_ui.js` parses URL query vars.
2. `UI.start` → `UI.connect` → POST `op=GETPORTSINFO.XML` to
   `/cgi/ipmi.cgi` → host/port/encrypt parameters returned in XML.
3. `UI.initRFB(encrypt)` constructs `UI.rfb = new RFB({target:
   noVNC_canvas, encrypt, repeaterID, true_color, local_cursor, …,
   onUpdateState, onPasswordRequired, onFBUComplete, onFBUReceive,
   onDesktopName, onMouseMode, onMessage, …})`. **`onClipboard` is
   *not* set** — the no-op default in `rfb.js` is left in place.
4. `UI.rfb.connect(host, port, username, password, path)` opens the WS
   and runs the RFB handshake.

## Supermicro/Insyde additions on the RFB instance

`nav_ui.js` calls these methods on `UI.rfb` — they exist in `rfb.js`
but aren't part of stock noVNC:

- `_SMC_PowerAction(action)` — power on/off/shutdown/reset
- `_SMC_KMHotPlug()` — keyboard/mouse hotplug
- `_SMC_FBUpdateReq()` — force a framebuffer refresh
- `_SMC_SetVideoQuality(level)`, `_ast2100QualityLevel`
- `_SMC_GetMouseMode()`, `_SMC_SetMouseMode(crypto, mode)`,
  `_SMC_MouseSync()`
- `_SMC_SetQos(outgo, …)` — bandwidth shaping
- `sendMacro(arr)`, `sendKeyHold(arr, hold)`, `sendCtrlAltDel()`

There is **no** SMC-prefixed clipboard / copy / paste / cut method
anywhere in `rfb.js` or `nav_ui.js`.

## What the console does *not* have

- No clipboard menu or button anywhere in the navbar
- No paste / clipboard / copy / cut listener bound to any DOM element
  in `keyboard.js`, `input.js`, `nav_ui.js`, or `shortcut.js`
- No hidden `<textarea id="keyboardinput">` (the standard noVNC
  paste-target textarea); the only thing on the canvas is the canvas
  itself, which can't natively receive `paste` events
- No call to `UI.rfb.set_onClipboard(…)`, so server-cut-text from the
  guest is silently dropped

# 02 — keyboard input path

How a key press in the browser becomes an RFB `KeyEvent` on the wire.
This is the path a userscript could intercept, but as it turns out the
existing path leaves clipboard events unhandled at the *DOM* level —
making the userscript fix simpler than it would be if we had to fight
existing handlers.

## Construction

`UI.rfb = new RFB({target: noVNC_canvas, …})` (from `nav_ui.js`).
Inside `rfb.js`:

```js
this._keyboard = new Keyboard({
    target: this._focusContainer,            // defaults to document
    onKeyPress: this._handleKeyPress.bind(this)
});
this._mouse = new Mouse({target: this._target, …});
```

`focusContainer` is **not** overridden by `nav_ui.js`, so the keyboard
listeners are attached to `document` — meaning the iKVM captures keys
window-wide, not just over the canvas.

## DOM listeners

`Keyboard.grab()` in `novnc/input.js` (lines ~108–120):

```js
Util.addEvent(c, 'keydown',  this._eventHandlers.keydown);
Util.addEvent(c, 'keyup',    this._eventHandlers.keyup);
Util.addEvent(c, 'keypress', this._eventHandlers.keypress);
Util.addEvent(window, 'blur', this._eventHandlers.blur);
```

That is the **complete list of input listeners** the iKVM client
attaches. Three on `document` (keydown / keyup / keypress) and one on
`window` (blur, used to release held keys when focus is lost).
No `paste`, no `copy`, no `cut`, no `input`, no `compositionstart` —
nothing in the clipboard family.

## Translation pipeline (keydown → wire)

In `keyboard.js`:

1. `keydown` handler calls `modifierState.keydown(evt)` then
   `process(evt, 'keydown')`.
2. `process` calls `kbdUtil.translateModifiers(evt)` and, depending on
   browser/event quirks, either translates immediately or stalls until
   a matching `keypress` arrives.
3. The keysym is looked up via `keysyms.lookup(...)` against the
   tables in `keysym.js` / `keysymdef.js`.
4. `process` decides whether to `preventDefault()` the event:
   ```js
   suppress = !isShift && (
       type !== 'keydown'
       || modifierState.hasShortcutModifier()    // Ctrl or Alt held
       || !!kbdUtil.nonCharacterKey(evt)
   );
   ```
   When Ctrl or Alt is held, **the keydown is `preventDefault`'d**.
   This is significant for clipboard: it kills the browser's
   default `Ctrl+V` handling before any paste-target could see it.
5. The translated `(keysym, down)` pair is delivered through
   `onKeyPress` to RFB's `_handleKeyPress`, which calls
   `RFB.messages.keyEvent(keysym, down)` and sends the bytes via
   `_sock.send`.

## Wire format

RFB `KeyEvent`, message type 4 (standard, not Insyde-modified). From
`rfb.js`:

```
[4]                 // msg type
push8(down)         // 1 = press, 0 = release
push16(0)           // padding
push32(keysym)
push8 * 9 (zeros)   // Insyde appears to pad the message; stock RFB
                    // doesn't have these trailing bytes
```

The trailing 9 zero bytes are an Insyde extension to the keyEvent
message. (The pointer event has the same Insyde padding pattern in
`pointerEventInsyde`.) This doesn't affect clipboard work but is
worth knowing if anyone ever adds a custom RFB extension.

## Mouse, for completeness

`Mouse.grab()` in `input.js` attaches `mousedown`, `mouseup`,
`mousemove`, `click`, `dblclick`, `contextmenu`, `mousewheel` /
`DOMMouseScroll` to its target (the canvas). Pointer events use
`RFB.messages.pointerEventInsyde` (msg type 5 with 11-byte padding).

## What this means for clipboard work

- **No DOM-level paste handling exists.** The canvas doesn't natively
  receive `paste` events (it's not contenteditable). No textarea is
  hidden behind it. So a userscript can add its own `paste` listener
  on `document` (or on a hidden textarea it inserts) without colliding
  with anything.
- **Ctrl+V is consumed by the keysym pipeline and `preventDefault`'d**
  before any browser default could fire. A userscript that wants to
  trigger paste from a keyboard shortcut should either pick a
  different chord (e.g. Ctrl+Shift+V), or hook in *before* the
  keyboard.js handler — the userscript-manager `@run-at
  document-start` plus capture-phase listener gets in front of the
  noVNC `addEventListener` calls.
- **The RFB keyboard pipeline does not read or expose `event.key`** —
  it works off `keyCode`, `charCode`, and the keysym tables. So a
  paste-emulation-as-keystrokes implementation would need to map each
  character to a keysym and synthesize keydown/keyup pairs (or pump
  `RFB.messages.keyEvent(keysym, …)` directly via `UI.rfb._sock.send`).

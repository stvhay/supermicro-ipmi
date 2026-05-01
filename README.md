# supermicro-ipmi

> In the context of the Supermicro IPMI web UI's many rough edges,
> facing the loss of basic clipboard functionality in the iKVM/HTML5
> console, this project ships userscripts (Tampermonkey / Violentmonkey
> / Greasemonkey) that patch them in-page, accepting that fixes are
> firmware-shaped and must be feature-detected per BMC.

## Status

Pre-1.0. The first script (clipboard → host paste) is in active
development on issue #2.

## Userscripts

| Script | Status | Description |
|---|---|---|
| `userscripts/ikvm-paste.user.js` | wip (issue #2) | Type the browser clipboard's text into the iKVM/HTML5 console as keystrokes. Browser → host only; US-ANSI only in v0.1. |

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Firefox or
   Chrome) or Violentmonkey.
2. Open the raw `.user.js` file from this repo —
   `https://raw.githubusercontent.com/stvhay/supermicro-ipmi/main/userscripts/<file>.user.js`.
3. The userscript manager prompts to install. Confirm.
4. Open the IPMI iKVM/HTML5 popup. The script's UI (per script — see
   the file's header) is now active.

`@grant none` everywhere — these scripts use no privileged GM APIs,
so they run with the same authority as the IPMI page's own JavaScript.

## Compatibility

- **BMCs:** Supermicro X9–X13 era (AST2400 / AST2500 / AST2600).
  Firmware varies; tested-against firmware is recorded in PRs.
- **Browsers:** Firefox + Chrome (latest stable). Safari userscript
  support is weaker and not a primary target.
- **Userscript managers:** Tampermonkey (primary), Violentmonkey,
  Greasemonkey 4.x.

## Known limitations (v0.1)

- Clipboard is browser → host only. Host → browser would require
  OCR'ing the framebuffer (no in-guest VNC clipboard agent on
  hardware KVM-over-IP) and is out of scope.
- `ikvm-paste` assumes the host is using a US-ANSI keyboard layout.
  Characters not on that layout abort the paste with a toast.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project conventions
(metadata template, manual-test workflow, feature-detect vs
firmware-version-check) live in [CLAUDE.md](CLAUDE.md).

## License

[AGPL-3.0](LICENSE) — same license as upstream noVNC, which the
iKVM/HTML5 console is forked from.

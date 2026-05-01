# supermicro-ipmi

A userscript (Greasemonkey / Tampermonkey / Violentmonkey) that fixes the
worst parts of the Supermicro IPMI web UI — starting with making copy
and paste work, and growing from there.

## Repo layout

```
userscripts/        Userscripts (one .user.js per script)
scripts/            Helper shell/Python scripts
.github/            Issue + PR templates
flake.nix           Nix devshell (uv, python313, ruff)
.envrc              direnv loader; sources .envrc.d/ then .envrc.local.d/
```

There is no build step at present. Userscripts are hand-written `.user.js`
files installed directly via the user's userscript manager.

## Userscript conventions

- One file per script under `userscripts/`, named `*.user.js`.
- Standard userscript metadata block at the top:
  ```
  // ==UserScript==
  // @name         supermicro-ipmi: <feature>
  // @namespace    https://github.com/<owner>/supermicro-ipmi
  // @version      0.1.0
  // @description  <one line>
  // @match        https://*/cgi/*
  // @match        https://*/cgi-bin/*
  // @run-at       document-end
  // @grant        none
  // ==/UserScript==
  ```
- Bump `@version` when behavior changes — userscript managers use it for
  update detection.
- Keep `@grant none` unless a feature genuinely needs a GM API. The fewer
  privileges the script asks for, the less friction at install time.
- Prefer narrow `@match` patterns. The IPMI UI lives under `/cgi/` (login,
  most legacy pages) and `/cgi-bin/` on newer firmware.

## Target platform

- Supermicro BMCs: AST2400 / AST2500 / AST2600 (X9 through X13 era boards).
- Firmware varies wildly — same motherboard line may ship multiple BMC UIs.
  Note tested firmware in PRs and bug reports.
- Browsers: Firefox + Chrome (latest stable). Safari userscript support is
  weaker; not a primary target.
- Userscript managers: Tampermonkey (primary), Violentmonkey, Greasemonkey 4.x.

## Testing

There is no automated test harness. Verification is manual:

1. Install the script in your userscript manager.
2. Load the affected IPMI page on a real BMC.
3. Exercise the workflow the script is supposed to fix.
4. Note the firmware version + browser/manager combo in the PR.

If a fix is firmware-specific, guard it with a feature-detect (DOM probe,
URL pattern) rather than a firmware-version string check — the version
strings are inconsistent across boards.

## Dev environment

`direnv allow` once on entry. The flake provides `uv`, `python313`, and
`ruff` for any tooling that shows up later, plus `openvpn`, `websocat`,
`js-beautify`, and `html-tidy` for talking to BMCs and inspecting their
JS bundles. There is no Python code in the project today.

## First feature: copy/paste in the iKVM/console

The flagship pain point: the IPMI HTML5 console swallows clipboard events,
so you can't paste a password or copy log output out.

Research (see `research/notes/`) established that the iKVM HTML5 console
is a noVNC fork; the RFB clipboard plumbing is intact in `rfb.js` but
never wired up by the UI. **However**, the BMC drops `ClientCutText` and
never emits `ServerCutText` (probed) — hardware KVM-over-IP has no
in-guest VNC clipboard agent, so the RFB clipboard channel can't be used.

The first userscript (`ikvm-paste`, issue #2) is therefore browser → host
only, implemented as type-as-keystrokes via synthesized RFB `KeyEvent`
messages. Host → browser is out of scope without framebuffer OCR.

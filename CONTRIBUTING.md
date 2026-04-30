# Contributing

## Workflow

Every change follows this process:

### 1. File a GitHub issue

Describe the IPMI pain point and proposed fix. Use the feature request or bug report template.

### 2. Create a branch

Create a feature branch for your work. Use `/using-git-worktrees` for an isolated worktree, or branch manually.

### 3. Brainstorm the design

Run `/brainstorming` to explore the problem space before writing code. For userscript work, this usually means inspecting the IPMI page DOM, identifying the right injection point, and deciding whether to patch existing handlers or replace UI elements outright.

### 4. Write an implementation plan

Run `/writing-plans` to produce a structured implementation plan.

### 5. Execute the plan

Run `/executing-plans` to implement with checkpoints between tasks.

### 6. Verify on a real device

Userscripts that work on a stub HTML page can still break on a real IPMI BMC. Load the script via Tampermonkey/Greasemonkey against an actual Supermicro IPMI and exercise the affected workflow before claiming done.

### 7. Self-review

Run `/requesting-code-review` to check your work against the plan.

### 8. Open a pull request

Use the PR template. Include the BMC firmware / motherboard / browser combo you tested against, and bump `@version` in the userscript header if behavior changed.

## Code of Conduct

Be kind, be constructive, assume good intent.

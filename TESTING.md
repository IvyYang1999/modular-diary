# Modular Diary experience contracts

`npm run verify` is the only merge/deploy gate. A green unit suite alone is
not a releasable result: the command also runs the rendered timeline, agent,
API, drawing, grid and mounted-component contracts before producing `main.js`.

## Contract layers

- `src/**/*.test.ts`: pure data, ownership, lifecycle and source-write rules.
- `e2e/draw-smoke.mjs`: timeline gestures and focus/edit contracts.
- `e2e/grid-smoke.mjs`: fixed chrome, hit targets and component geometry.
- `e2e/mount-smoke.mjs`: shared design tokens, nested scrolling, text-save and
  responsive mounted-component contracts.
- Real Obsidian review: CodeMirror/MarkdownPostProcessor, multi-pane ownership,
  plugin reload and theme cascade. This remains a required local release step
  until Obsidian provides a distributable CI runtime.

## Rules for regressions

1. Name the user-visible invariant before editing production code.
2. Add a test that fails for the reported behavior.
3. Fix the owning state/layer/lifecycle rule, not the screenshot symptom.
4. Run the affected contract while iterating, then freeze the candidate and run
   `npm run verify` once.
5. For visual behavior, assert relationships (same height/token/inset and
   correct z-order/hit target) and inspect the generated light/dark screenshots.

The CI workflow runs the same command on every push and pull request. It does
not claim to emulate the proprietary Obsidian desktop lifecycle; production
smoke findings must therefore be turned into the closest deterministic contract
and recorded here when a true application-level harness becomes available.

## Save recovery regression

`e2e/save-recovery-smoke.mjs` exercises the production plugin write methods
against an in-memory editor/vault, including lost sections, initially invalid
block ordinals, block insertion/deletion and failed persistence acknowledgements.
Its Chromium fixture checks draft retention across disposal/remount, suppressed
automatic retries, explicit retry, external popover redraw ownership and viewport
edges. These are host-adapter contracts, not proof of a live Obsidian reload.

The source locator verifies the captured block content and rejects ambiguous or
changed fallback targets; it never treats code examples as writable timelines.
After a save failure, the draft remains editable and the local Retry control (or
Enter for notes, Cmd/Ctrl+Enter for text) starts a new attempt. Window events do
not restart a failed attempt.

On macOS with Obsidian installed, `node e2e/obsidian-recovery-native.mjs`
launches a separate profile and synthetic vault with the built plugin. It checks
Live Preview note editing during a background refresh, note and text persistence
in the real vault file, and rendering after a normal App reload. It never opens
or reloads the user's existing vault, and does not toggle plugin enablement.

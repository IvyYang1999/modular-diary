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

On macOS with Obsidian installed, `node e2e/obsidian-recovery-native.mjs --allow-foreground`
launches a separate profile and synthetic vault with the built plugin. It checks
Live Preview note editing during a background refresh, note and text persistence
in the real vault file, and rendering after a normal App reload. It never opens
or reloads the user's existing vault, and does not toggle plugin enablement.

## Editor save interleavings

`e2e/save-recovery-smoke.mjs` invokes the production plugin methods in source
and reading modes. Its matrix crosses six real source changes (outer size,
layout, Todo completion, timer endpoint, timeline note, another text slot) with
three orderings (action first, text first, parallel). It also checks separate
fences in one note, shifted line ranges, persistence in flight with newer typing
and resize, and twelve same-file conflicts producing one warning while keeping
the draft. `--writes-only` runs just these host-adapter contracts locally;
`npm run verify` always includes the browser layer.

`src/edit/source-revisions.test.ts` checks content-anchored lineage, isolation
between files/panes, duplicates, removed slots, quoted empty slots and external
non-overlapping changes. Scoped saves compare the draft's original text rather
than the entire block and retain that baseline across redraws. Structural
ambiguity fails closed: replacement/removal and ambiguous duplicates are never
selected by an ordinal alone. Local lineage retains at most 128 applied changes
per pane/file; very old detached renderers may need manual reconciliation.
Simultaneous external edits to both the non-text portion and other text slots
can remove every independent content anchor and are conservatively rejected.

CI publishes synthetic browser screenshots as `save-recovery-visuals`. They
are host-adapter evidence, not a native Obsidian acceptance claim. The optional
native gate now checks real resize plus two text saves and requires explicitly
scheduled foreground permission before it creates a profile or opens a window.
It never installs into or touches the active Vault.

## Todo batch contracts

`e2e/todo-batch-smoke.mjs` uses the production Todo renderer/parser/rewriter with
synthetic disk-backed source. It checks note preload, title-only preservation,
draft remount, note/attribute clears, sorting/source agreement, ordinary completion,
half-completion, narrow dark/light layout and a transfer to tomorrow. The transfer
calls the production plugin methods through the same disk-backed Obsidian host
adapter exercised by `e2e/todo-postpone-host.mjs`; that gate covers duplicate
invocations, persisted copy acknowledgement, retries and conflicting/unsaved data.
CI uploads the synthetic images as `todo-batch-visuals`. This does not prove a
native Obsidian reload or installation in the active Vault.

The Todo postponement host also verifies the enabled core Daily Notes options with real Moment formatting: a source in `daily/` transfers to `Journal/YYYY/MM/日记 DD.md`, creates missing subfolders, appends to an existing custom-named note, and rejects disabled/unavailable settings, folder collisions, failed folder creation, unsafe paths, same-note targets and settings changes after the menu displayed its destination. The UI adapter displays the production-resolved destination and captures `todo-daily-notes-destination.png`; it does not prove the native Obsidian Menu or core plugin itself is loaded.

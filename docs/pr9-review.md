# PR #9 requirement review

DCC batch `701346d4-380f-4961-b4f2-60e9aac0c7cc`, work item
`65315826-670b-4620-8cd2-48689401c8ce`. Reviewed main `e1bf1ce`, including
PR #9 (`424c437`) and the Daily Notes follow-up PR #10. The original automated
review recorded no specific findings; these are independently reproduced
violations, not a claim to have recovered its missing rationale.

## Frozen acceptance envelope

Deliver one branch and one PR repairing reproducible explicit violations. Keep
existing styles, colors, controls and layout. No merge, release, live Vault writes,
unrelated features or Daily Notes reimplementation. Block only explicit acceptance
violations, existing regression failures, data loss/corruption, privacy leaks,
incorrect/unauthorized writes, core unavailability or unbounded work.

| Original requirement | Current must-deliver / implementation owner | Evidence |
| --- | --- | --- |
| `b7cad0ba` notes | Preload notes; title-only save/reopen retains the exact note source; parser, rewriter, form and drafts | Red source tests on base; repaired token/clear/escaping tests; file-backed renderer save/reopen/remount and CR/CRLF cases |
| `cc953c9f` half-completion | Distinct existing-style half-fill, ordinary click unchanged, `- [/]`, postpone to configured tomorrow | Existing Todo UI and production-plugin disk Vault tests, including target/source files, copy failures and duplicates; main's actual menu/toggle callbacks inspected |
| `387cd4e6` attributes | Set/change/clear difficulty and custom tiers, quiet text, source-readable attributes, derived sort/manual restore, unchanged old defaults | Existing source, settings, menu and Todo UI contracts; different start/target orders and persisted view/source checks |

## Two violated behaviors and their causes

1. **The source writer can corrupt an untouched note or change its token.**
   For a task with `title="检查 note=" note="真实备注"`, title-only editing on
   the reviewed main saves the note as `" note="`. Its whole-line regex mistakes
   the end of the title for a note field. Accepted unquoted `note=备注` is also
   re-quoted, and `note=""` is dropped. All violate the explicit promise that
   the untouched note source remains identical. Reuse the existing readable-field
   scanner to extract the actual token, then pass that token directly to the
   formatter. There is no regex search/replacement within arbitrary quoted text.
2. **The form silently changes authored note line endings.**
   A note containing JSON `\r\n` or `\r` displays LF in a browser textarea.
   The old form submits that normalized value, including through its draft path,
   so changing only the title rewrites the note source to `\n`. Keep the original
   note alongside its displayed value; when the display is unchanged, submit the
   original. Actual note edits and clearing still submit the edited value.

Both findings violate `b7cad0ba`'s exact-source acceptance condition. Review did
not find another explicit violation in half-completion or attributes. Daily Notes
directory/naming was already fixed on main by PR #10 following the user's decision.

## Verification and closure

First regression candidate `b698a6a` fails three new source cases locally and in
CI. The final candidate retains those tests and adds field-position/clear coverage
and browser CR/CRLF title-only save, draft remount, reopen and intentional-edit
checks. Targeted typecheck, source tests and the real plugin's synthetic disk Vault
postponement adapter precede candidate freeze. Run the unchanged complete
`npm run verify` gate on the frozen candidate in CI, inspect that candidate's
light/dark screenshots, verify remote HEAD/checks, register batch review and finish
the work item. User owns acceptance and merge.

Local headless Chromium cannot start under this Mac sandbox (Mach-port permission
denied); use CI's background browser gate without retrying local launch or taking
foreground focus. Synthetic renderer/file adapters do not prove native Obsidian
menus, themes, reload or active Vault deployment. Plugin version stays 0.2.0; this
is a built PR candidate, not an installed/released product. Those native steps
remain for the user's isolated Vault acceptance; no real Vault data is touched.

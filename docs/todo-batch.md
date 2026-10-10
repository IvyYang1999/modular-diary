# Todo batch acceptance envelope

Batch: `7c034caf-6530-4e75-9f68-cfc139e33d86`. One branch and one PR; no merge or release.

Must deliver:

| Requirement | Source contract / owner | Regression evidence |
| --- | --- | --- |
| Re-edit notes without loss | `note` JSON string; parser, form drafts, plugin callbacks and `updateTodo` | Source escaping/no-op tests and file-backed UI title-only save/reopen/remount |
| Half-completion and tomorrow | Markdown `- [/] todo: …`; parser, menu and plugin copy-first transfer | Status toggle UI; real plugin disk-backed host transfer, failure, stale-source, unsaved-target and duplicate-invocation guards |
| Difficulty / custom priority / sort | Optional `difficulty=1..5`, `priority="tier"`, `todo-view`; core, settings and renderer | Invalid values, clears, stable sorts, settings editing and source/manual-order assertions |

Existing `todo:` readable and pipe headers continue to parse. New/changed rows use `- [ ]`, `- [/]` or `- [x]` followed by `todo:` and readable key/value fields. The checkbox is authoritative; there is no second completion field in new rows. A no-op edit returns the original source; title changes retain the original note token, including its JSON escapes. Manual reordering moves authored rows rather than reserializing them.

Difficulty sorts highest first. Priority sorts by the configured list, highest first; unset or retired values follow configured values, preserving ties. Tier removal/renaming leaves existing source values intact. Optional fields do not add row metadata when unset.

Tomorrow uses the enabled Obsidian Daily Notes plugin's folder and Moment filename format, based on the block date (not the wall clock). Empty settings use Daily Notes defaults: Vault root and `YYYY-MM-DD`. Missing configured subfolders are created through the Vault API. Missing/disabled Daily Notes, unavailable settings, unsafe paths and folder/file collisions fail closed; no source-directory fallback. The user's decision supersedes the original same-directory default. The menu shows the full destination before activation. An existing date-matching Timeline receives the item; otherwise an additional dated Timeline is appended. Multiple matching Timelines, conflicting IDs, invalid target source, and unsaved target editors are rejected. Copy acknowledgement precedes source removal. Original time entries/bindings are retained. A crash or source conflict after copying can leave two copies; explicit retry deduplicates the same unchanged task and never silently overwrites changed content.

Out of scope: background inspiration items, parent/subtask redesign, attachments, AI review, future schedules, new colors, merge/release, live Vault writes.

Blocking categories: data loss/corruption, private data exposure, wrong/unauthorized writes, core startup failure, unbounded work, explicit envelope violations or existing regression failures. Future enhancements are follow-ups.

Mechanical closure: targeted tests while changing; immutable candidate review; full `npm run verify` in CI; inspect synthetic screenshots; confirm exact remote HEAD/CI and register the PR as review in DCC; `work.finish` on each item. Acceptance and merge remain the user's.

This cohesive plugin batch touches parser/source, UI/settings and regression CI. It stays together because one source model crosses these layers; no separate service/database is introduced. This is the explicit exception to splitting three-layer packages.

Known limits: CI screenshots and disk-backed host adapters do not prove native Obsidian focus, reload or active Vault deployment. Local headless Chromium is unavailable under the current macOS Mach-port sandbox; the existing full gate runs on CI. The plugin version remains 0.2.0, and the candidate is not installed into the active Vault. Priority tier rename does not migrate historic values. Postponement is copy-first rather than a multi-file atomic transaction.

Follow-up after user merge of PR #9: only Daily Notes directory/naming integration and affected regression tests. Daily Notes templates and third-party Periodic Notes settings remain out of scope; newly created destination notes contain only Timeline and the transferred Todo. Closure uses a new follow-up PR because #9 is already merged.

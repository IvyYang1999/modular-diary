# 0.3.1 — Ready for the community directory

Fixes what the Obsidian community directory's automated review blocked in 0.3.0. Nothing changes in your notes.

- **Settings headings** are Obsidian's own setting headings now, so the settings page matches the rest of Obsidian. The daily quote section is titled "Daily quote".
- **Inline styles** the plugin sets while you drag, resize or hover are cleared with `removeProperty` instead of assigning an empty value. Behaviour is the same.

# 0.3.0 — Week and month plans

Modular Diary grows from one page per day into a planner around it. Nothing in your existing `timeline` blocks needs to change.

## Plan the week and the month

- **Day · Week · Month in place.** The bar on top of a day switches the same block to its week or month. Week and month plans are notes of their own (in `Plans/` by default), in the same Markdown format.
- **Morning, afternoon, evening.** Drag todos onto a day or a part of it, between days, or onto the week's hour axis. Give a todo a clock time and it appears on that day's timeline, drawn from the week note.
- **Goals** hold their own todos and sub-goals, can group them by day, and tick themselves when everything under them is done.
- **Rhythms** ("30 minutes of exercise a day", "3 hours of reading a week", "call family twice a week") are set up once in the rhythms panel. Each week shows what is due, how far along you are, and what carried over; timeline records count by themselves.
- **New event in one line:** `Fri 7pm dinner with Sam @Meals 2h` or `11月15日 下午3点 参加演出 @出门 2小时`, from the command palette, the day or week bar, or a right-click on an empty day.
- **Actual faces:** the week on an hour axis with totals per category, the month as a strip of colour per day.

## The day page

- Todos: sub-todos, notes, difficulty and priority, attachments (images, files, links), partial status, push to tomorrow, ABC and four-quadrant layouts, two-level grouping, and an optional AI review against your own checklist.
- Checklist modules, copied from templates and saved back as templates.
- An hour-by-hour log, habits ticked by hand, the current time on today's timeline, and module drags that snap into place.
- Note-body checkboxes under a heading of your choice can be managed by the todo module.

## Under the hood

- No longer fails to load on Obsidian mobile: Node modules are only touched by the desktop-only Claude Code CLI path. Phone layouts are not tuned yet.
- No lookbehind regular expressions (iOS before 16.4), no `innerHTML`, and no fixed inline styles.
- Releases are built by GitHub Actions with build provenance attestations.
- MIT licensed.

# 0.2.0 — Modular Diary

The plugin formerly named Oneday now has a new identity: **Modular Diary**. This is an intentional plugin-ID change from `oneday` to `modular-diary`, not a regular update of the same installed plugin.

## What changed

- Plugin name, manifest ID, package name, GitHub repository name, website links, and agent-skill name use Modular Diary.
- Rendered CSS classes and custom properties use the `modular-diary-` prefix.
- The settings tab and command namespace now use `modular-diary`.
- The `timeline` Markdown code fence, note format, and existing daily entries remain unchanged.
- Save-recovery fixes preserve unsaved notes and text across redraw/remount, require an explicit retry after persistence failure, and refuse writes when the original `timeline` source can no longer be identified safely.

## Impact on existing installations

| Existing surface | Impact | Action |
| --- | --- | --- |
| Installed `.obsidian/plugins/oneday/` | The new ID installs as a separate plugin; it does not replace the old folder. | Disable the old plugin before enabling the new one. Keep the old folder for rollback until verified. |
| `data.json` settings | Settings remain in the old plugin folder; they are not transferred automatically. It may contain an API key. | Make a private local backup, then copy `data.json` to `.obsidian/plugins/modular-diary/` while both plugins are stopped. |
| `timeline` blocks in notes | No format change. Both plugin versions would register the same code block if enabled together. | No note rewrite; enable only one version at a time and verify real rendering. |
| Custom hotkeys | Obsidian scopes command IDs by plugin ID. | Reassign shortcuts for `modular-diary:insert-timeline-block`. |
| CSS snippets/themes | `.oneday-*` selectors and `--oneday-*` overrides no longer match the new UI. | Update them to `.modular-diary-*` and `--modular-diary-*`. |
| BRAT tracking | Old repository URLs may redirect, but the old plugin ID cannot be treated as an in-place update. | Remove old tracking and add `IvyYang1999/modular-diary` after release. |
| GitHub links/clones | GitHub redirects the old repository path while it is not reused. | Update remotes, bookmarks, and links to the new URL. Do not rely on the redirect long-term. |
| 0.1.0 Release | Its assets and manifest still describe the historical `oneday` plugin. | Leave that release intact for rollback; use 0.2.0 assets for new installs. |

See the [README migration steps](README.md#install) before installing over an existing vault. The 0.2.0 release includes matching `manifest.json`, `main.js`, and `styles.css` assets.

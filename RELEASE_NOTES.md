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

See the [README migration steps](README.md#migrating-from-010-oneday) before installing over an existing vault. The 0.2.0 release includes matching `manifest.json`, `main.js`, and `styles.css` assets.

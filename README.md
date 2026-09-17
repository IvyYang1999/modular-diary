# Modular Diary

A modular daily journal for Obsidian, built around a visual timeline. Time blocks, text, habits, todos, and daily quotes live in a Markdown `timeline` code block.

The plugin ID is `modular-diary`. The GitHub repository is `IvyYang1999/modular-diary`. The `timeline` code fence and note format have **not** changed.

## Install

Add `IvyYang1999/modular-diary` in BRAT, or place the 0.2.0 release's `manifest.json`, `main.js`, and `styles.css` in `.obsidian/plugins/modular-diary/`. Requires Obsidian 1.8.7 or later.

The older 0.1.0 release belongs to the `oneday` plugin ID; do not mix its files with 0.2.0.

## Migrating from 0.1.0 (`oneday`)

Changing the plugin ID is **not** an in-place update. Back up `.obsidian/plugins/oneday/` and `.obsidian/community-plugins.json` outside the synced vault first. The old `data.json` may contain your model API key; keep the backup private.

1. Install the new release in `.obsidian/plugins/modular-diary/` without overwriting the old directory.
2. Disable the old plugin in Obsidian. With both plugins stopped, copy the old `data.json` into the new plugin directory if you want to retain settings, then enable Modular Diary. Do not enable both at once: both register the `timeline` code block.
3. Check a real daily note, plugin settings, and any custom hotkeys. The command is now `modular-diary:insert-timeline-block`; old `oneday:` hotkey assignments do not automatically follow it.
4. If you used BRAT, remove the old repository from BRAT tracking and add `IvyYang1999/modular-diary` after the new release is available. Removing BRAT tracking alone does not uninstall the old plugin.
5. Update custom CSS snippets that target `.oneday-*` classes or `--oneday-*` variables to `.modular-diary-*` and `--modular-diary-*`. Keep the old installation until the new one is verified; only then decide whether to remove it.

The Markdown `timeline` blocks and their contents do not need migration. See [release notes](RELEASE_NOTES.md) for the complete impact list.

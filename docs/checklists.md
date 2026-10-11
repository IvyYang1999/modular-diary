# Checklists

A checklist is a note in the checklist folder (default `Checklists/`, set in
Modular Diary settings). Every list line is one item; headings and prose are
ignored. Frontmatter `daily: true` makes it a daily checklist.

```markdown
---
daily: true
---
- 刷牙
- 关电脑
  - 关显示器
```

Adding it to a diary copies the items as unchecked Markdown task boxes under a
heading with the checklist's name:

```markdown
### 睡前
- [ ] 刷牙
- [ ] 关电脑
  - [ ] 关显示器
```

The copy belongs to that day. Editing the template later only changes diaries
that receive it afterwards; ticked boxes and past diaries are never rewritten.

## Ways in

- **New daily notes** (path matches the core Daily Notes folder and format):
  every `daily: true` checklist is appended about 1.5 s after the note is
  created, so Daily Notes / Templater templates finish first.
- **Add checklist** (command palette or editor right-click): pick any
  checklist; it is inserted below the cursor line.
- **Add daily checklists to this note** (command palette): appends the daily
  checklists to the open note, e.g. for a diary created before the module.

A note that already has a heading with the checklist's name (any level) is
left alone, so repeated runs never duplicate a list.

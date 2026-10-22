/**
 * Checkbox todos written in the note body, outside any code fence.
 *
 * The Todo component already merges two sources (block `todo:` headers and
 * global weekly goals). These are the third: the `- [ ]` list a daily-note
 * template keeps under its own heading. Markdown stays the single source of
 * truth — nothing is copied into the block, the component reads and writes
 * the body lines in place.
 *
 * Pure: no Obsidian, no filesystem.
 */

export interface BodyTodoItem {
  /**
   * Derived from the group and title, not the line number, so a timeline
   * block bound to this todo survives the list being reordered. Handlers
   * still re-locate by `raw` before writing.
   */
  id: string
  title: string
  /** Nearest sub-heading inside the section, "" when the list is flat. */
  group: string
  completed: boolean
  /** 0-based line index in the whole note. */
  line: number
  /** The untouched source line, used to detect that the note moved under us. */
  raw: string
  /** Captured note and section disambiguate equal lines after an external edit. */
  snapshot: string
  section: string
}

const HEADING = /^(#{1,6})\s+(.*?)\r?$/
const CHECKBOX = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*?)\r?$/
const FENCE = /^\s*(```+|~~~+)/

/** Trailing `^block-id` is Obsidian's anchor syntax, not part of the title. */
const BLOCK_ID = /\s+\^[\w-]+\s*$/

/** Only Markdown outside an enclosing fence can own a checkbox or section. */
function* noteLines(source: string): Generator<{ text: string; line: number }> {
  let fence: string | null = null
  const lines = source.split("\n")
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line]
    const marker = FENCE.exec(text)?.[1]
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && text.slice(text.indexOf(marker) + marker.length).trim() === "") fence = null
      continue
    }
    if (marker) { fence = marker; continue }
    yield { text, line }
  }
}

/**
 * Content-addressed id, in the `[a-z0-9_-]+` alphabet the `[todo:…]` entry
 * binding accepts. `seen` disambiguates a title repeated inside one group.
 */
function bodyTodoId(group: string, title: string, seen: Map<string, number>): string {
  const key = `${group}\u0000${title}`
  const occurrence = (seen.get(key) ?? 0) + 1
  seen.set(key, occurrence)
  let hash = 2166136261
  for (const character of `${key}\u0000${occurrence}`) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0
  }
  return `body-${hash.toString(36)}`
}

function headingText(line: string): { level: number; text: string } | null {
  const match = HEADING.exec(line)
  return match ? { level: match[1].length, text: match[2].trim() } : null
}

/**
 * Collect checkbox items from `source`.
 *
 * `section` empty scans the whole note. Otherwise only the heading whose text
 * equals `section` is scanned, up to the next heading of the same or higher
 * level, and each item's group is the closest deeper heading above it.
 */
export function parseBodyTodos(source: string, section: string): BodyTodoItem[] {
  const wanted = section.trim()
  const items: BodyTodoItem[] = []
  let sectionLevel = wanted === "" ? 0 : -1 // -1: not found yet
  let group = ""
  const seen = new Map<string, number>()

  for (const { text, line } of noteLines(source)) {

    const heading = headingText(text)
    if (heading) {
      if (sectionLevel === -1) {
        if (heading.text === wanted) {
          sectionLevel = heading.level
          group = ""
        }
        continue
      }
      // A sibling or higher heading closes a named section; inside it, a
      // deeper heading just renames the current group.
      if (wanted !== "" && heading.level <= sectionLevel) break
      group = heading.text
      continue
    }
    if (sectionLevel === -1) continue

    const box = CHECKBOX.exec(text)
    if (!box) continue
    const title = box[4].replace(BLOCK_ID, "").trim()
    if (title === "") continue // template placeholders like a bare "- [ ]"
    items.push({
      id: (() => {
        const anchor = BLOCK_ID.exec(box[4])?.[0].trim().slice(1)
        return anchor && /^body-[a-z0-9]+$/.test(anchor) ? anchor : bodyTodoId(anchor ? "" : group, anchor ?? title, seen)
      })(),
      title,
      group,
      completed: box[2] !== " ",
      line,
      raw: text,
      snapshot: source,
      section: wanted,
    })
  }
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  return items.filter(item => counts.get(item.id) === 1)
}

/**
 * Re-find an item's line after the note may have changed.
 * Returns the line index, or -1 when the exact line is gone.
 */
type BodyTodoTarget = Pick<BodyTodoItem, "line" | "raw"> & Partial<Pick<BodyTodoItem, "snapshot" | "section" | "group" | "id">>
function locate(source: string, item: BodyTodoTarget): number {
  if (item.snapshot === source && source.split("\n")[item.line] === item.raw) return item.line
  if (item.section && item.snapshot) {
    const sections = (text: string): number => [...noteLines(text)].filter(line => headingText(line.text)?.text === item.section).length
    if (sections(item.snapshot) !== 1 || sections(source) !== 1) return -1
  }
  const matches = (text: string): BodyTodoItem[] => parseBodyTodos(text, item.section ?? "")
    .filter(candidate => candidate.raw === item.raw && (item.group === undefined || candidate.group === item.group))
  if (item.snapshot && matches(item.snapshot).length > 1) return -1
  const found = matches(source)
  return found.length === 1 ? found[0].line : -1
}

type Rewrite = (line: string) => string | null

function editLine(source: string, item: BodyTodoTarget, rewrite: Rewrite): string | null {
  const lines = source.split("\n")
  const at = locate(source, item)
  if (at === -1) return null
  const next = rewrite(lines[at])
  if (next === null) return null
  lines[at] = next
  return lines.join("\n")
}

/** Returns the new note text, or null when the line is gone (caller re-renders). */
export function setBodyTodoCompleted(
  source: string,
  item: BodyTodoTarget,
  completed: boolean
): string | null {
  return editLine(source, item, (line) => {
    const box = CHECKBOX.exec(line)
    return box ? line.replace(/^(\s*[-*+]\s+\[)[ xX](\])/, `$1${completed ? "x" : " "}$2`) : null
  })
}

export function setBodyTodoTitle(
  source: string,
  item: BodyTodoTarget,
  title: string
): string | null {
  const clean = title.trim()
  if (clean === "" || /[\r\n]/.test(clean)) return null
  return editLine(source, item, (line) => {
    const box = CHECKBOX.exec(line)
    if (!box) return null
    // Keep the anchor: other notes may link to this line.
    const anchor = BLOCK_ID.exec(box[4])?.[0].trim()
      ?? (item.id && source.includes(`[todo:${item.id}]`) ? `^${item.id}` : "")
    return `${box[1]}${box[2]}${box[3]}${clean}${anchor ? ` ${anchor}` : ""}${line.endsWith("\r") ? "\r" : ""}`
  })
}

/**
 * Append `- [ ] title` to the section, after its last checkbox so a new item
 * lands at the bottom of the existing list. With no list yet it goes directly
 * under the section heading. Returns null when the section is missing.
 */
export function appendBodyTodo(source: string, section: string, title: string): string | null {
  const clean = title.trim()
  const wanted = section.trim()
  if (clean === "" || wanted === "" || /[\r\n]/.test(clean)) return null
  const lines = source.split("\n")
  const existing = parseBodyTodos(source, wanted)
  let at: number
  let bullet = "- [ ] "
  if (existing.length > 0) {
    const last = existing[existing.length - 1]
    at = last.line + 1
    // Take the marker and indentation from the first item: the last one may be
    // a nested sub-task, and a new todo belongs at the list's own level.
    bullet = `${/^(\s*[-*+]\s+)\[/.exec(existing[0].raw)?.[1] ?? "- "}[ ] `
  } else {
    const heading = [...noteLines(source)].find(({ text }) => headingText(text)?.text === wanted)?.line ?? -1
    if (heading === -1) return null
    at = heading + 1
    // Keep one blank line of breathing room under the heading if it has one.
    if (lines[at]?.trim() === "") at += 1
  }
  lines.splice(at, 0, `${bullet}${clean}${source.includes("\r\n") ? "\r" : ""}`)
  return lines.join("\n")
}

export function removeBodyTodo(source: string, item: BodyTodoTarget): string | null {
  const lines = source.split("\n")
  const at = locate(source, item)
  if (at === -1) return null
  lines.splice(at, 1)
  return lines.join("\n")
}

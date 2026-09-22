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
}

const HEADING = /^(#{1,6})\s+(.*)$/
const CHECKBOX = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/
const FENCE = /^\s*(```+|~~~+)/

/** Trailing `^block-id` is Obsidian's anchor syntax, not part of the title. */
const BLOCK_ID = /\s+\^[\w-]+\s*$/

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
  const lines = source.split("\n")
  const wanted = section.trim()
  const items: BodyTodoItem[] = []
  let fence: string | null = null
  let sectionLevel = wanted === "" ? 0 : -1 // -1: not found yet
  let group = ""
  const seen = new Map<string, number>()

  for (let line = 0; line < lines.length; line++) {
    const text = lines[line]

    // Fences nest by marker length; anything inside one is code, not a todo.
    const fenceMatch = FENCE.exec(text)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      continue
    }
    if (fence !== null) continue

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
      id: bodyTodoId(group, title, seen),
      title,
      group,
      completed: box[2] !== " ",
      line,
      raw: text,
    })
  }
  return items
}

/**
 * Re-find an item's line after the note may have changed.
 * Returns the line index, or -1 when the exact line is gone.
 */
function locate(lines: string[], item: Pick<BodyTodoItem, "line" | "raw">): number {
  if (lines[item.line] === item.raw) return item.line
  const found = lines.indexOf(item.raw)
  return found
}

type Rewrite = (line: string) => string | null

function editLine(source: string, item: Pick<BodyTodoItem, "line" | "raw">, rewrite: Rewrite): string | null {
  const lines = source.split("\n")
  const at = locate(lines, item)
  if (at === -1) return null
  const next = rewrite(lines[at])
  if (next === null) return null
  lines[at] = next
  return lines.join("\n")
}

/** Returns the new note text, or null when the line is gone (caller re-renders). */
export function setBodyTodoCompleted(
  source: string,
  item: Pick<BodyTodoItem, "line" | "raw">,
  completed: boolean
): string | null {
  return editLine(source, item, (line) => {
    const box = CHECKBOX.exec(line)
    return box ? `${box[1]}${completed ? "x" : " "}${box[3]}${box[4]}` : null
  })
}

export function setBodyTodoTitle(
  source: string,
  item: Pick<BodyTodoItem, "line" | "raw">,
  title: string
): string | null {
  const clean = title.trim()
  if (clean === "") return null
  return editLine(source, item, (line) => {
    const box = CHECKBOX.exec(line)
    if (!box) return null
    // Keep the anchor: other notes may link to this line.
    const anchor = BLOCK_ID.exec(box[4])?.[0].trimEnd() ?? ""
    return `${box[1]}${box[2]}${box[3]}${clean}${anchor ? ` ${anchor.trim()}` : ""}`
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
  if (clean === "" || wanted === "") return null
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
    const heading = lines.findIndex((line) => {
      const match = HEADING.exec(line)
      return match !== null && match[2].trim() === wanted
    })
    if (heading === -1) return null
    at = heading + 1
    // Keep one blank line of breathing room under the heading if it has one.
    if (lines[at]?.trim() === "") at += 1
  }
  lines.splice(at, 0, `${bullet}${clean}`)
  return lines.join("\n")
}

export function removeBodyTodo(source: string, item: Pick<BodyTodoItem, "line" | "raw">): string | null {
  const lines = source.split("\n")
  const at = locate(lines, item)
  if (at === -1) return null
  lines.splice(at, 1)
  return lines.join("\n")
}

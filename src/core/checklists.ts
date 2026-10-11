/**
 * Checklist templates (yyt 2026-10-09): each template is a Vault file such as
 * `Checklists/睡前.md`. Adding one to a diary copies it as plain Markdown task
 * boxes under a heading, so later template edits never change past diaries.
 * Pure TS, zero Obsidian deps.
 */

export interface ChecklistItem {
  /** Leading whitespace of the source list line, kept so nested items stay nested. */
  indent: string
  text: string
}

export interface ChecklistTemplate {
  /** File basename; also the heading the copy is written under. */
  name: string
  items: ChecklistItem[]
  /** `daily: true` in the template's frontmatter: added to every new daily note. */
  daily: boolean
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const LIST_LINE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[^\]]\][ \t]*)?(.*)$/
const TRUE_VALUES = new Set(["true", "yes", "on", "1"])

/** `daily` lives in frontmatter; the body is the list. Headings and prose are notes for the author, not items. */
export function parseChecklistTemplate(name: string, content: string): ChecklistTemplate {
  const fm = FRONTMATTER.exec(content)
  let daily = false
  if (fm) {
    const line = /^daily[ \t]*:[ \t]*(.*)$/m.exec(fm[1])
    daily = Boolean(line && TRUE_VALUES.has(line[1].trim().replace(/^["']|["']$/g, "").toLowerCase()))
  }
  const body = fm ? content.slice(fm[0].length) : content
  const items: ChecklistItem[] = []
  for (const raw of body.split(/\r?\n/)) {
    const match = LIST_LINE.exec(raw)
    if (!match) continue
    const text = match[2].trim()
    if (text) items.push({ indent: match[1].replace(/\t/g, "    "), text })
  }
  return { name: name.trim(), items, daily }
}

/** The copy written into a diary: a heading plus unchecked task boxes. */
export function renderChecklist(template: ChecklistTemplate): string {
  const lines = [`### ${template.name}`]
  for (const item of template.items) lines.push(`${item.indent}- [ ] ${item.text}`)
  return lines.join("\n")
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A diary already holds a checklist when it has a heading (any level) with that exact name. */
export function hasChecklist(content: string, name: string): boolean {
  return new RegExp(`^#{1,6}[ \\t]+${escapeRegExp(name.trim())}[ \\t]*#*[ \\t]*$`, "m").test(content)
}

/** Idempotent append: missing checklists go to the end of the note, separated by a blank line. */
export function appendChecklists(content: string, templates: readonly ChecklistTemplate[]): string {
  let next = content
  for (const template of templates) {
    if (!template.name || hasChecklist(next, template.name)) continue
    const separator = next === "" ? "" : next.endsWith("\n\n") ? "" : next.endsWith("\n") ? "\n" : "\n\n"
    next += separator + renderChecklist(template) + "\n"
  }
  return next
}

/** Text to insert at the editor cursor: on its own paragraph whatever line the cursor is on. */
export function checklistInsertion(template: ChecklistTemplate, currentLine: string): string {
  return (currentLine.trim() === "" ? "" : "\n\n") + renderChecklist(template) + "\n"
}

/** Starter file for "New checklist" in settings. */
export function checklistTemplateStarter(daily: boolean, sample: readonly string[]): string {
  return `---\ndaily: ${daily}\n---\n${sample.map((line) => `- ${line}`).join("\n")}\n`
}

/** Daily Notes owns which files are diaries: `<folder>/<format>.md` that parses strictly as a date. */
export function isDailyNotePath(
  path: string,
  options: unknown,
  parsesAsDate: (value: string, format: string) => boolean
): boolean {
  if (!options || typeof options !== "object" || !path.endsWith(".md")) return false
  const { folder, format } = options as { folder?: unknown; format?: unknown }
  if ((folder !== undefined && typeof folder !== "string") || (format !== undefined && typeof format !== "string")) return false
  const directory = ((folder as string | undefined) ?? "").trim().replace(/^\/+|\/+$/g, "")
  const prefix = directory ? directory + "/" : ""
  if (!path.startsWith(prefix)) return false
  return parsesAsDate(path.slice(prefix.length, -3), (format as string | undefined) || "YYYY-MM-DD")
}

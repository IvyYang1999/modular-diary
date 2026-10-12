/**
 * One definition of "the diary body under a line", shared by the parser and
 * every rewriter (hour diary review A1). A body is the run of indented lines
 * (two spaces or a tab) right under an entry, marker or span. Blank lines
 * inside it are paragraph breaks: they belong to the body only when an
 * indented line follows them.
 */
export const BODY_LINE_RE = /^(?: {2}|\t)\s*\S/

/**
 * Separator between the entry area and a free text area: an unindented `===`,
 * optionally followed by the section's title (`=== 感恩日记`).
 */
export const TEXT_SEPARATOR_RE = /^===(?:[ \t\u3000]+(\S.*?))?[ \t\u3000]*\r?$/

/** Title written after a section's `===`, if any. */
export function separatorTitle(line: string): string | undefined {
  return TEXT_SEPARATOR_RE.exec(line)?.[1]?.trim() || undefined
}

/**
 * Text that would read as a separator (`=== 小结`, a Setext underline) is
 * written with a leading backslash and read back without it, so writing a
 * line never splits a section (phase 4 review A1). Markdown renders `\===`
 * as `===`.
 */
export function escapeSectionLine(line: string): string {
  return TEXT_SEPARATOR_RE.test(line.replace(/^\\+/, "")) && /^\\*===/.test(line) ? `\\${line}` : line
}

export function unescapeSectionLine(line: string): string {
  return /^\\+===/.test(line) && TEXT_SEPARATOR_RE.test(line.replace(/^\\+/, "")) ? line.slice(1) : line
}

/**
 * Where the block header ends: header lines (`key: value`), blanks and
 * comments from the top, up to the first entry, section or `---`.
 * `separator` is the `---` line when the header is closed by one.
 */
export function headerZone(lines: readonly string[]): { end: number; separator: number; lastHeader: number } {
  let lastHeader = -1
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].trim()
    if (text === "---") return { end: i, separator: i, lastHeader }
    if (text === "" || text.startsWith("#")) continue
    if (/^[A-Za-z][\w-]*\s*:/.test(text) && !TEXT_SEPARATOR_RE.test(lines[i])) { lastHeader = i; continue }
    return { end: i, separator: -1, lastHeader }
  }
  return { end: lines.length, separator: -1, lastHeader }
}

/** Where a new header line goes: before `---`, else right after the last header line, else at the top. */
export function headerInsertIndex(lines: readonly string[]): number {
  const zone = headerZone(lines)
  return zone.separator >= 0 ? zone.separator : zone.lastHeader + 1
}

/** Number of lines after `line` that make up its body (0 when none). */
export function bodyExtent(lines: readonly string[], line: number): number {
  let last = line
  let i = line + 1
  while (i < lines.length) {
    if (BODY_LINE_RE.test(lines[i])) { last = i; i += 1; continue }
    if (lines[i].trim() !== "") break
    let j = i
    while (j < lines.length && lines[j].trim() === "") j += 1
    if (j < lines.length && BODY_LINE_RE.test(lines[j])) { i = j; continue }
    break
  }
  return last - line
}

/** The body text of those lines: one indent level removed, blank lines kept as paragraph breaks. */
export function readBody(lines: readonly string[], line: number, extent: number): string {
  return lines.slice(line + 1, line + 1 + extent)
    .map((raw) => raw.trim() === "" ? "" : raw.replace(/^(?: {2}|\t)/, "").replace(/\s+$/, ""))
    .join("\n")
}

/**
 * A body line that starts a code fence (``` or ~~~) would close the timeline
 * block around it, so such text is never written.
 */
export const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/m
export class BodyFenceError extends Error {
  constructor() {
    super("body-contains-fence")
  }
}

/**
 * New-block template as a source skeleton (phase 4): the header lines that
 * shape a day (layout, hidden components, todo layout, range…) and the text
 * sections with their titles, without any of that day's records. It is plain
 * block source, so it can be edited as text and read by an agent.
 */
import { FENCE_LINE_RE, TEXT_SEPARATOR_RE } from "./body-extent"
import { parseTimeline } from "./parser"

/** Header keys that describe how a block looks, not what happened that day. */
const SHAPE_KEYS = new Set(["range", "width", "side", "hide", "hide-marker", "layout", "off", "todo-view", "block-size", "canvas-width", "float"])

/** Skeleton of a day block: its shape headers, then `---`, then each text section's separator line. */
export function skeletonFromSource(source: string): string {
  const lines = source.split(/\r?\n/)
  const head: string[] = []
  const sections: string[] = []
  let inHeader = true
  for (const raw of lines) {
    const line = raw.trim()
    if (TEXT_SEPARATOR_RE.test(raw)) { inHeader = false; sections.push(raw.trimEnd()); continue }
    if (!inHeader || sections.length > 0) continue
    if (line === "---") { inHeader = false; continue }
    const match = /^([A-Za-z][\w-]*)\s*:/.exec(line)
    if (match && SHAPE_KEYS.has(match[1].toLowerCase())) head.push(line)
    else if (!match && line !== "" && !line.startsWith("#")) inHeader = false
  }
  return [...head, "---", ...sections].join("\n")
}

/** A block for `date` built from a skeleton; a skeleton without `---` gets one before its sections. */
export function blockFromSkeleton(date: string, skeleton: string): string {
  // A template shapes a day; it never carries a date, a period or anything that could end the fence.
  const lines = skeleton.split(/\r?\n/).filter((line) => !/^(date|days|goal|rail)\s*:/i.test(line.trim()) && !FENCE_LINE_RE.test(line))
  if (!lines.some((line) => line.trim() === "---")) {
    const firstSection = lines.findIndex((line) => TEXT_SEPARATOR_RE.test(line))
    lines.splice(firstSection >= 0 ? firstSection : lines.length, 0, "---")
  }
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
  return [`date: ${date}`, ...lines].join("\n")
}

/** Problems a template would cause in every new day; empty when it is safe to save. */
export function templateProblems(skeleton: string): string[] {
  const problems: string[] = []
  if (FENCE_LINE_RE.test(skeleton)) problems.push("fence")
  if (/^\s*days\s*:/im.test(skeleton)) problems.push("days")
  const doc = parseTimeline(blockFromSkeleton("2000-01-01", skeleton))
  for (const error of doc.errors) problems.push(`line:${error.text.trim()}:${error.reason}`)
  return problems
}

/** A one-line reading of what a new day will contain. */
export function templateSummary(skeleton: string): { sections: string[]; todoLayout: string; hidden: string[] } {
  const doc = parseTimeline(blockFromSkeleton("2000-01-01", skeleton))
  return {
    sections: (doc.textTitles ?? []).map((title) => title ?? ""),
    todoLayout: doc.todoView.layout ?? "list",
    hidden: doc.hiddenSlots,
  }
}

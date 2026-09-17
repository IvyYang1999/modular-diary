import { timelineFences, type TimelineFenceLocation } from "./block-identity"

/** A renderer may include its final newline; never trim meaningful spaces. */
function matches(rendered: string, live: string): boolean {
  return rendered === live || rendered === live + "\n"
}

/** Resolve a live section or recover only from a unique, unchanged source. */
export function resolveTimelineSource(
  content: string,
  source: string,
  section: { lineStart: number; lineEnd: number } | null,
): TimelineFenceLocation | null {
  const candidates = [...timelineFences(content)].filter((location) => matches(source, location.source))
  if (section) {
    const current = candidates.find((location) => location.lineStart === section.lineStart && location.lineEnd === section.lineEnd)
    if (current) return current
  }
  return candidates.length === 1 ? candidates[0] : null
}

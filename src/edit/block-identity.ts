const FENCE_OPEN = /^(\s*(?:>\s*)*)(`{3,}|~{3,})([^`]*)$/

export interface TimelineFenceLocation {
  lineStart: number
  lineEnd: number
  source: string
}

/** Walk actual fences, skipping code examples rather than matching their contents. */
export function* timelineFences(content: string): Generator<TimelineFenceLocation> {
  const lines = content.split("\n")
  for (let start = 0; start < lines.length; start += 1) {
    const opening = FENCE_OPEN.exec(lines[start] ?? "")
    if (!opening) continue
    const prefix = opening[1]
    const fence = opening[2]
    const isTimeline = /^\s*timeline(?:\s|$)/i.test(opening[3])
    const body: string[] = []
    let valid = true
    let end = start + 1
    for (; end < lines.length; end += 1) {
      const line = lines[end]
      if (line.slice(prefix.length).trim() === fence && (prefix === "" || line.startsWith(prefix))) break
      if (prefix === "") body.push(line)
      else if (line.startsWith(prefix)) body.push(line.slice(prefix.length))
      else if (line === prefix.trimEnd()) body.push("")
      else valid = false
    }
    if (end >= lines.length) return
    if (isTimeline && valid) yield { lineStart: start, lineEnd: end, source: body.join("\n") }
    start = end
  }
}

/** Ordinal is for mounted identity; deferred writes additionally verify source. */
export function timelineFenceOrdinal(content: string, lineStart: number): number {
  let ordinal = 0
  for (const location of timelineFences(content)) {
    if (location.lineStart >= lineStart) break
    ordinal += 1
  }
  return ordinal
}

export function timelineFenceAtOrdinal(content: string, targetOrdinal: number): TimelineFenceLocation | null {
  if (!Number.isInteger(targetOrdinal) || targetOrdinal < 0) return null
  let ordinal = 0
  for (const location of timelineFences(content)) {
    if (ordinal++ === targetOrdinal) return location
  }
  return null
}

export function timelineSourceAtOrdinal(content: string, targetOrdinal: number): string | null {
  return timelineFenceAtOrdinal(content, targetOrdinal)?.source ?? null
}

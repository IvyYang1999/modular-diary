import { timelineFences, type TimelineFenceLocation } from "./block-identity"
import { parseTimeline } from "../core/parser"
import { resolveTimelineSource } from "./source-location"

const same = (a: string, b: string): boolean => a === b || a === b + "\n" || a + "\n" === b

/** Bounded, pane-local lineage of applied mutations, never a license to write by ordinal. */
export class SourceRevisions {
  private owners = new WeakMap<object, Map<string, { before: string; after: string }[]>>()

  remember(owner: object, path: string, before: string, after: string): void {
    if (same(before, after)) return
    let files = this.owners.get(owner)
    if (!files) this.owners.set(owner, files = new Map())
    const revisions = files.get(path) ?? []
    revisions.push({ before, after })
    files.set(path, revisions.slice(-128))
  }

  candidates(content: string, owner: object, path: string, source: string): TimelineFenceLocation[] {
    const sources = [source]
    for (const revision of this.owners.get(owner)?.get(path) ?? []) {
      if (sources.some(value => same(value, revision.before))) sources.push(revision.after)
    }
    return [...timelineFences(content)].filter(location => sources.some(value => same(value, location.source)))
  }

  resolve(content: string, owner: object, path: string, source: string, section: { lineStart: number; lineEnd: number } | null): TimelineFenceLocation | null {
    const candidates = this.candidates(content, owner, path, source)
    const exactSection = section && candidates.find(location => location.lineStart === section.lineStart && location.lineEnd === section.lineEnd)
    return exactSection || (candidates.length === 1 ? candidates[0] : null)
  }

  clear(): void { this.owners = new WeakMap() }
}

export interface TextMutation {
  index: number
  baseText: string
  text: string
}

function textParts(source: string): { head: string; texts: string[] } {
  const lines = source.split(/\r?\n/)
  const boundary = lines.findIndex(line => line.trim() === "===")
  return { head: lines.slice(0, boundary < 0 ? lines.length : boundary).join("\n"), texts: parseTimeline(source).texts }
}

/** Locate by unchanged structure/content, then compare only the submitted text slot. */
export function resolveTextMutation(
  content: string,
  source: string,
  section: { lineStart: number; lineEnd: number } | null,
  mutation: TextMutation,
  knownLocation: TimelineFenceLocation | null = resolveTimelineSource(content, source, section),
): TimelineFenceLocation | null {
  const base = textParts(source)
  const canWrite = (location: TimelineFenceLocation): boolean => {
    const live = textParts(location.source)
    if (live.texts.length !== base.texts.length) return false
    const text = live.texts[mutation.index] ?? (mutation.index === 0 && live.texts.length === 0 ? "" : null)
    return text !== null && (text === mutation.baseText.trim() || text === mutation.text.trim())
  }
  if (knownLocation) return canWrite(knownLocation) ? knownLocation : null
  // Without proven local lineage, keep an independent content anchor: either
  // the complete non-text portion or all text slots must still match. A stale
  // section/ordinal alone must never select a replacement block.
  const candidates = [...timelineFences(content)].filter(location => {
    const live = textParts(location.source)
    return canWrite(location) && ((base.head.trim().length > 0 && same(live.head, base.head))
      || (base.texts.some(value => value.length > 0) && live.texts.length === base.texts.length
        && live.texts.every((value, index) => value === base.texts[index])))
  })
  const atSection = section && candidates.find(location => location.lineStart === section.lineStart && location.lineEnd === section.lineEnd)
  return atSection || (candidates.length === 1 ? candidates[0] : null)
}

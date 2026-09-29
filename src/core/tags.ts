/**
 * Tags (#词) live inside free text: an entry note, a diary body, a todo title.
 * They are extracted at parse time and never stored separately, so the source
 * stays the single truth. A tag may belong to a category (settings table
 * `tagCategories`) and then borrows that category's colour; otherwise it is
 * independent and neutral. (yyt 2026-09-28: badges, 从属分类或独立.)
 */
import type { TimelineDoc } from "./types"

/** `#` followed by anything up to whitespace or common CJK/ASCII punctuation. */
export const TAG_RE = /#([^\s#，。,.;；、！!？?：:（）()\[\]{}"'<>`]+)/g

export function extractTags(text: string | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  for (const match of text.matchAll(TAG_RE)) {
    const tag = match[1]
    if (!out.includes(tag)) out.push(tag)
  }
  return out
}

/** Category a tag belongs to, or undefined for an independent tag. */
export function tagCategory(tag: string, table: Record<string, string>): string | undefined {
  const category = table[tag]
  return category ? category : undefined
}

/**
 * First use of a tag on a categorized block adopts that category; the user
 * may later detach it or move it in settings. Returns only the additions so
 * the caller can decide whether anything is worth persisting.
 */
export function learnTagCategories(doc: Pick<TimelineDoc, "entries" | "todos"> & { spans?: TimelineDoc["spans"] }, table: Record<string, string>): Record<string, string> {
  const learned: Record<string, string> = {}
  const seen = (tag: string): boolean => tag in table || tag in learned
  // Every tag is registered so it can be offered again; "" marks an independent one.
  for (const entry of doc.entries) {
    for (const tag of entry.tags) if (!seen(tag)) learned[tag] = entry.type ?? ""
  }
  for (const todo of doc.todos) {
    for (const tag of todo.tags ?? []) if (!seen(tag)) learned[tag] = todo.type ?? ""
  }
  for (const span of doc.spans ?? []) {
    for (const tag of span.tags) if (!seen(tag)) learned[tag] = ""
  }
  return learned
}

/** Minutes per tag over a set of actual entries and diary spans. Plans never count. */
export function tagMinutes(items: ReadonlyArray<{ plan?: boolean; startMin: number; endMin: number; tags: string[] }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    if (item.plan) continue
    for (const tag of item.tags) out[tag] = (out[tag] ?? 0) + item.endMin - item.startMin
  }
  return out
}

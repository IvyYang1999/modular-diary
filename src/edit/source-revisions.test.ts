import { describe, expect, it } from "vitest"
import { resolveTextMutation, SourceRevisions } from "./source-revisions"

const fence = (source: string): string => `\`\`\`timeline\n${source}\n\`\`\``
const base = "date: 2026-10-09\n08:00-09:00 work\n===\nfirst\n===\nsecond"
const edit = { index: 0, baseText: "first", text: "draft" }

describe("scoped text mutations", () => {
  it.each([
    ["header", base.replace("date: 2026-10-09", "date: 2026-10-10")],
    ["span", base.replace("09:00 work", "10:00 other")],
    ["other text", base.replace("second", "external second")],
  ])("merges external %s changes without overwriting them", (_label, live) => {
    expect(resolveTextMutation(fence(live), base, null, edit)?.source).toBe(live)
  })
  it("rejects an external edit to the target even with a correct section", () => {
    const live = base.replace("first", "external")
    expect(resolveTextMutation(fence(live), base, { lineStart: 0, lineEnd: 7 }, edit)).toBeNull()
  })
  it("accepts a persistence retry whose text is already applied", () => {
    expect(resolveTextMutation(fence(base.replace("first", "draft")), base, null, edit)).not.toBeNull()
  })
  it("rejects removed slots, replaced blocks and ambiguous fallback targets", () => {
    expect(resolveTextMutation(fence(base.split("\n===\nsecond")[0]), base, null, edit)).toBeNull()
    expect(resolveTextMutation(fence("unrelated\n===\nfirst"), base, null, edit)).toBeNull()
    expect(resolveTextMutation(fence("unrelated\n===\n"), "===\n", null, { ...edit, baseText: "" })).toBeNull()
    expect(resolveTextMutation(fence(base) + "\n" + fence(base), base, null, edit)).toBeNull()
  })
  it("keeps empty text slots and quoted fences coherent", () => {
    const source = "08:00-09:00 work\n===\n\n===\nsecond"
    const quoted = fence(source).split("\n").map(line => "> " + line).join("\n")
    expect(resolveTextMutation(quoted, source, null, { ...edit, baseText: "" })?.source).toBe(source)
  })
})

describe("applied source lineage", () => {
  it("follows local writes through moved fences without trusting an ordinal", () => {
    const revisions = new SourceRevisions(), owner = {}
    const resized = "block-size: 900x650\n" + base
    const latest = resized.replace("second", "saved second")
    revisions.remember(owner, "day.md", base, resized)
    revisions.remember(owner, "day.md", resized, latest)
    const content = fence("other") + "\n" + fence(latest)
    const known = revisions.resolve(content, owner, "day.md", base + "\n", null)
    expect(resolveTextMutation(content, base, null, edit, known)?.source).toBe(latest)
    expect(revisions.resolve(content, {}, "day.md", base, null)).toBeNull()
    expect(revisions.resolve(content, owner, "other.md", base, null)).toBeNull()
    expect(revisions.resolve(fence("replacement"), owner, "day.md", base, null)).toBeNull()
  })
  it("does not let an unchanged duplicate steal the mutated block", () => {
    const revisions = new SourceRevisions(), owner = {}, changed = base.replace("second", "saved")
    revisions.remember(owner, "day.md", base, changed)
    expect(revisions.resolve(fence(base) + "\n" + fence(changed), owner, "day.md", base, null)).toBeNull()
    expect(revisions.resolve(fence(base) + "\n" + fence(changed), owner, "day.md", base, { lineStart: 8, lineEnd: 15 })?.source).toBe(changed)
  })
  it("bounds lineage retention and clears pane state", () => {
    const revisions = new SourceRevisions(), owner = {}
    for (let i = 0; i < 129; i++) revisions.remember(owner, "day.md", String(i), String(i + 1))
    expect(revisions.resolve(fence("129"), owner, "day.md", "0", null)).toBeNull()
    expect(revisions.resolve(fence("129"), owner, "day.md", "1", null)).not.toBeNull()
    revisions.clear()
    expect(revisions.resolve(fence("129"), owner, "day.md", "1", null)).toBeNull()
  })
})

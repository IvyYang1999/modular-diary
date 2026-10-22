import { describe, expect, it } from "vitest"
import { skeletonFromSource, blockFromSkeleton } from "./template"
import { parseTimeline } from "./parser"
import { isValidSlotId, parseLayoutHeader } from "./grid-layout"
import { addChecklistModule, updateChecklistModule } from "../edit/checklist-source"
import { appendChecklistItem, nextChecklistItemId } from "./checklist-modules"

describe("independent Checklist modules", () => {
  it("never reuses deleted item IDs or duplicates a pending append on retry", () => {
    const empty = { id: "checklist1", title: "One", items: [] }
    const first = appendChecklistItem(empty, nextChecklistItemId(empty), "First")
    expect(appendChecklistItem(first, "item1", "First")).toEqual(first)
    const deleted = { ...first, items: [] }
    expect(nextChecklistItemId(deleted)).toBe("item2")
    expect(() => appendChecklistItem(deleted, "item1", "First")).toThrow()
    expect(appendChecklistItem(deleted, "item2", "Second").items[0].id).toBe("item2")
  })
  it("creates distinct modules and keeps surrounding diary records unchanged", () => {
    const original = 'date: 2026-10-22\n- [ ] todo: id="t" estimate=0 category="" group="" title="#keep Task"\n---\n09:00-10:00 work\n=== Notes\nKeep this text'
    const first = addChecklistModule(original, "First")
    const second = addChecklistModule(first, "Second")
    const doc = parseTimeline(second)
    expect(doc.errors).toEqual([])
    expect(doc.checklists?.map((c) => c.id)).toEqual(["checklist1", "checklist2"])
    expect(second).toContain('title="#keep Task"')
    expect(second).toContain('09:00-10:00 work\n=== Notes\nKeep this text')
    expect(isValidSlotId("checklist2")).toBe(true)
    expect(parseLayoutHeader("checklist2@0,0,6,8")?.[0].id).toBe("checklist2")
  })
  it("updates by stable identity without changing a peer or text that resembles a header", () => {
    let source = addChecklistModule(addChecklistModule('---\n=== Notes\nchecklist: this is prose', "First"), "Second")
    source = updateChecklistModule(source, "checklist1", (c) => ({ ...c, items: [{ id: "item1", text: 'Quoted "item" #tag', checked: false }] }))
    const checked = updateChecklistModule(source, "checklist1", (c) => ({ ...c, items: c.items.map((i) => ({ ...i, checked: true })) }))
    const caseVariant = checked.replace(/^checklist:/m, "CHECKLIST:")
    expect(() => updateChecklistModule(caseVariant, "checklist1", (c) => c)).not.toThrow()
    expect(checked).not.toBe(source)
    expect(parseTimeline(checked).checklists?.[0].items[0].checked).toBe(true)
    expect(parseTimeline(checked).checklists?.[1].title).toBe("Second")
    expect(checked).toContain('=== Notes\nchecklist: this is prose')
    expect(() => updateChecklistModule(checked, "checklist9", (c) => c)).toThrow()
  })
  it("copies templates independently and resets checks when saved as a new-day layout", () => {
    const template = { name: "Evening", daily: true, items: [{ indent: "  ", text: "Original" }] }
    let source = addChecklistModule('- [ ] todo: id="keep" estimate=0 category="" group="" title="Task"\n---', template.name, template)
    template.items[0].text = "Later template edit"
    source = updateChecklistModule(source, "checklist1", (c) => ({ ...c, items: c.items.map((i) => ({ ...i, checked: true })) }))
    const nextDay = parseTimeline(blockFromSkeleton("2026-10-23", skeletonFromSource(source)))
    expect(nextDay.checklists?.[0].items[0]).toMatchObject({ text: "Original", indent: "  ", checked: false })
  })
  it("rejects malformed or duplicate module identities without guessing a write target", () => {
    const invalid = 'checklist: {"id":"checklist1","title":"Bad","items":[{"id":"x","text":"x","checked":"false"}]}\n---'
    expect(parseTimeline(invalid).errors.length).toBeGreaterThan(0)
    const single = addChecklistModule("---", "One")
    const header = single.split("\n").find((l) => l.startsWith("checklist:"))!
    const duplicate = header + "\n" + single
    expect(parseTimeline(duplicate).errors.length).toBeGreaterThan(0)
    expect(() => updateChecklistModule(duplicate, "checklist1", (c) => c)).toThrow()
  })
})

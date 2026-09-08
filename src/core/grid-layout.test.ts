import { describe, expect, it } from "vitest"
import {
  clampItem, compactGrid, compactGridVertically, COMPONENT_SLOT_COLS, defaultComponentSlot, defaultGrid, gridColumns, gridRows, HABITS_EMPTY_ROWS, overlaps, parseLayoutHeader, resolveGrid,
  resolveHorizontalOverlaps, resolveOverlaps, serializeLayoutHeader,
} from "./grid-layout"

describe("parse/serialize layout header", () => {
  it("round-trips grid tokens", () => {
    const items = parseLayoutHeader("text@0,0,6,12 toolbar@6,0,6,3")
    expect(items).toEqual([
      { id: "text", x: 0, y: 0, w: 6, h: 12 },
      { id: "toolbar", x: 6, y: 0, w: 6, h: 3 },
    ])
    expect(serializeLayoutHeader(items!)).toBe("text@0,0,6,12 toolbar@6,0,6,3")
  })

  it("returns null on garbage / old column format", () => {
    expect(parseLayoutHeader("foo bar")).toBeNull()
    expect(parseLayoutHeader("text | toolbar,timeline")).toBeNull()
  })

  it("preserves scroll-canvas columns and dedupes", () => {
    const items = parseLayoutHeader("text@10,0,6,3 text@0,0,6,3")
    expect(items).toHaveLength(1)
    expect(items![0].x).toBe(10)
  })
})

describe("resolveOverlaps (push down)", () => {
  it("pushes overlapping items below", () => {
    const out = resolveOverlaps([
      { id: "toolbar", x: 0, y: 0, w: 6, h: 3 },
      { id: "timeline", x: 0, y: 1, w: 6, h: 10 },
    ])
    expect(out.find((i) => i.id === "timeline")!.y).toBe(3)
  })

  it("leaves non-overlapping items alone", () => {
    const items = [
      { id: "text" as const, x: 0, y: 0, w: 6, h: 5 },
      { id: "toolbar" as const, x: 6, y: 0, w: 6, h: 3 },
    ]
    expect(resolveOverlaps(items)).toEqual(items)
  })
})

describe("resolveGrid", () => {
  it("gives a completely blank block a stable full-width default layout", () => {
    const grid = resolveGrid(null, 0, undefined, 40, [], 2, true)
    const byId = Object.fromEntries(grid.map((item) => [item.id, item]))
    expect(byId.dialog).toMatchObject({ x: 0, y: 0, w: 7, h: 4 })
    expect(byId.toolbar).toMatchObject({ x: 0, y: 4, w: 7, h: 3 })
    expect(byId.stats).toMatchObject({ x: 0, y: 7, w: 7, h: 2 })
    expect(byId.timeline).toMatchObject({ x: 7, y: 0, w: 5, h: 40 })
    for (let i = 0; i < grid.length; i++) {
      for (let j = i + 1; j < grid.length; j++) expect(overlaps(grid[i], grid[j])).toBe(false)
    }
  })

  it("default with text: two halves, rail stacked", () => {
    const grid = resolveGrid(null, 1, undefined, 40)
    expect(grid.find((i) => i.id === "text")).toMatchObject({ x: 0, w: 6 })
    expect(grid.find((i) => i.id === "toolbar")).toMatchObject({ x: 6, y: 0 })
    expect(grid.find((i) => i.id === "timeline")).toMatchObject({ x: 6, y: 3 })
  })

  it("appends missing slots below existing content", () => {
    const grid = resolveGrid(parseLayoutHeader("timeline@0,0,12,20"), 0, undefined, 40)
    const toolbar = grid.find((i) => i.id === "toolbar")!
    expect(toolbar.y).toBeGreaterThanOrEqual(20)
    expect(grid.flatMap((i) => i.id).sort()).toEqual(["dialog", "stats", "timeline", "toolbar"])
  })

  it("drops text when the block has no text section", () => {
    const grid = resolveGrid(parseLayoutHeader("text@0,0,6,10 toolbar@6,0,6,3"), 0, undefined, 40)
    expect(grid.find((i) => i.id === "text")).toBeUndefined()
  })
})

describe("optional habit and todo components", () => {
  it("keeps an empty habit component to one prospective item row", () => {
    expect(HABITS_EMPTY_ROWS).toBe(4)
  })

  it("adds requested optional slots without making them mandatory for every block", () => {
    const ordinary = resolveGrid(null, 0, undefined, 20)
    expect(ordinary.some((item) => item.id === "habits" || item.id === "todos")).toBe(false)

    const enriched = resolveGrid(null, 0, undefined, 20, [], 1, false, [
      { id: "habits", x: 0, y: 0, w: 7, h: HABITS_EMPTY_ROWS },
      { id: "todos", x: 0, y: 0, w: 7, h: 8 },
    ])
    expect(enriched.filter((item) => ["habits", "todos"].includes(item.id)).map((item) => item.id)).toEqual([
      "habits", "todos",
    ])
  })

  it("adds a daily quote only when the block requests that optional component", () => {
    const ordinary = resolveGrid(null, 0, undefined, 20)
    expect(ordinary.some((item) => item.id === "quote")).toBe(false)

    const withQuote = resolveGrid(null, 0, undefined, 20, [], 1, false, [
      { id: "quote", x: 0, y: 0, w: 7, h: 8 },
    ])
    expect(withQuote.find((item) => item.id === "quote")).toMatchObject({ w: 7, h: 8 })
  })

  it("lands default components in the text column beside the timeline, not below it", () => {
    // Text/stats/dialog occupy columns 0-5, the toolbar/timeline rail 6-11.
    // A component wider than six columns would collide with the rail and be
    // pushed under a ~45-row timeline, leaving the left column empty.
    expect(COMPONENT_SLOT_COLS).toBe(6)
    const items = resolveGrid(null, 1, undefined, 45, [], 1, false, [
      defaultComponentSlot("habits", HABITS_EMPTY_ROWS),
      defaultComponentSlot("todos", 5),
      defaultComponentSlot("quote", 8),
    ])
    const timeline = items.find((item) => item.id === "timeline")!
    expect(timeline).toMatchObject({ x: 6, w: 6 })
    for (const id of ["habits", "todos", "quote"]) {
      const slot = items.find((item) => item.id === id)!
      expect(slot.x + slot.w).toBeLessThanOrEqual(timeline.x)
      expect(slot.y + slot.h).toBeLessThanOrEqual(timeline.y + timeline.h)
    }
    expect(gridRows(items)).toBe(timeline.y + timeline.h)
  })

  it("mirrors the component column when the rail is on the left", () => {
    const items = resolveGrid(null, 1, "left", 45, [], 1, false, [
      defaultComponentSlot("habits", HABITS_EMPTY_ROWS, "left"),
    ])
    const timeline = items.find((item) => item.id === "timeline")!
    const habits = items.find((item) => item.id === "habits")!
    expect(timeline).toMatchObject({ x: 0, w: 6 })
    expect(habits.x).toBeGreaterThanOrEqual(timeline.x + timeline.w)
    expect(habits.y + habits.h).toBeLessThanOrEqual(timeline.y + timeline.h)
  })
})

describe("grid helpers", () => {
  it("overlaps / clampItem / gridRows", () => {
    expect(overlaps({ id: "text", x: 0, y: 0, w: 2, h: 2 }, { id: "stats", x: 1, y: 1, w: 2, h: 2 })).toBe(true)
    expect(clampItem({ id: "text", x: -1, y: -1, w: 99, h: 0 })).toMatchObject({ x: 0, y: 0, w: 99, h: 1 })
    expect(gridRows(defaultGrid(1, undefined, 40))).toBeGreaterThan(40)
  })

  it("derives a wider canvas from items beyond the base 12 columns", () => {
    expect(gridColumns([
      { id: "toolbar", x: 0, y: 0, w: 8, h: 3 },
      { id: "timeline", x: 8, y: 0, w: 6, h: 20 },
    ])).toBe(14)
  })

  it("keeps side-by-side items on the same row when one grows", () => {
    const out = resolveHorizontalOverlaps([
      { id: "toolbar", x: 0, y: 0, w: 8, h: 3 },
      { id: "timeline", x: 6, y: 0, w: 6, h: 20 },
    ], "toolbar")
    expect(out.find((i) => i.id === "toolbar")).toMatchObject({ x: 0, y: 0, w: 8 })
    expect(out.find((i) => i.id === "timeline")).toMatchObject({ x: 8, y: 0, w: 6 })
  })
})

describe("compactGrid (重力压实)", () => {
  it("falls items up to remove top gaps", () => {
    const out = compactGrid([
      { id: "toolbar", x: 0, y: 5, w: 12, h: 2 },
      { id: "timeline", x: 0, y: 7, w: 12, h: 10 },
    ])
    expect(out.find((i) => i.id === "toolbar")!.y).toBe(0)
    expect(out.find((i) => i.id === "timeline")!.y).toBe(2)
  })

  it("anchor stays put, others compact around it", () => {
    const out = compactGrid(
      [
        { id: "toolbar", x: 0, y: 5, w: 12, h: 2 },
        { id: "timeline", x: 0, y: 0, w: 12, h: 10 },
      ],
      "toolbar"
    )
    expect(out.find((i) => i.id === "toolbar")!.y).toBe(5)
    expect(out.find((i) => i.id === "timeline")!.y).toBe(7) // 被顶到 anchor 下面
  })

  it("slides left after falling up", () => {
    const out = compactGrid([{ id: "stats", x: 6, y: 0, w: 6, h: 1 }])
    expect(out[0].x).toBe(0)
  })
})

describe("compactGridVertically (移动时保留列)", () => {
  it("keeps the timeline column stable while Stats moves below it", () => {
    const out = compactGridVertically([
      { id: "stats", x: 6, y: 10, w: 6, h: 4 },
      { id: "toolbar", x: 0, y: 4, w: 6, h: 3 },
      { id: "dialog", x: 0, y: 7, w: 6, h: 4 },
      { id: "timeline", x: 6, y: 0, w: 6, h: 10 },
    ], "stats")

    expect(out.find((item) => item.id === "timeline")).toMatchObject({ x: 6, y: 0 })
    expect(out.find((item) => item.id === "stats")).toMatchObject({ x: 6, y: 10 })
    expect(out.find((item) => item.id === "toolbar")).toMatchObject({ x: 0, y: 0 })
    expect(out.find((item) => item.id === "dialog")).toMatchObject({ x: 0, y: 3 })
  })
})

describe("resolveGrid with hiddenSlots", () => {
  it("drops hidden slots and does not re-append them", () => {
    const grid = resolveGrid(null, 0, undefined, 40, ["stats", "dialog"])
    const ids = grid.map((i) => i.id)
    expect(ids).toContain("toolbar")
    expect(ids).toContain("timeline")
    expect(ids).not.toContain("stats")
    expect(ids).not.toContain("dialog")
  })
})

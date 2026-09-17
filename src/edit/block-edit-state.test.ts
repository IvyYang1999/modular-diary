import { describe, expect, it } from "vitest"
import { sameBlock, type BlockIdentity } from "./block-edit-state"

describe("timeline edit state ownership", () => {
  it("does not freeze another Modular Diary block in the same note", () => {
    const owner = {}
    const first: BlockIdentity<object> = { owner, path: "day.md", blockOrdinal: 0 }
    const second: BlockIdentity<object> = { owner, path: "day.md", blockOrdinal: 1 }

    expect(sameBlock(first, first)).toBe(true)
    expect(sameBlock(first, second)).toBe(false)
  })

  it("does not leak selection between two panes showing the same note", () => {
    const left: BlockIdentity<object> = { owner: {}, path: "day.md", blockOrdinal: 0 }
    const right: BlockIdentity<object> = { owner: {}, path: "day.md", blockOrdinal: 0 }

    expect(sameBlock(left, right)).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { laneLayout } from "./period-lanes"

const e = (start: number, end: number, plan = false) => ({ startMin: start * 60, endMin: end * 60, plan })

describe("laneLayout", () => {
  it("puts overlapping blocks side by side and widens into free lanes", () => {
    const a = e(9, 11), b = e(9.5, 10.5), c = e(10, 12), d = e(10.25, 10.75)
    const lanes = laneLayout([a, b, c, d])
    expect(lanes.get(a)).toEqual({ lane: 0, lanes: 4, span: 1 })
    expect(lanes.get(c)).toEqual({ lane: 2, lanes: 4, span: 1 })
    // D starts in lane 3 and nothing else uses lane 3, so it keeps one lane.
    expect(lanes.get(d)).toEqual({ lane: 3, lanes: 4, span: 1 })
  })
  it("lets a block widen when the lanes to its right are free for its whole span", () => {
    const a = e(9, 10), b = e(9, 9.5), c = e(9, 9.5), late = e(9.5, 10)
    const lanes = laneLayout([a, b, c, late])
    // `late` reuses lane 1 after b ends and lane 2 is free from 9:30 on.
    expect(lanes.get(late)).toEqual({ lane: 1, lanes: 3, span: 2 })
  })
  it("lays out plans apart from actual blocks", () => {
    const plan1 = e(17, 18, true), plan2 = e(17.5, 18.5, true), actual = e(17, 18)
    const lanes = laneLayout([plan1, plan2, actual])
    expect(lanes.get(actual)).toEqual({ lane: 0, lanes: 1, span: 1 })
    expect(lanes.get(plan2)).toEqual({ lane: 1, lanes: 2, span: 1 })
  })
})

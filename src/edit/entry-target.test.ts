import { describe, expect, it } from "vitest"
import type { Annotation, Entry } from "../core/types"
import {
  captureEntryTarget,
  captureMarkerTarget,
  resolveEntryTarget,
  resolveMarkerTarget,
} from "./entry-target"

function entry(line: number, type: string, startMin = 600): Entry {
  return { line, type, startMin, endMin: startMin + 30, plan: false, tags: [] }
}

describe("timeline entry identity", () => {
  it("keeps a note save attached to the same entry after an earlier insertion shifts source lines", () => {
    const original = entry(8, "开发", 600)
    const target = captureEntryTarget(original)
    const shifted = { ...original, line: 9 }

    expect(resolveEntryTarget([entry(8, "生活", 540), shifted], target)).toBe(shifted)
  })

  it("fails closed instead of guessing between duplicate entries after their line moves", () => {
    const original = entry(8, "开发", 600)
    const target = captureEntryTarget(original)

    expect(resolveEntryTarget([
      { ...original, line: 9 },
      { ...original, line: 10 },
    ], target)).toBeNull()
  })

  it("keeps a time-point edit attached to the same marker after line drift", () => {
    const original: Annotation = { line: 4, timeMin: 720, type: "ddl", text: "交论文", plan: false }
    const target = captureMarkerTarget(original)
    const shifted = { ...original, line: 6 }

    expect(resolveMarkerTarget([
      { line: 4, timeMin: 700, type: "起床", text: "", plan: false },
      shifted,
    ], target)).toBe(shifted)
  })
})

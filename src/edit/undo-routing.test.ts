import { describe, expect, it } from "vitest"
import { isEditingSurfaceTarget, nativeControlOwnsTimelineDelete, routeMarkdownUndo, shouldLeaveUndoToFocusedEditor } from "./undo-routing"

function targetMatching(match: boolean) {
  return { closest: () => (match ? ({} as Element) : null) }
}

function nestedTarget(matches: string[]) {
  return {
    closest: (selector: string) => matches.some((value) => selector.includes(value))
      ? ({} as Element)
      : null,
  }
}

describe("undo routing", () => {
  it("leaves undo to a focused text editor", () => {
    expect(shouldLeaveUndoToFocusedEditor(targetMatching(true))).toBe(true)
    expect(isEditingSurfaceTarget(targetMatching(true))).toBe(true)
  })

  it("routes rendered controls such as timeline SVG blocks to Markdown undo", () => {
    expect(shouldLeaveUndoToFocusedEditor(targetMatching(false))).toBe(false)
    expect(isEditingSurfaceTarget(targetMatching(false))).toBe(false)
    expect(shouldLeaveUndoToFocusedEditor(null)).toBe(false)
  })

  it("routes an Modular Diary widget nested inside CodeMirror back to Markdown undo", () => {
    const target = nestedTarget([".cm-content", ".modular-diary-container"])

    expect(shouldLeaveUndoToFocusedEditor(target)).toBe(false)
    expect(isEditingSurfaceTarget(target)).toBe(false)
  })

  it("keeps native controls inside an Modular Diary widget on their own undo stack", () => {
    const target = nestedTarget(["input", ".cm-content", ".modular-diary-container"])

    expect(shouldLeaveUndoToFocusedEditor(target)).toBe(true)
    expect(isEditingSurfaceTarget(target)).toBe(true)
  })

  it("does not mistake retained CodeMirror focus for an active native editor", () => {
    expect(nativeControlOwnsTimelineDelete(nestedTarget([".cm-content"]))).toBe(false)
    expect(nativeControlOwnsTimelineDelete(nestedTarget(["input", ".cm-content"]))).toBe(true)
    expect(nativeControlOwnsTimelineDelete(nestedTarget(["textarea", ".cm-content"]))).toBe(true)
  })

  it("immediately undoes a timeline write when focus remains on rendered Modular Diary chrome", () => {
    const calls: string[] = []
    const event = {
      key: "z", metaKey: true, ctrlKey: false, shiftKey: false,
      target: nestedTarget([".cm-content", ".modular-diary-container"]),
      preventDefault: () => calls.push("prevent"),
      stopPropagation: () => calls.push("stop"),
    }

    expect(routeMarkdownUndo(event, () => ({
      undo: () => calls.push("undo"),
      redo: () => calls.push("redo"),
    }))).toBe(true)
    expect(calls).toEqual(["prevent", "stop", "undo"])
  })
})

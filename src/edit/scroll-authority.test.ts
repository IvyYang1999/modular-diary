import { describe, expect, it } from "vitest"
import { transactionScrollSnapshot } from "./scroll-authority"

describe("transactionScrollSnapshot", () => {
  const snapshot = {
    internal: { blockTop: 17 },
    viewport: { top: 240 },
  }

  it("keeps the DOM anchor by default, even for CodeMirror-backed writes", () => {
    expect(transactionScrollSnapshot(snapshot, true)).toBe(snapshot)
    expect(transactionScrollSnapshot(snapshot, true, "dom")).toBe(snapshot)
  })

  it("hands the outer viewport to CodeMirror only when asked", () => {
    const result = transactionScrollSnapshot(snapshot, true, "codemirror")
    expect(result.internal).toBe(snapshot.internal)
    expect(result.viewport).toBeNull()
  })

  it("keeps the DOM anchor when CodeMirror is unavailable", () => {
    expect(transactionScrollSnapshot(snapshot, false)).toBe(snapshot)
  })
})

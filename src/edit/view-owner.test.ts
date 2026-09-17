import { describe, expect, it } from "vitest"
import { chooseMutationView, findOwningView, resolvePersistedOwnerView, resolveTransactionOwner } from "./view-owner"

interface Candidate {
  id: string
  file: { path: string } | null
  containerEl: { contains(target: object): boolean }
}

function candidate(id: string, path: string, ownedTarget?: object): Candidate {
  return {
    id,
    file: { path },
    containerEl: { contains: (target) => target === ownedTarget },
  }
}

describe("Markdown view ownership", () => {
  it("selects the pane that actually contains the Modular Diary block", () => {
    const target = {}
    const left = candidate("left", "daily.md")
    const right = candidate("right", "daily.md", target)

    expect(findOwningView("daily.md", target, [left, right])).toBe(right)
    expect(chooseMutationView("daily.md", target, [left, right], left)).toBe(right)
  })

  it("never picks the first same-path pane when DOM ownership is ambiguous", () => {
    const target = {}
    const left = candidate("left", "daily.md")
    const right = candidate("right", "daily.md")

    expect(findOwningView("daily.md", target, [left, right])).toBeNull()
    expect(chooseMutationView("daily.md", target, [left, right], null)).toBeNull()
  })

  it("fails closed even when one of several same-path panes is active", () => {
    const target = {}
    const left = candidate("left", "daily.md")
    const right = candidate("right", "daily.md")

    expect(chooseMutationView("daily.md", target, [left, right], right)).toBeNull()
  })

  it("uses a sole matching pane when no active pane is available", () => {
    const target = {}
    const only = candidate("only", "daily.md")
    const other = candidate("other", "other.md")

    expect(chooseMutationView("daily.md", target, [other, only], null)).toBe(only)
  })

  it("keeps the chosen sole pane as owner after the initiating DOM detaches", () => {
    const target = {}
    const only = candidate("only", "daily.md")
    const chosen = chooseMutationView("daily.md", target, [only], null)

    expect(resolveTransactionOwner(null, chosen, { id: "fallback" } as Candidate)).toBe(only)
  })

  it("uses distinct fallback tokens when detached DOM has no proven pane", () => {
    const first = { id: "doc-a" }
    const second = { id: "doc-b" }

    expect(resolveTransactionOwner(null, null, first)).toBe(first)
    expect(resolveTransactionOwner(null, null, second)).toBe(second)
    expect(first).not.toBe(second)
  })

  it("accepts the sole replacement pane after Obsidian rebuilds a view", () => {
    const oldOwner = candidate("old", "daily.md")
    const replacement = candidate("replacement", "daily.md")

    expect(resolvePersistedOwnerView(oldOwner, [replacement])).toBe(replacement)
  })

  it("keeps a deferred save attached to a stable pane token across view replacement", () => {
    const pane = {}
    const replacement = { ...candidate("replacement", "daily.md"), pane }

    expect(resolvePersistedOwnerView(pane, [replacement], (view) => view.pane)).toBe(replacement)
  })

  it("does not redirect a deferred save when several panes are open", () => {
    const oldOwner = candidate("old", "daily.md")
    const left = candidate("left", "daily.md")
    const right = candidate("right", "daily.md")

    expect(resolvePersistedOwnerView(oldOwner, [left, right])).toBeNull()
  })
})

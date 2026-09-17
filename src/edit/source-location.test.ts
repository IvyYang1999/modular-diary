import { describe, expect, it } from "vitest"
import { resolveTimelineSource } from "./source-location"

const block = (s: string) => `\`\`\`timeline\n${s}\n\`\`\``
describe("deferred timeline save location", () => {
  it("recovers a missing processor section from unique source", () => {
    expect(resolveTimelineSource(`heading\n${block('08:00-09:00 work')}`, '08:00-09:00 work', null))
      .toMatchObject({ lineStart: 1, lineEnd: 3, source: '08:00-09:00 work' })
  })
  it("follows the original block after an earlier block is inserted", () => {
    expect(resolveTimelineSource(`${block('other')}\n${block('original')}`, 'original', { lineStart: 0, lineEnd: 2 }))
      .toMatchObject({ lineStart: 3, source: 'original' })
  })
  it("rejects a deleted or externally changed block instead of writing its replacement", () => {
    expect(resolveTimelineSource(block('replacement'), 'original', { lineStart: 0, lineEnd: 2 })).toBeNull()
  })
  it("does not guess between duplicate blocks when its section is lost", () => {
    expect(resolveTimelineSource(`${block('same')}\n${block('same')}`, 'same', null)).toBeNull()
    expect(resolveTimelineSource(`${block('same')}\n${block('same')}`, 'same', { lineStart: 3, lineEnd: 5 })?.lineStart).toBe(3)
  })
  it("ignores one renderer newline but preserves meaningful text whitespace", () => {
    expect(resolveTimelineSource(block('original'), 'original\n', null)).not.toBeNull()
    expect(resolveTimelineSource(block('original '), 'original', null)).toBeNull()
  })
})

it("never recovers a block from inside a literal code example", () => {
  const example = '````markdown\n```timeline\noriginal\n```\n````'
  expect(resolveTimelineSource(example, 'original', null)).toBeNull()
})

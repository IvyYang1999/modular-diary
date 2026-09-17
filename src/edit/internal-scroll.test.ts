import { describe, expect, it } from "vitest"
import { captureInternalScroll, restoreInternalScroll, stabilizeInternalScroll } from "./internal-scroll"

interface FakeScroller {
  scrollTop: number
  scrollLeft: number
}

interface FakeSlot extends FakeScroller {
  dataset: { slot: string }
  pane: FakeScroller
  querySelector(selector: string): FakeScroller | null
}

function slot(id: string, top: number, left: number): FakeSlot {
  const pane = { scrollTop: top, scrollLeft: left }
  return {
    dataset: { slot: id },
    pane,
    scrollTop: 0,
    scrollLeft: 0,
    querySelector: (selector) => selector === ".modular-diary-text-pane" ? pane : null,
  }
}

function container(
  block: FakeScroller,
  timeline: FakeScroller,
  slots: FakeSlot[]
): HTMLElement {
  return {
    querySelector: (selector: string) => {
      if (selector === ".modular-diary-block-scroll") return block
      if (selector === ".modular-diary-svg-holder") return timeline
      return null
    },
    querySelectorAll: (selector: string) => selector === ".modular-diary-slot" ? slots : [],
  } as unknown as HTMLElement
}

describe("timeline internal scroll", () => {
  it("restores block, timeline and text scrollers by stable slot id", () => {
    const oldBlock = { scrollTop: 310, scrollLeft: 120 }
    const oldTimeline = { scrollTop: 490, scrollLeft: 35 }
    const oldText = slot("text", 88, 7)
    const oldText2 = slot("text2", 155, 12)
    const snapshot = captureInternalScroll(container(oldBlock, oldTimeline, [oldText, oldText2]))

    const newBlock = { scrollTop: 0, scrollLeft: 0 }
    const newTimeline = { scrollTop: 0, scrollLeft: 0 }
    const newText2 = slot("text2", 0, 0)
    const newText = slot("text", 0, 0)
    restoreInternalScroll(snapshot, container(newBlock, newTimeline, [newText2, newText]))

    expect(newBlock).toEqual(oldBlock)
    expect(newTimeline).toEqual(oldTimeline)
    expect(newText.pane).toEqual(oldText.pane)
    expect(newText2.pane).toEqual(oldText2.pane)
  })

  it("restores the timeline again after its remounted scroll range becomes measurable", () => {
    const callbacks: FrameRequestCallback[] = []
    let measurable = false
    let timelineTop = 0
    const timeline = {
      scrollLeft: 0,
      get scrollTop() { return timelineTop },
      set scrollTop(value: number) { timelineTop = measurable ? value : 0 },
    }
    const target = container({ scrollTop: 0, scrollLeft: 0 }, timeline, [])
    Object.assign(target, {
      isConnected: true,
      ownerDocument: {
        defaultView: {
          requestAnimationFrame: (callback: FrameRequestCallback) => {
            callbacks.push(callback)
            return callbacks.length
          },
          cancelAnimationFrame: () => undefined,
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })

    stabilizeInternalScroll({
      block: null,
      timeline: { top: 490, left: 0 },
      texts: {},
    }, target, 2)

    expect(timeline.scrollTop).toBe(0)
    measurable = true
    callbacks.shift()?.(0)
    expect(timeline.scrollTop).toBe(490)
  })
})

import { describe, expect, it } from "vitest"
import { parseTimeline } from "../core/parser"
import { extractJson, interpretActions, interpretResponse, interpretResponses } from "./response"

const DOC = parseTimeline("range: 7-23\n---\n09:00-10:00 math\n")

describe("extractJson", () => {
  it("extracts bare JSON and fenced JSON", () => {
    expect(extractJson('{"start":"10:00","end":"10:30","type":"math"}')).toBeTruthy()
    expect(extractJson('当然！```json\n{"start":"10:00","end":"10:30","type":"math"}\n```')).toBeTruthy()
    expect(extractJson("没有 json")).toBeNull()
  })
})

describe("interpretResponse", () => {
  it("validates a good entry and produces a canonical source line", () => {
    const r = interpretResponse('{"start":"10:00","end":"10:30","type":"fitness","note":"健身"}', DOC)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.entry.sourceLine).toBe("10:00-10:30 fitness 健身")
  })

  it("passes through agent error as reason", () => {
    const r = interpretResponse('{"error":"几点开始的呢？"}', DOC)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("几点开始的呢？")
  })

  it("allows overlap with existing actual entries (并列日程)", () => {
    const r = interpretResponse('{"start":"09:30","end":"10:30","type":"misc"}', DOC)
    expect(r.ok).toBe(true)
  })

  it("rejects bad time format and tiny durations", () => {
    expect(interpretResponse('{"start":"十点","end":"10:30","type":"misc"}', DOC).ok).toBe(false)
    expect(interpretResponse('{"start":"10:00","end":"10:02","type":"misc"}', DOC).ok).toBe(false)
  })

  it("writes cross-midnight entries back in plain 24h (D10)", () => {
    const r = interpretResponse('{"start":"23:30","end":"00:30","type":"reading"}', DOC)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entry.startMin).toBe(23 * 60 + 30)
      expect(r.entry.endMin).toBe(24 * 60 + 30)
      expect(r.entry.sourceLine).toBe("23:30-00:30 reading")
    }
  })

  it("resolves an unqualified 02:30 range to the only same-day candidate inside a 07:00 timeline", () => {
    const r = interpretResponse(
      '{"start":"02:30","end":"03:15","type":"装修","note":"安装吹风机支架"}',
      DOC,
      "2：30~3：15装修"
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entry.startMin).toBe(14 * 60 + 30)
      expect(r.entry.endMin).toBe(15 * 60 + 15)
      expect(r.entry.endMin - r.entry.startMin).toBe(45)
      expect(r.entry.sourceLine).toBe("14:30-15:15 装修 安装吹风机支架")
    }
  })

  it("keeps an explicitly early-morning range on the next-day portion", () => {
    const r = interpretResponse(
      '{"start":"02:30","end":"03:15","type":"装修"}',
      DOC,
      "凌晨2:30到3:15装修"
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect([r.entry.startMin, r.entry.endMin]).toEqual([26 * 60 + 30, 27 * 60 + 15])
  })

  it("normalizes an explicitly afternoon range even if the model returns 12-hour clocks", () => {
    const r = interpretResponse(
      '{"start":"02:30","end":"03:15","type":"装修"}',
      DOC,
      "下午2:30至3:15装修"
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect([r.entry.startMin, r.entry.endMin]).toEqual([14 * 60 + 30, 15 * 60 + 15])
  })
})

describe("interpretResponses (一句话多个色块)", () => {
  it("accepts an array and sorts by start time", () => {
    const r = interpretResponses(
      '[{"start":"10:00","end":"11:00","type":"fitness","note":"健身"},{"start":"09:00","end":"10:00","type":"math"}]',
      DOC
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entries).toHaveLength(2)
      expect(r.entries[0].startMin).toBe(9 * 60) // 排过序
    }
  })

  it("single object still works", () => {
    const r = interpretResponses('{"start":"10:00","end":"10:30","type":"math"}', DOC)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.entries).toHaveLength(1)
  })

  it("any invalid item fails the whole batch", () => {
    const r = interpretResponses('[{"start":"10:00","end":"11:00","type":"math"},{"start":"bad","end":"11:00","type":"math"}]', DOC)
    expect(r.ok).toBe(false)
  })
})

describe("interpretActions (编辑已有色块)", () => {
  const DOC2 = parseTimeline("09:00-10:00 math 行列式\n10:00-11:00 fitness 健身")

  it("update with partial patch", () => {
    const r = interpretActions('{"action":"update","target":2,"end":"11:30"}', DOC2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toEqual({ kind: "update", targetIndex: 1, patch: { endMin: 690 } })
  })

  it("delete", () => {
    const r = interpretActions('{"action":"delete","target":1}', DOC2)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.actions[0]).toEqual({ kind: "delete", targetIndex: 0 })
  })

  it("mixed array: create + update", () => {
    const r = interpretActions('[{"start":"12:00","end":"13:00","type":"meal"},{"action":"update","target":1,"note":"改备注"}]', DOC2)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.actions[0].kind).toBe("create")
      expect(r.actions[1]).toMatchObject({ kind: "update", targetIndex: 0 })
    }
  })

  it("uses the original sentence to disambiguate a created 12-hour range", () => {
    const r = interpretActions(
      '{"start":"02:30","end":"03:15","type":"装修","note":"安装吹风机支架"}',
      DOC,
      "2：30~3：15装修"
    )
    expect(r.ok).toBe(true)
    if (r.ok && r.actions[0]?.kind === "create") {
      expect(r.actions[0].entry.sourceLine).toBe("14:30-15:15 装修 安装吹风机支架")
    }
  })

  it("target out of range fails", () => {
    expect(interpretActions('{"action":"delete","target":9}', DOC2).ok).toBe(false)
  })

  it("update with empty patch fails", () => {
    expect(interpretActions('{"action":"update","target":1}', DOC2).ok).toBe(false)
  })
})

describe("interpretActions (schedule: future items)", () => {
  const doc = parseTimeline("date: 2026-10-26\n---\n09:00-10:00 math")
  it("accepts a dated item with a part of the day, a timed item with a category, and rejects bad dates", () => {
    const zoned = interpretActions('{"action":"schedule","date":"2026-11-04","zone":"下午","text":"去银行办卡"}', doc)
    expect(zoned).toEqual({ ok: true, actions: [{ kind: "schedule", date: "2026-11-04", zone: "pm", text: "去银行办卡" }] })
    const timed = interpretActions('{"action":"schedule","date":"2026-11-06","start":"14:00","end":"14:30","type":"math","text":"去某地"}', doc)
    expect(timed).toEqual({ ok: true, actions: [{ kind: "schedule", date: "2026-11-06", startMin: 840, endMin: 870, type: "math", text: "去某地" }] })
    expect(interpretActions('{"action":"schedule","date":"2026-02-30","text":"x"}', doc).ok).toBe(false)
    expect(interpretActions('{"action":"schedule","date":"2026-11-06","start":"14:00","end":"14:30","text":"x"}', doc).ok).toBe(false)
    // Mixed with a block for today.
    const mixed = interpretActions('[{"start":"09:00","end":"09:30","type":"math"},{"action":"schedule","date":"2026-11-06","text":"交房租"}]', doc)
    expect(mixed.ok && mixed.actions.map((a) => a.kind)).toEqual(["create", "schedule"])
  })
})

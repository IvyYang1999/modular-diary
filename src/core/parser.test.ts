import { describe, expect, it } from "vitest"
import { parseTimeline } from "./parser"
import { t } from "../i18n"

describe("parseTimeline", () => {
  it("parses a full sample with header, entries, plan and annotation", () => {
    const doc = parseTimeline([
      "date: 2026-08-18",
      "range: 7-23",
      "---",
      "plan 08:00-09:30 math 线代第一章",
      "09:15-12:15 math 李林线代第一章·行列式",
      "12:15-13:30 sleep 午休",
      "@21:40 头晕，脑力低",
    ].join("\n"))

    expect(doc.errors).toEqual([])
    expect(doc.date).toBe("2026-08-18")
    expect(doc.rangeStart).toBe(7 * 60)
    expect(doc.entries).toHaveLength(3)
    expect(doc.entries[0]).toMatchObject({ plan: true, startMin: 480, endMin: 570, type: "math", note: "线代第一章" })
    expect(doc.entries[1]).toMatchObject({ plan: false, startMin: 555, endMin: 735, note: "李林线代第一章·行列式" })
    expect(doc.entries[2]).toMatchObject({ type: "sleep" })
    expect(doc.annotations).toEqual([{ timeMin: 21 * 60 + 40, text: "头晕，脑力低", line: 6 }])
  })

  it("works without header and separator", () => {
    const doc = parseTimeline("09:00-10:00 math")
    expect(doc.entries).toHaveLength(1)
    expect(doc.rangeStart).toBe(7 * 60)
    expect(doc.rangeEnd).toBe(23 * 60)
  })

  it("parses categorized actual and plan time markers without changing legacy annotations", () => {
    const doc = parseTimeline([
      "range: 7-23",
      "---",
      "@10:00 [起床] 正式起床",
      "plan @22:00 [论文] ddl",
      "@21:40 旧式备注",
    ].join("\n"))

    expect(doc.annotations).toEqual([
      { timeMin: 10 * 60, text: "正式起床", line: 2, type: "起床", plan: false },
      { timeMin: 22 * 60, text: "ddl", line: 3, type: "论文", plan: true },
      { timeMin: 21 * 60 + 40, text: "旧式备注", line: 4 },
    ])
  })

  it("keeps same-time markers as separate source-ordered records", () => {
    const doc = parseTimeline("@10:00 [起床] 起床\n@10:00 [会议] 站会")
    expect(doc.annotations.map((marker) => [marker.line, marker.type, marker.timeMin])).toEqual([
      [0, "起床", 10 * 60],
      [1, "会议", 10 * 60],
    ])
  })

  it("ignores blank lines and # comments", () => {
    const doc = parseTimeline("\n# comment\n09:00-10:00 math\n\n")
    expect(doc.errors).toEqual([])
    expect(doc.entries).toHaveLength(1)
  })

  it("rejects bad date and unknown header keys", () => {
    const doc = parseTimeline("date: 8.18\nfoo: bar\n---\n09:00-10:00 math")
    expect(doc.errors).toHaveLength(2)
    expect(doc.errors[0].reason).toContain("YYYY-MM-DD")
    expect(doc.errors[1].reason).toBe(t("unknownHeaderKey", { key: "foo" }))
  })

  it("recovers a narrowly misspelled layout header without losing saved geometry", () => {
    const doc = parseTimeline([
      "layoiiut: todos@0,27,7,17 timeline@7,0,5,44 toolbar@0,3,7,10",
      "---",
      "09:00-10:00 math",
    ].join("\n"))

    expect(doc.errors).toEqual([])
    expect(doc.layout).toEqual([
      { id: "todos", x: 0, y: 27, w: 7, h: 17 },
      { id: "timeline", x: 7, y: 0, w: 5, h: 44 },
      { id: "toolbar", x: 0, y: 3, w: 7, h: 10 },
    ])
  })

  it("does not reinterpret arbitrary unknown headers as layout", () => {
    const doc = parseTimeline("custom: timeline@7,0,5,44\n---\n09:00-10:00 math")
    expect(doc.layout).toBeUndefined()
    expect(doc.errors).toHaveLength(1)
    expect(doc.errors[0].reason).toBe(t("unknownHeaderKey", { key: "custom" }))
  })

  it("rejects invalid times and unrecognized lines", () => {
    const doc = parseTimeline("---\n09:75-10:00 math\nhello world")
    expect(doc.errors.map((e) => e.reason)).toEqual([t("invalidTime"), t("unrecognizedLine")])
  })

  it("accepts dashed variants as separator between times", () => {
    const doc = parseTimeline("09:00–10:00 math\n10:00—11:00 micro")
    expect(doc.entries).toHaveLength(2)
  })

  describe("cross-midnight (D10: 过零点算当日，轴自然延伸)", () => {
    it("shifts entries starting before rangeStart to +24h and extends the axis", () => {
      const doc = parseTimeline("range: 7-23\n---\n00:30-01:30 sleep")
      expect(doc.entries[0]).toMatchObject({ startMin: 24 * 60 + 30, endMin: 25 * 60 + 30 })
      expect(doc.rangeEnd).toBe(25 * 60 + 30)
    })

    it("wraps end past midnight when end <= start", () => {
      const doc = parseTimeline("22:00-01:00 reading")
      expect(doc.entries[0]).toMatchObject({ startMin: 22 * 60, endMin: 25 * 60 })
    })

    it("shifts early-morning annotations to +24h", () => {
      const doc = parseTimeline("@01:10 睡不着")
      expect(doc.annotations[0].timeMin).toBe(25 * 60 + 10)
    })

    it("accepts explicit hours > 24 in source", () => {
      const doc = parseTimeline("24:30-25:30 sleep")
      expect(doc.entries[0]).toMatchObject({ startMin: 24 * 60 + 30, endMin: 25 * 60 + 30 })
    })
  })

  it("allows overlapping actual entries (并列日程并排渲染, yyt 2026-08-17)", () => {
    const doc = parseTimeline([
      "plan 08:00-12:00 math",
      "09:00-10:00 math",
      "09:30-11:00 micro",
    ].join("\n"))
    expect(doc.errors).toEqual([])
    expect(doc.entries).toHaveLength(3)
  })
})

describe("hide header (per-block highlighter hiding)", () => {
  it("parses hide: types", () => {
    const doc = parseTimeline("hide: sleep misc\n---\n09:00-10:00 math")
    expect(doc.hiddenTypes).toEqual(["sleep", "misc"])
    expect(doc.errors).toEqual([])
  })

  it("accepts commas and works without separator", () => {
    const doc = parseTimeline("hide: sleep, misc\n09:00-10:00 math")
    expect(doc.hiddenTypes).toEqual(["sleep", "misc"])
  })

  it("rejects hide with empty value", () => {
    const doc = parseTimeline("hide: \n---\n09:00-10:00 math")
    expect(doc.errors).toHaveLength(1)
  })
})

describe("width/float headers (分栏)", () => {
  it("parses width and float", () => {
    const doc = parseTimeline("width: 300\nfloat: right\n---\n09:00-10:00 math")
    expect(doc.width).toBe(300)
    expect(doc.floatRight).toBe(true)
    expect(doc.errors).toEqual([])
  })

  it("rejects bad width", () => {
    const doc = parseTimeline("width: 50\n---\n09:00-10:00 math")
    expect(doc.errors).toHaveLength(1)
  })
})

describe("block viewport headers", () => {
  it("parses a persisted block viewport and fixed internal canvas width", () => {
    const doc = parseTimeline("block-size: 560x420\ncanvas-width: 960\n---\n09:00-10:00 math")
    expect(doc.blockSize).toEqual({ width: 560, height: 420 })
    expect(doc.canvasWidth).toBe(960)
    expect(doc.errors).toEqual([])
  })

  it("rejects unsafe block viewport values", () => {
    const doc = parseTimeline("block-size: 80x40\ncanvas-width: 50\n---\n09:00-10:00 math")
    expect(doc.blockSize).toBeUndefined()
    expect(doc.canvasWidth).toBeUndefined()
    expect(doc.errors).toHaveLength(2)
  })
})

describe("text section (=== 块内图文混排)", () => {
  it("collects everything after === as free text", () => {
    const doc = parseTimeline("09:00-10:00 math\n===\n## 明日 to do\n1. 线代第一章")
    expect(doc.text).toBe("## 明日 to do\n1. 线代第一章")
    expect(doc.entries).toHaveLength(1)
    expect(doc.errors).toEqual([])
  })

  it("text section may contain entry-looking lines without being parsed", () => {
    const doc = parseTimeline("09:00-10:00 math\n===\n12:00-13:00 这行是普通文字")
    expect(doc.entries).toHaveLength(1)
    expect(doc.text).toBe("12:00-13:00 这行是普通文字")
  })

  it("no text section by default", () => {
    expect(parseTimeline("09:00-10:00 math").text).toBeUndefined()
  })
})

describe("unicode type names (中文类型名, yyt 2026-08-17)", () => {
  it("parses Chinese types with notes", () => {
    const doc = parseTimeline("09:00-10:00 数学 行列式\n10:00-11:00 英语")
    expect(doc.errors).toEqual([])
    expect(doc.entries[0]).toMatchObject({ type: "数学", note: "行列式" })
    expect(doc.entries[1]).toMatchObject({ type: "英语", note: undefined })
  })

  it("hide: accepts Chinese types", () => {
    const doc = parseTimeline("hide: 数学 英语\n---\n09:00-10:00 math")
    expect(doc.hiddenTypes).toEqual(["数学", "英语"])
  })
})

describe("ParseOptions default range (设置页默认时间范围)", () => {
  it("uses provided defaults", () => {
    const doc = parseTimeline("09:00-10:00 math", { rangeStart: 0, rangeEnd: 24 * 60 })
    expect(doc.rangeStart).toBe(0)
    expect(doc.rangeEnd).toBe(24 * 60)
  })

  it("range: header still wins over provided defaults", () => {
    const doc = parseTimeline("range: 8-22\n---\n09:00-10:00 math", { rangeStart: 0, rangeEnd: 24 * 60 })
    expect(doc.rangeStart).toBe(8 * 60)
    expect(doc.rangeEnd).toBe(22 * 60)
  })

  it("cross-midnight shift follows the configured range start (0-24 不位移)", () => {
    const doc = parseTimeline("00:30-01:30 sleep", { rangeStart: 0, rangeEnd: 24 * 60 })
    expect(doc.entries[0].startMin).toBe(30) // rangeStart=0 → 不再 +24h
  })
})

describe("off header (组件隐藏)", () => {
  it("parses hideable slot ids, ignores timeline/text", () => {
    const doc = parseTimeline("off: stats dialog habits todos quote timeline foo\n---\n09:00-10:00 math")
    expect(doc.hiddenSlots).toEqual(["stats", "dialog", "habits", "todos", "quote"])
    expect(doc.errors).toEqual([])
  })
})

describe("daily quote metadata", () => {
  it("ignores the retired card-designer headers without reporting errors", () => {
    const doc = parseTimeline([
      "quote: quote-1",
      "quote-text: 我们先塑造习惯，然后习惯塑造我们。",
      "quote-author: John Dryden",
      "quote-theme: midnight",
      "quote-image-zoom: 1.5",
      "---",
      "09:00-10:00 学习",
    ].join("\n"))
    expect(doc.errors).toEqual([])
    expect(doc.entries).toHaveLength(1)
    expect("dailyQuote" in doc).toBe(false)
  })
})

describe("multiple text sections (多文本框)", () => {
  it("parses each === segment into texts[]", () => {
    const doc = parseTimeline("09:00-10:00 math\n===\n上午\n===\n下午")
    expect(doc.texts).toEqual(["上午", "下午"])
    expect(doc.text).toBe("上午")
    expect(doc.entries).toHaveLength(1)
  })
})

describe("habit and todo metadata", () => {
  it("parses todo headers, per-day habit skips, and stable entry bindings", () => {
    const doc = parseTimeline([
      "date: 2026-08-23",
      "habit-skip: walk read",
      "todo: landing|0|90|%E5%BC%80%E5%8F%91|%E5%B7%A5%E4%BD%9C|%E5%AE%8C%E6%88%90%E8%90%BD%E5%9C%B0%E9%A1%B5",
      "---",
      "09:00-09:30 开发 写首屏 [todo:landing]",
    ].join("\n"))
    expect(doc.habitSkips).toEqual(["walk", "read"])
    expect(doc.todos[0]).toMatchObject({ id: "landing", title: "完成落地页", estimateMin: 90, type: "开发" })
    expect(doc.entries[0]).toMatchObject({ note: "写首屏", todoId: "landing" })
    expect(doc.errors).toEqual([])
  })
})

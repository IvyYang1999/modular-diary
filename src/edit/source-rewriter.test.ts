import { describe, expect, it } from "vitest"
import { addHiddenType, convertMarkerToEntry, deleteEntryLine, extractBlockSourceFromContent, insertEntryLine, insertMarkerLine, insertSpanLine, removeHeaderValue, removeHiddenType, removeTextSection, removeTimelineBlockFromContent, replaceBlockInContent, replaceEntryLine, setHeaderValue, setItemBody, setTextSection } from "./source-rewriter"
import { parseTimeline } from "../core/parser"

describe("insertEntryLine", () => {
  it("inserts in time order between existing entries", () => {
    const src = "date: 2026-08-18\n---\n09:00-10:00 math\n13:00-14:00 micro"
    const out = insertEntryLine(src, "11:00-12:00 english 听力", 11 * 60)
    expect(out).toBe("date: 2026-08-18\n---\n09:00-10:00 math\n11:00-12:00 english 听力\n13:00-14:00 micro")
  })

  it("inserts before the first entry when earliest", () => {
    const src = "13:00-14:00 micro"
    const out = insertEntryLine(src, "09:00-10:00 math", 9 * 60)
    expect(out).toBe("09:00-10:00 math\n13:00-14:00 micro")
  })

  it("appends after the last entry, before trailing blank lines", () => {
    const src = "09:00-10:00 math\n\n"
    const out = insertEntryLine(src, "21:00-21:30 fitness", 21 * 60)
    expect(out).toBe("09:00-10:00 math\n21:00-21:30 fitness\n\n")
  })

  it("lands before trailing @annotations when later than all entries", () => {
    const src = "09:00-10:00 math\n@09:30 状态好"
    const out = insertEntryLine(src, "21:00-21:30 fitness", 21 * 60)
    // entries stay grouped; annotation line untouched
    const doc = parseTimeline(out)
    expect(doc.errors).toEqual([])
    expect(doc.entries.map((e) => e.type)).toEqual(["math", "fitness"])
  })

  it("result always re-parses cleanly", () => {
    const src = "range: 7-23\n---\nplan 08:00-12:00 math\n09:00-10:00 math\n"
    const out = insertEntryLine(src, "10:30-11:00 meal", 10 * 60 + 30)
    const doc = parseTimeline(out)
    expect(doc.errors).toEqual([])
    expect(doc.entries).toHaveLength(3)
  })
})

describe("insertMarkerLine", () => {
  it("keeps markers source-ordered by timestamp and before text sections", () => {
    const source = "range: 7-23\n---\n@09:00 [a] A\n@11:00 [b] B\n===\n正文"
    expect(insertMarkerLine(source, "@10:00 [c] C", 10 * 60)).toBe(
      "range: 7-23\n---\n@09:00 [a] A\n@10:00 [c] C\n@11:00 [b] B\n===\n正文"
    )
  })

  it("puts another same-time marker after existing markers at that minute", () => {
    expect(insertMarkerLine("@10:00 [a] A", "@10:00 [b] B", 10 * 60))
      .toBe("@10:00 [a] A\n@10:00 [b] B")
  })
})

describe("convertMarkerToEntry", () => {
  it("replaces one time point with a five-minute block while preserving its semantics", () => {
    const source = "range: 7-23\n---\nplan @16:00 [ddl] 交论文\n==="
    const converted = convertMarkerToEntry(source, 2)

    expect(converted).toBe("range: 7-23\n---\nplan 16:00-16:05 ddl 交论文\n===")
    expect(parseTimeline(converted)).toMatchObject({
      annotations: [],
      entries: [{ plan: true, startMin: 16 * 60, endMin: 16 * 60 + 5, type: "ddl", note: "交论文", line: 2 }],
    })
  })
})

describe("replaceEntryLine / deleteEntryLine", () => {
  const src = "date: 2026-08-18\n---\n09:00-10:00 math\n13:00-14:00 micro"

  it("replaces a line in place", () => {
    const out = replaceEntryLine(src, 2, "09:00-10:30 math 行列式")
    expect(out.split("\n")[2]).toBe("09:00-10:30 math 行列式")
    expect(parseTimeline(out).errors).toEqual([])
  })

  it("deletes a line", () => {
    const out = deleteEntryLine(src, 3)
    expect(out).toBe("date: 2026-08-18\n---\n09:00-10:00 math")
  })

  it("throws on out-of-range line", () => {
    expect(() => deleteEntryLine(src, 99)).toThrow()
  })
})

describe("addHiddenType / removeHiddenType", () => {
  it("adds a hide header when none exists", () => {
    const out = addHiddenType("09:00-10:00 math", "sleep")
    expect(out).toBe("hide: sleep\n09:00-10:00 math")
    expect(parseTimeline(out).hiddenTypes).toEqual(["sleep"])
  })

  it("appends to an existing hide header, idempotently", () => {
    const src = "hide: sleep\n---\n09:00-10:00 math"
    expect(addHiddenType(src, "misc")).toBe("hide: sleep misc\n---\n09:00-10:00 math")
    expect(addHiddenType(src, "sleep")).toBe(src)
  })

  it("removes types and drops the header when empty", () => {
    const src = "hide: sleep misc\n09:00-10:00 math"
    expect(removeHiddenType(src, "misc")).toBe("hide: sleep\n09:00-10:00 math")
    expect(removeHiddenType("hide: sleep\n09:00-10:00 math", "sleep")).toBe("09:00-10:00 math")
  })

  it("remove is a no-op without a hide header", () => {
    expect(removeHiddenType("09:00-10:00 math", "sleep")).toBe("09:00-10:00 math")
  })

  it("stores point-category visibility in an independent header", () => {
    const source = addHiddenType("hide: sleep\n@10:00 [deadline] ddl", "deadline", "marker")
    expect(source).toBe("hide-marker: deadline\nhide: sleep\n@10:00 [deadline] ddl")
    expect(parseTimeline(source).hiddenTypes).toEqual(["sleep"])
    expect(parseTimeline(source).hiddenMarkerTypes).toEqual(["deadline"])
    expect(removeHiddenType(source, "deadline", "marker")).toBe("hide: sleep\n@10:00 [deadline] ddl")
  })
})

describe("setHeaderValue / removeHeaderValue", () => {
  it("inserts before --- when header zone exists", () => {
    expect(setHeaderValue("date: 2026-08-18\n---\n09:00-10:00 math", "width", "300"))
      .toBe("date: 2026-08-18\nwidth: 300\n---\n09:00-10:00 math")
  })

  it("inserts at top without separator", () => {
    expect(setHeaderValue("09:00-10:00 math", "float", "right")).toBe("float: right\n09:00-10:00 math")
  })

  it("updates in place", () => {
    expect(setHeaderValue("width: 200\n---\n09:00-10:00 math", "width", "300")).toBe("width: 300\n---\n09:00-10:00 math")
  })

  it("canonicalizes one recoverable layout typo in place instead of duplicating the header", () => {
    const source = "layoiiut: timeline@7,0,5,44\n---\n09:00-10:00 math"
    const updated = setHeaderValue(source, "layout", "timeline@7,0,5,45")

    expect(updated).toBe("layout: timeline@7,0,5,45\n---\n09:00-10:00 math")
    expect(updated.match(/^layout:/gm)).toHaveLength(1)
    expect(updated).not.toContain("layoiiut:")
  })

  it("updates the block date without changing entries", () => {
    const source = "date: 2026-08-18\n---\n09:00-10:00 math"
    const updated = setHeaderValue(source, "date", "2026-08-24")
    expect(updated).toBe("date: 2026-08-24\n---\n09:00-10:00 math")
    expect(parseTimeline(updated)).toMatchObject({ date: "2026-08-24", entries: [{ type: "math" }] })
  })

  it("removeHeaderValue drops the line, no-op when absent", () => {
    expect(removeHeaderValue("float: right\n09:00-10:00 math", "float")).toBe("09:00-10:00 math")
    expect(removeHeaderValue("09:00-10:00 math", "float")).toBe("09:00-10:00 math")
  })

  it("set then parse round-trips", () => {
    const doc = parseTimeline(setHeaderValue("09:00-10:00 math", "width", "300"))
    expect(doc.width).toBe(300)
    expect(doc.errors).toEqual([])
  })
})

describe("replaceBlockInContent (callout 前缀保留)", () => {
  it("preserves > prefix when the block lives inside a callout", () => {
    const content = [
      "# 日记",
      "> [!timeline|right]",
      "> ```timeline",
      "> 09:00-10:00 math",
      "> ```",
      "正文后续",
    ].join("\n")
    const out = replaceBlockInContent(content, { lineStart: 2, lineEnd: 4 }, "09:00-10:00 math\n11:00-12:00 micro")
    expect(out).toBe([
      "# 日记",
      "> [!timeline|right]",
      "> ```timeline",
      "> 09:00-10:00 math",
      "> 11:00-12:00 micro",
      "> ```",
      "正文后续",
    ].join("\n"))
  })

  it("works prefix-free outside callouts", () => {
    const content = "```timeline\n09:00-10:00 math\n```"
    const out = replaceBlockInContent(content, { lineStart: 0, lineEnd: 2 }, "10:00-11:00 math")
    expect(out).toBe("```timeline\n10:00-11:00 math\n```")
  })
})

describe("removeTimelineBlockFromContent", () => {
  it("removes only the selected timeline fence and preserves adjacent prose", () => {
    const content = [
      "before",
      "```timeline",
      "date: 2026-08-24",
      "---",
      "09:00-10:00 develop",
      "```",
      "after",
    ].join("\n")
    expect(removeTimelineBlockFromContent(content, { lineStart: 1, lineEnd: 5 }))
      .toBe("before\nafter")
  })

  it("preserves a surrounding callout and refuses a stale non-timeline section", () => {
    const content = [
      "> [!note]",
      "> ```timeline",
      "> date: 2026-08-24",
      "> ```",
      "> following text",
    ].join("\n")
    expect(removeTimelineBlockFromContent(content, { lineStart: 1, lineEnd: 3 }))
      .toBe("> [!note]\n> following text")
    expect(removeTimelineBlockFromContent("```js\ncode\n```", { lineStart: 0, lineEnd: 2 }))
      .toBeNull()
  })
})

describe("extractBlockSourceFromContent (从最新笔记读取)", () => {
  it("extracts a nested-callout body including quoted blank lines", () => {
    const content = [
      "> > ```timeline",
      "> > date: 2026-08-21",
      "> > ---",
      "> >",
      "> > ===",
      "> > 第五句",
      "> > ```",
    ].join("\n")
    expect(extractBlockSourceFromContent(content, { lineStart: 0, lineEnd: 6 }))
      .toBe("date: 2026-08-21\n---\n\n===\n第五句")
  })

  it("keeps a just-saved fifth sentence across a following transform", () => {
    let content = "```timeline\n09:00-10:00 math\n===\n第一句。\n第二句。\n第三句。\n第四句。\n```"
    const firstSection = { lineStart: 0, lineEnd: 7 }
    const liveBeforeTextSave = extractBlockSourceFromContent(content, firstSection)
    expect(liveBeforeTextSave).not.toBeNull()
    content = replaceBlockInContent(
      content,
      firstSection,
      setTextSection(liveBeforeTextSave!, "第一句。\n第二句。\n第三句。\n第四句。\n第五句。")
    )

    const secondSection = { lineStart: 0, lineEnd: 8 }
    const liveBeforeLayoutSave = extractBlockSourceFromContent(content, secondSection)
    expect(liveBeforeLayoutSave).not.toBeNull()
    content = replaceBlockInContent(content, secondSection, setHeaderValue(liveBeforeLayoutSave!, "width", "300"))

    expect(content).toContain("第五句。")
    expect(content).toContain("width: 300")
  })
})

describe("setTextSection", () => {
  it("appends a text section", () => {
    expect(setTextSection("09:00-10:00 math", "## to do"))
      .toBe("09:00-10:00 math\n===\n## to do")
  })

  it("replaces an existing text section", () => {
    expect(setTextSection("09:00-10:00 math\n===\nold text\nmore", "new"))
      .toBe("09:00-10:00 math\n===\nnew")
  })

  it("empty text keeps the section placeholder (yyt: 空保存不该把文字区弄没)", () => {
    expect(setTextSection("09:00-10:00 math\n===\nold", "  ")).toBe("09:00-10:00 math\n===")
  })

  it("round-trips through the parser", () => {
    const doc = parseTimeline(setTextSection("09:00-10:00 math", "1. 任务"))
    expect(doc.text).toBe("1. 任务")
    expect(doc.errors).toEqual([])
  })
})

describe("insertEntryLine with text section (=== 边界)", () => {
  it("inserts before the === text section, not into it", () => {
    const src = "date: 2026-08-17\n---\n===\n## 明日 to do\n1. 线代"
    const out = insertEntryLine(src, "09:00-11:00 math", 9 * 60)
    expect(out).toBe("date: 2026-08-17\n---\n09:00-11:00 math\n===\n## 明日 to do\n1. 线代")
    const doc = parseTimeline(out)
    expect(doc.entries).toHaveLength(1)
    expect(doc.text).toBe("## 明日 to do\n1. 线代")
  })

  it("respects the boundary even when entries exist", () => {
    const src = "09:00-10:00 math\n===\n文字"
    const out = insertEntryLine(src, "21:00-21:30 fitness", 21 * 60)
    expect(out).toBe("09:00-10:00 math\n21:00-21:30 fitness\n===\n文字")
  })
})

describe("setTextSection / removeTextSection (多文本框)", () => {
  const src = "09:00-10:00 math\n===\n上午\n===\n下午"

  it("replaces the Nth section", () => {
    expect(setTextSection(src, "上午改", 0)).toBe("09:00-10:00 math\n===\n上午改\n===\n下午")
    expect(setTextSection(src, "下午改", 1)).toBe("09:00-10:00 math\n===\n上午\n===\n下午改")
  })

  it("appends a new section when index >= count", () => {
    expect(setTextSection(src, "", 2)).toBe("09:00-10:00 math\n===\n上午\n===\n下午\n===")
  })

  it("removeTextSection removes only that segment", () => {
    expect(removeTextSection(src, 0)).toBe("09:00-10:00 math\n===\n下午")
    expect(parseTimeline(removeTextSection(src, 0)).texts).toEqual(["下午"])
  })
})

describe("diary bodies travel with their line", () => {
  const src = ["date: 2026-09-30", "---", "09:00-10:00 开发 a", "  正文一", "  正文二", "11:00-12:00 写作 b"].join("\n")
  it("deleteEntryLine removes the body too", () => {
    expect(deleteEntryLine(src, 2)).toBe(["date: 2026-09-30", "---", "11:00-12:00 写作 b"].join("\n"))
  })
  it("insertEntryLine lands after the body of the previous entry", () => {
    const out = insertEntryLine(src, "10:00-10:30 吃饭", 600)
    expect(out.split("\n").slice(2, 6)).toEqual(["09:00-10:00 开发 a", "  正文一", "  正文二", "10:00-10:30 吃饭"])
  })
  it("setItemBody replaces, adds and removes a body", () => {
    expect(setItemBody(src, 2, "只剩一行")).toBe(["date: 2026-09-30", "---", "09:00-10:00 开发 a", "  只剩一行", "11:00-12:00 写作 b"].join("\n"))
    expect(setItemBody(src, 5, "新的\n两行")).toContain("11:00-12:00 写作 b\n  新的\n  两行")
    expect(setItemBody(src, 2, undefined)).toBe(["date: 2026-09-30", "---", "09:00-10:00 开发 a", "11:00-12:00 写作 b"].join("\n"))
  })
  it("insertSpanLine keeps time order and attaches the body", () => {
    const out = insertSpanLine(src, { startMin: 10 * 60 + 15, endMin: 10 * 60 + 40, text: "#飞搜", body: "回 issue" })
    expect(out.split("\n").slice(2, 8)).toEqual(["09:00-10:00 开发 a", "  正文一", "  正文二", "@10:15-10:40 #飞搜", "  回 issue", "11:00-12:00 写作 b"])
    expect(parseTimeline(out).spans[0]).toMatchObject({ startMin: 615, endMin: 640, body: "回 issue", tags: ["飞搜"] })
  })
})

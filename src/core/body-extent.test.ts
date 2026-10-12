import { describe, expect, it } from "vitest"
import { parseTimeline } from "./parser"
import { formatBodyLines } from "./format"
import { deleteEntryLine, insertSpanLine, setItemBody } from "../edit/source-rewriter"

const base = ["date: 2026-09-30", "---", "09:00-10:00 开发 A", "11:00-12:00 写作 C"].join("\n")

describe("diary bodies with paragraphs (hour diary review A1)", () => {
  it("round-trips a blank line between paragraphs", () => {
    const out = setItemBody(base, 2, "第一段\n\n第二段")
    expect(out.split("\n").slice(2, 6)).toEqual(["09:00-10:00 开发 A", "  第一段", "", "  第二段"])
    const doc = parseTimeline(out)
    expect(doc.entries[0].body).toBe("第一段\n\n第二段")
    expect(doc.entries[0].bodyLines).toBe(3)
    expect(doc.entries[1].line).toBe(6)
    expect(doc.entries[1].body).toBeUndefined()
    expect(doc.errors).toEqual([])
  })

  it("edits a paragraphed body without duplicating it", () => {
    const once = setItemBody(base, 2, "第一段\n\n第二段")
    const twice = setItemBody(once, 2, "第一段\n\n第二段 补一句")
    expect(parseTimeline(twice).entries[0].body).toBe("第一段\n\n第二段 补一句")
    expect(twice.match(/第二段/g)).toHaveLength(1)
  })

  it("clears every paragraph", () => {
    const once = setItemBody(base, 2, "第一段\n\n第二段")
    expect(setItemBody(once, 2, undefined)).toBe(base)
  })

  it("deletes a span with its paragraphs, leaving nothing orphaned", () => {
    const withSpan = insertSpanLine(base, { startMin: 600, endMin: 660, body: "上午\n\n下午" })
    const doc = parseTimeline(withSpan)
    const out = deleteEntryLine(withSpan, doc.spans[0].line)
    expect(out).toBe(base)
    expect(parseTimeline(out).entries.every((e) => e.body === undefined)).toBe(true)
  })

  it("keeps a blank line that is followed by an unindented line outside the body", () => {
    const doc = parseTimeline(["09:00-10:00 开发 A", "  正文", "", "11:00-12:00 写作 C"].join("\n"))
    expect(doc.entries[0]).toMatchObject({ body: "正文", bodyLines: 1 })
    expect(doc.entries[1].line).toBe(3)
  })
})

describe("two pieces on the same span (review A2)", () => {
  it("writes each body under its own line", () => {
    const one = insertSpanLine(base, { startMin: 600, endMin: 660, body: "第一条" })
    const two = insertSpanLine(one, { startMin: 600, endMin: 660, body: "第二条" })
    const spans = parseTimeline(two).spans
    expect(spans.map((s) => s.body)).toEqual(["第一条", "第二条"])
  })
})

describe("text that would break the block (review A6, A7)", () => {
  it("treats an indented === as diary text, not a separator", () => {
    const out = setItemBody(base, 2, "上午\n===\n下午")
    const doc = parseTimeline(out)
    expect(doc.entries).toHaveLength(2)
    expect(doc.entries[0].body).toBe("上午\n===\n下午")
    expect(doc.texts).toEqual([])
  })

  it("keeps a line that starts with a tab", () => {
    const out = setItemBody(base, 2, "\tTab 行\n普通行")
    expect(parseTimeline(out).entries[0].body).toBe("\tTab 行\n普通行")
  })

  it("refuses a fence line, which would close the timeline block", () => {
    expect(() => formatBodyLines("代码：\n```js\nx()\n```")).toThrow("body-contains-fence")
    expect(() => formatBodyLines("~~~")).toThrow()
    expect(formatBodyLines("行内 `code` 没问题")).toEqual(["  行内 `code` 没问题"])
  })
})

describe("titled text sections (phase 4)", () => {
  it("parses a title after ===, and keeps untitled sections untitled", () => {
    const doc = parseTimeline(["09:00-10:00 开发", "=== 感恩日记", "今天的阳光", "===", "自由文字"].join("\n"))
    expect(doc.texts).toEqual(["今天的阳光", "自由文字"])
    expect(doc.textTitles).toEqual(["感恩日记", undefined])
    expect(doc.entries).toHaveLength(1)
  })

  it("keeps the title when the text changes, appends titled sections, renames and untitles", async () => {
    const { setTextSection, setTextTitle } = await import("../edit/source-rewriter")
    const src = ["09:00-10:00 开发", "=== 感恩日记", "旧"].join("\n")
    expect(setTextSection(src, "新的一行", 0)).toBe(["09:00-10:00 开发", "=== 感恩日记", "新的一行"].join("\n"))
    const added = setTextSection(src, "", 1, "阅读笔记")
    expect(parseTimeline(added).textTitles).toEqual(["感恩日记", "阅读笔记"])
    expect(parseTimeline(setTextTitle(added, 1, "读书")).textTitles).toEqual(["感恩日记", "读书"])
    expect(parseTimeline(setTextTitle(added, 0, undefined)).textTitles).toEqual([undefined, "阅读笔记"])
  })
})

describe("phase 4 review: section text and header zone", () => {
  it("keeps a === line inside a section as text, round-trip", async () => {
    const { setTextSection } = await import("../edit/source-rewriter")
    const src = ["09:00-10:00 开发", "=== 感恩日记", "旧"].join("\n")
    const out = setTextSection(src, "今天感恩三件事\n=== 小结 ===\n标题\n===\n整体不错", 0)
    const doc = parseTimeline(out)
    expect(doc.textTitles).toEqual(["感恩日记"])
    expect(doc.texts).toEqual(["今天感恩三件事\n=== 小结 ===\n标题\n===\n整体不错"])
    expect(parseTimeline(setTextSection(out, doc.texts[0], 0)).texts).toEqual(doc.texts)
  })

  it("never writes header lines into a text section when the block has no ---", async () => {
    const { setHeaderValue, insertTodo, addOffSlot } = await import("../edit/source-rewriter")
    const src = ["date: 2026-09-30", "09:00-10:00 开发", "=== 阅读笔记", "摘抄一段", "---", "layout: 是正文", "我的感想"].join("\n")
    const withView = setHeaderValue(src, "todo-view", "group=none sort=manual layout=abc")
    expect(parseTimeline(withView).todoView.layout).toBe("abc")
    expect(parseTimeline(withView).texts[0]).toBe("摘抄一段\n---\nlayout: 是正文\n我的感想")
    const withTodo = insertTodo(src, { id: "t1", title: "x", group: "", estimateMin: 30, completed: false })
    expect(parseTimeline(withTodo).todos.map((t) => t.id)).toEqual(["t1"])
    expect(parseTimeline(withTodo).texts[0]).toBe("摘抄一段\n---\nlayout: 是正文\n我的感想")
    expect(parseTimeline(setHeaderValue(src, "layout", "timeline@0,0,12,40")).texts[0]).toContain("layout: 是正文")
    expect(parseTimeline(addOffSlot(src, "stats")).hiddenSlots).toEqual(["stats"])
  })

  it("reads CRLF and full-width separators", async () => {
    const { setTextSection } = await import("../edit/source-rewriter")
    const crlf = "09:00-10:00 开发\r\n=== 感恩日记\r\n旧\r\n"
    const out = setTextSection(crlf.replace(/\r\n/g, "\n").replace("=== 感恩日记", "=== 感恩日记\r"), "新", 0)
    expect(parseTimeline(out).textTitles).toEqual(["感恩日记"])
    expect(parseTimeline("09:00-10:00 开发\n===　感恩日记\n旧").textTitles).toEqual(["感恩日记"])
  })
})

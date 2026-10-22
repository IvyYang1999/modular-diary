import { describe, expect, it } from "vitest"
import { attachmentsFromText, parseTodoAttachment } from "./todo-attachments"

describe("todo attachments", () => {
  it("reads vault images, other vault files and links", () => {
    expect(parseTodoAttachment("[[附件/截图 1.png]]")).toEqual({ kind: "image", raw: "[[附件/截图 1.png]]", target: "附件/截图 1.png", label: "截图 1.png" })
    expect(parseTodoAttachment("![[a.pdf|方案]]")).toMatchObject({ kind: "file", target: "a.pdf", label: "方案" })
    expect(parseTodoAttachment("https://www.example.com/docs/a?b=1")).toMatchObject({ kind: "link", label: "example.com/docs/a" })
    expect(parseTodoAttachment("just words")).toBeNull()
  })
  it("splits pasted text into items and drops the rest", () => {
    expect(attachmentsFromText("https://a.com https://b.com/x\n[[c.png]] noise")).toEqual(["https://a.com", "https://b.com/x", "[[c.png]]"])
  })
})

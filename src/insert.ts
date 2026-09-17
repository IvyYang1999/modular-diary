/** Insert a new Modular Diary timeline block at the cursor (editor menu / command). */
import { Editor } from "obsidian"

/** Daily-note filename -> YYYY-MM-DD (supports 2026-08-18 / 2026.8.18sun 等); else today. */
export function inferDate(fileBasename: string | null, now = new Date()): string {
  if (fileBasename) {
    const m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(fileBasename)
    if (m) {
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
    }
  }
  const p = (n: number): string => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export interface InsertTemplate {
  layout?: string
  width?: number
  hasText?: boolean
}

export function timelineTemplate(date: string, tpl: InsertTemplate = {}): string {
  const head = [`date: ${date}`]
  if (tpl.width) head.push(`width: ${tpl.width}`)
  if (tpl.layout) head.push(`layout: ${tpl.layout}`)
  const textPart = tpl.hasText ? "\n===\n" : ""
  return `\`\`\`timeline\n${head.join("\n")}\n---\n${textPart}\`\`\``
}

export function insertTimelineBlock(editor: Editor, fileBasename: string | null, tpl: InsertTemplate = {}): void {
  const date = inferDate(fileBasename)
  const cursor = editor.getCursor()
  const line = editor.getLine(cursor.line)
  // 当前行非空 -> 换行另起；空行直接插入
  const prefix = line.trim() === "" ? "" : "\n"
  editor.replaceRange(`${prefix}${timelineTemplate(date, tpl)}\n`, cursor)
  // 光标落到条目区空行（--- 的下一行）
  const entryLine = cursor.line + (prefix === "" ? 4 : 5)
  editor.setCursor({ line: entryLine, ch: 0 })
}

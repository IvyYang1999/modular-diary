import { headerZone, headerInsertIndex } from "../core/body-extent"
import { parseChecklistModule, type ChecklistModule } from "../core/checklist-modules"
import type { ChecklistTemplate } from "../core/checklists"

function records(source: string): Array<{ line: number; module: ChecklistModule }> {
  const lines = source.split("\n")
  return lines.slice(0, headerZone(lines).end).flatMap((line, index) => {
    const match = /^checklist:\s*(.*)\r?$/i.exec(line.trim())
    const module = match && parseChecklistModule(match[1])
    return module ? [{ line: index, module }] : []
  })
}
export function addChecklistModule(source: string, title: string, template?: ChecklistTemplate): string {
  const lines = source.split("\n"), ids = new Set(records(source).map((r) => r.module.id))
  // Existing hidden/layout-only slots also reserve their identities.
  for (const line of lines.slice(0, headerZone(lines).end)) for (const m of line.matchAll(/\b(checklist[1-9]\d*)\b/g)) ids.add(m[1])
  let n = 1
  while (ids.has(`checklist${n}`)) n++
  const module: ChecklistModule = { id: `checklist${n}`, title, items: (template?.items ?? []).map((item, i) => ({ id: `item${i + 1}`, text: item.text, indent: item.indent, checked: false })) }
  lines.splice(headerInsertIndex(lines), 0, `checklist: ${JSON.stringify(module)}`)
  return lines.join("\n")
}
export function updateChecklistModule(source: string, id: string, change: (module: ChecklistModule) => ChecklistModule): string {
  const matches = records(source).filter((r) => r.module.id === id)
  if (matches.length !== 1) throw new Error("checklist-source-changed")
  const next = change(matches[0].module), value = JSON.stringify(next)
  if (next.id !== id || !parseChecklistModule(value)) throw new Error("invalid-checklist")
  const lines = source.split("\n")
  lines[matches[0].line] = `checklist: ${value}`
  return lines.join("\n")
}

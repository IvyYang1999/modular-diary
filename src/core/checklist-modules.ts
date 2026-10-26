/** Block-local copies, independent from the Vault's reusable checklist templates. */
export interface ChecklistModuleItem {
  id: string
  text: string
  checked: boolean
  indent?: string
}
export interface ChecklistModule {
  id: string
  title: string
  items: ChecklistModuleItem[]
  /** Monotonic cursor: deleted item identities are never recycled. */
  nextItem?: number
}
export const isChecklistSlot = (id: string): boolean => /^checklist[1-9]\d*$/.test(id)

export function parseChecklistModule(value: string): ChecklistModule | null {
  try {
    const c = JSON.parse(value)
    if (!c || typeof c.id !== "string" || !isChecklistSlot(c.id) || typeof c.title !== "string" || !Array.isArray(c.items)) return null
    if (c.nextItem !== undefined && (!Number.isSafeInteger(c.nextItem) || c.nextItem < 1)) return null
    const seen = new Set<string>()
    for (const item of c.items) {
      if (!item || typeof item.id !== "string" || !/^[a-z0-9-]+$/i.test(item.id) || seen.has(item.id)
        || typeof item.text !== "string" || typeof item.checked !== "boolean"
        || (item.indent !== undefined && (typeof item.indent !== "string" || !/^[ \t]*$/.test(item.indent)))) return null
      seen.add(item.id)
    }
    return c
  } catch { return null }
}

export function nextChecklistItemId(module: ChecklistModule): string {
  let n = module.nextItem ?? 1
  for (const item of module.items) {
    const value = /^item(\d+)$/.exec(item.id)
    const number = value ? Number(value[1]) : 0
    if (Number.isSafeInteger(number)) n = Math.max(n, number + 1)
  }
  return `item${n}`
}

/** A retry of an acknowledged-in-memory append is one effect; stale IDs never resurrect deleted items. */
export function appendChecklistItem(module: ChecklistModule, id: string, text: string): ChecklistModule {
  const existing = module.items.find((item) => item.id === id)
  if (existing) {
    if (existing.text !== text) throw new Error("checklist-item-changed")
    return module
  }
  if (nextChecklistItemId(module) !== id) throw new Error("checklist-item-changed")
  return { ...module, nextItem: Number(id.slice(4)) + 1, items: [...module.items, { id, text, checked: false }] }
}

/** The item plus the deeper-indented items right under it: what moves together. */
function blockOf(items: ChecklistModuleItem[], index: number): number {
  const depth = (items[index].indent ?? "").length
  let end = index + 1
  while (end < items.length && (items[end].indent ?? "").length > depth) end++
  return end
}

/** Move an item (and its sub-items) so it sits before `beforeId`, or last when null. Unknown ids leave the list alone. */
export function moveChecklistItem(module: ChecklistModule, id: string, beforeId: string | null): ChecklistModule {
  const from = module.items.findIndex((item) => item.id === id)
  if (from < 0 || id === beforeId) return module
  const end = blockOf(module.items, from)
  const block = module.items.slice(from, end)
  if (beforeId !== null && block.some((item) => item.id === beforeId)) return module
  const rest = [...module.items.slice(0, from), ...module.items.slice(end)]
  const at = beforeId === null ? rest.length : rest.findIndex((item) => item.id === beforeId)
  if (at < 0) return module
  return { ...module, items: [...rest.slice(0, at), ...block, ...rest.slice(at)] }
}

/** Indent one step (a sub-item of the line above) or outdent; the first item never indents. */
export function indentChecklistItem(module: ChecklistModule, id: string, delta: 1 | -1): ChecklistModule {
  const index = module.items.findIndex((item) => item.id === id)
  if (index < 0) return module
  const current = (module.items[index].indent ?? "").length
  const above = index > 0 ? (module.items[index - 1].indent ?? "").length : -1
  const next = delta > 0 ? Math.min(current + 2, above + 2, 8) : Math.max(0, current - 2)
  if (next === current || (delta > 0 && above < 0)) return module
  return { ...module, items: module.items.map((item, i) => i === index ? { ...item, indent: " ".repeat(next) || undefined } : item) }
}

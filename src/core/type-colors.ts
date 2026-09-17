/** Pure type->color config helpers (荧光笔色号, D2). Obsidian-free, unit-testable. */

/**
 * Defaults for a fresh install only; saved palettes are never touched.
 * 2026-09-17: the pale tier (OKLCH L .86 C .09) of the five hues in the MD
 * mark, plus a warm neutral for sleep, so the product, its site and its logo
 * share one colour family. Saturated = identity, pale = ink on the timeline.
 */
export const DEFAULT_TYPE_COLORS: Record<string, string> = {
  math: "#afd5fe",
  micro: "#c3dc9b",
  english: "#f7c790",
  sleep: "#dcdad4",
  meal: "#febfb9",
  misc: "#dec3ff",
}

/** Parse "type: #hex" lines (blank lines and // comments ignored). */
export function parseTypeColors(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "" || line.startsWith("//")) continue
    const m = /^([A-Za-z][\w-]*)\s*[:=]\s*(#[0-9A-Fa-f]{3,8}|[A-Za-z].*)$/.exec(line)
    if (!m) continue
    out[m[1]] = m[2].trim()
  }
  return out
}

export function serializeTypeColors(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([type, color]) => `${type}: ${color}`)
    .join("\n")
}

/** 未登记类型的确定性颜色：同名同色（替代全灰兜底，yyt 2026-08-17）。 */
export function hashTypeColor(type: string): string {
  let h = 0
  for (const ch of type) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  return `hsl(${h % 360} 62% 62%)`
}

/** Resolve a block-local brush without inventing a fallback outside its visible palette. */
export function pickVisibleType(preferred: string, visibleTypes: string[]): string {
  return visibleTypes.includes(preferred) ? preferred : visibleTypes[0] ?? ""
}

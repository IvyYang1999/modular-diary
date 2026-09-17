/** Pure type->color config helpers (荧光笔色号, D2). Obsidian-free, unit-testable. */

/**
 * Defaults for a fresh install only; saved palettes are never touched.
 * 2026-09-17: the five hues of the MD mark at full strength, plus a warm
 * neutral for sleep, so the product, its site and its logo are one colour
 * family. Copy on these fills is white (see blockTextColor).
 */
export const DEFAULT_TYPE_COLORS: Record<string, string> = {
  math: "#53a3f2",
  micro: "#a0c849",
  english: "#f4a437",
  sleep: "#cfccc4",
  meal: "#f47b74",
  misc: "#ae7ee2",
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

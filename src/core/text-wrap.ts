/**
 * Width-based text wrapping for inline SVG labels (no DOM dependency).
 *
 * SVG `<text>` has no native wrapping, so the renderer decides line breaks
 * before layout. Breaks are measured in pixels rather than counted in
 * characters: a CJK glyph is roughly one em while Latin glyphs are about half
 * that, so one shared "characters per line" coefficient wraps English too
 * early and Chinese too late. Hosts that can measure real glyphs (canvas
 * `measureText`) pass their own measurer; otherwise the estimate below keeps
 * the two scripts apart.
 */

export type TextMeasurer = (text: string) => number

/** Full-width ideographs, kana, hangul and their punctuation. */
export function isWideGlyph(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return code > 0x2e7f && !(code >= 0xff61 && code <= 0xff9f)
}

/**
 * Glyph advances for a UI sans-serif at `fontPx`: wide glyphs one em,
 * capitals/digits ~0.62em, m/w ~0.78em, narrow Latin (f i j l t r) and
 * spaces/punctuation ~0.3em, other Latin ~0.5em.
 */
export function estimateTextWidth(text: string, fontPx: number): number {
  let width = 0
  for (const ch of text) {
    if (isWideGlyph(ch)) width += fontPx
    else if (/[mwMW@#%&]/.test(ch)) width += fontPx * 0.78
    else if (/[A-Z0-9]/.test(ch)) width += fontPx * 0.62
    else if (/[fijltrI\s.,:;'!|\-·]/.test(ch)) width += fontPx * 0.3
    else width += fontPx * 0.5
  }
  return width
}

/**
 * Break `text` into wrap units: each wide glyph is its own unit, runs of
 * Latin/digits form words (a hyphen or slash may end a word so "P358-369"
 * breaks after the dash instead of inside a number), and whitespace is a
 * droppable separator.
 */
function wrapUnits(text: string): string[] {
  const units: string[] = []
  let word = ""
  const flush = (): void => {
    if (word) units.push(word)
    word = ""
  }
  for (const ch of text) {
    if (/\s/.test(ch)) {
      flush()
      units.push(" ")
    } else if (isWideGlyph(ch)) {
      flush()
      units.push(ch)
    } else {
      word += ch
      if (ch === "-" || ch === "/") flush()
    }
  }
  flush()
  return units
}

const ELLIPSIS = "…"

/** Trim `line` until `line + …` fits, keeping at least one glyph. */
function ellipsize(line: string, maxWidth: number, measure: TextMeasurer): string {
  const glyphs = Array.from(line.trimEnd())
  while (glyphs.length > 1 && measure(glyphs.join("") + ELLIPSIS) > maxWidth) glyphs.pop()
  return glyphs.join("").trimEnd() + ELLIPSIS
}

/**
 * Greedy width-based wrap. Words that cannot fit an empty line are split by
 * glyph. When the text needs more than `maxLines`, the last line ends in an
 * ellipsis that itself fits the width.
 */
export function wrapTextToWidth(text: string, maxWidth: number, maxLines: number, measure: TextMeasurer): string[] {
  const lines: string[] = []
  const limit = Math.max(1, maxLines)
  let line = ""
  const units = wrapUnits(text)
  let index = 0
  const pushLine = (value: string): void => {
    lines.push(value.trimEnd())
    line = ""
  }
  while (index < units.length) {
    const unit = units[index]
    if (unit === " ") {
      if (line !== "") line += unit
      index += 1
      continue
    }
    const candidate = line + unit
    if (measure(candidate.trimEnd()) <= maxWidth) {
      line = candidate
      index += 1
      continue
    }
    if (line === "") {
      // The unit alone is wider than the line: split it by glyph.
      const glyphs = Array.from(unit)
      let taken = ""
      for (const glyph of glyphs) {
        if (taken !== "" && measure(taken + glyph) > maxWidth) break
        taken += glyph
      }
      line = taken
      const rest = unit.slice(taken.length)
      if (rest) units[index] = rest
      else index += 1
      if (lines.length + 1 >= limit && (rest || index < units.length)) break
      if (rest) pushLine(line)
      continue
    }
    if (lines.length + 1 >= limit) break
    pushLine(line)
  }
  const exhausted = index >= units.length || units.slice(index).every((unit) => unit === " ")
  if (line.trimEnd() !== "" || lines.length === 0) lines.push(line.trimEnd())
  if (!exhausted && lines.length > 0) {
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1], maxWidth, measure)
  }
  return lines
}

/** 深色荧光笔上文字反色：WCAG 相对亮度，深底白字浅底黑字（yyt 2026-08-19） */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m]
}

export function parseColor(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split("").map((c) => c + c).join("")
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
  }
  const hsl = /^hsl\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%\s*\)$/i.exec(color.trim())
  if (hsl) return hslToRgb(Number(hsl[1]) % 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100)
  return null
}

/** WCAG 相对亮度 0..1 */
export function relativeLuminance(color: string): number | null {
  const rgb = parseColor(color)
  if (!rgb) return null
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}

/** 底色深 -> 白字；底色浅 -> 深字。 */
export function readableTextColor(bgColor: string): string {
  const lum = relativeLuminance(bgColor)
  if (lum === null) return "#1a1a1a"
  return lum < 0.42 ? "#ffffff" : "#1a1a1a"
}

/** WCAG 对比度（1-21）。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a) ?? 0
  const lb = relativeLuminance(b) ?? 0
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

/**
 * 派生文字色（chromajs darken/saturate 思路，依赖-free 版）：
 * 与底色同色相；浅底 -> 加深加饱和（深蓝配浅蓝），深底 -> 同色系浅色。
 * 保证与底色 WCAG 对比度 >= 4.5，不满足就继续压/提亮度。
 */
export function relatedTextColor(bgColor: string): string {
  const rgb = parseColor(bgColor)
  if (!rgb) return "#1a1a1a"
  const [h, s, l] = rgbToHsl(...rgb)
  // 近灰底色：无色系可派生，退回中性色
  if (s < 0.08) return l < 0.5 ? "#ffffff" : "#1a1a1a"

  const dark = l > 0.45
  let textL = dark ? 0.22 : 0.9
  const textS = dark ? Math.min(0.9, s + 0.25) : Math.min(0.6, s + 0.1)
  for (let i = 0; i < 12; i++) {
    const candidate = `hsl(${Math.round(h)} ${Math.round(textS * 100)}% ${Math.round(textL * 100)}%)`
    if (contrastRatio(candidate, bgColor) >= 4.5) return candidate
    textL += dark ? -0.05 : 0.05
    if (textL < 0.05) return "#1a1a1a"
    if (textL > 0.97) return "#ffffff"
  }
  return dark ? "#1a1a1a" : "#ffffff"
}

/**
 * Copy color for text drawn on a block (yyt 2026-09-17, "字可以用白色，咱应该有一套算法").
 * Vivid mid-tones -- the five hues of the MD mark, most hashed category colors --
 * take white, as colored buttons do everywhere: WCAG can never reach 4.5 with
 * white there (1.9-3.1), yet dark copy on a saturated fill reads as mud.
 * Pale, near-grey and dark fills keep the derived same-hue copy, which does
 * guarantee 4.5. The cut is deliberate: saturation >= .45 and luminance < .52.
 */
export const VIVID_MIN_SATURATION = 0.45
export const VIVID_MAX_LUMINANCE = 0.52

export function isVividFill(bgColor: string): boolean {
  const rgb = parseColor(bgColor)
  const lum = relativeLuminance(bgColor)
  if (!rgb || lum === null) return false
  return rgbToHsl(...rgb)[1] >= VIVID_MIN_SATURATION && lum < VIVID_MAX_LUMINANCE
}

export function blockTextColor(bgColor: string): string {
  return isVividFill(bgColor) ? "#ffffff" : relatedTextColor(bgColor)
}

/** Dark-theme copy: vividness is judged on the category color itself, not on the dimmed fill. */
export function darkBlockTextColor(color: string): string {
  return isVividFill(color) ? "#ffffff" : relatedTextColor(darkThemeBlockFill(color))
}

function toHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")
}

/** sRGB mix of `weight` × a with (1 − weight) × b; unparsable input returns a. */
export function mixColors(a: string, b: string, weight: number): string {
  const ra = parseColor(a)
  const rb = parseColor(b)
  if (!ra || !rb) return a
  const w = Math.min(1, Math.max(0, weight))
  return toHex([0, 1, 2].map((i) => ra[i] * w + rb[i] * (1 - w)) as [number, number, number])
}

/**
 * Dark-theme block fill. Highlighter colors are chosen for a light page; on a
 * dark page a light neutral such as the default `sleep` gray becomes the
 * brightest surface on the axis. Blending 22% of the page background into
 * every record fill keeps category identity while removing the glow. The
 * mounted CSS blends with the live `--background-primary`; this approximation
 * with Obsidian's default dark page only drives the derived copy color.
 */
export const DARK_BLOCK_BACKGROUND = "#1e1e1e"
export const DARK_BLOCK_FILL_WEIGHT = 0.78

export function darkThemeBlockFill(color: string): string {
  return mixColors(color, DARK_BLOCK_BACKGROUND, DARK_BLOCK_FILL_WEIGHT)
}

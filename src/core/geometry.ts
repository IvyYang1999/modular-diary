/** y(px) <-> minutes mapping shared by the SVG builder and draw interaction. */

/**
 * The range step buttons are real controls outside the visible track. Keep a
 * dedicated gutter at both ends so their painted boxes never overlap the
 * creation surface or rely on clipped SVG overflow.
 */
export const AXIS_PAD_TOP = 26
export const AXIS_PAD_BOTTOM = 26
export const LABEL_W = 36
export const TRACK_PAD = 6
export const DEFAULT_HOUR_HEIGHT = 48
/** Canonical interaction grid for creating, moving, and resizing blocks. */
export const SNAP_MINUTES = 5

export function yFromMinutes(min: number, rangeStart: number, hourHeight: number): number {
  return AXIS_PAD_TOP + ((min - rangeStart) / 60) * hourHeight
}

export function minutesFromY(y: number, rangeStart: number, hourHeight: number): number {
  return rangeStart + ((y - AXIS_PAD_TOP) / hourHeight) * 60
}

/** Snap minutes to the canonical 5-minute grid. */
export function snapMinutes(min: number, snap = SNAP_MINUTES): number {
  return Math.round(min / snap) * snap
}

/**
 * Adaptive inline font size for duration labels (yyt 2026-08-17:
 * 时长永远居中，字号自适应). Returns 0 when the block is too small for
 * any readable label (caller falls back to the side lane).
 */
/**
 * Largest inline SVG label size, in px. Mirrors `--modular-diary-font-caption`
 * (12px `--font-ui-smaller` minus 1px) in styles.css; SVG labels are sized
 * numerically because their fit is computed before layout.
 */
export const SVG_LABEL_MAX_FONT_PX = 11

export function inlineFontSize(w: number, h: number, text: string): number {
  const byWidth = (w - 4) / (text.length * 0.58)
  const byHeight = h * 0.55
  const size = Math.min(SVG_LABEL_MAX_FONT_PX, byWidth, byHeight)
  if (size < 4.5) return 0
  return Math.floor(size * 2) / 2
}

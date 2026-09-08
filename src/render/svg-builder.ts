/**
 * Pure SVG string builder for the oneday timeline (no DOM/Obsidian deps).
 * Layout mirrors the paper page: hour labels on the left, vertical track,
 * plan layer as translucent background, actual blocks on top (D3),
 * duration centered in the block (moved right when too thin, D6),
 * and a dedicated right "label lane" where thin-block labels, narrow-column
 * notes and @annotations share one collision-avoiding layout (M4).
 */
import { Entry, TimelineDoc } from "../core/types"
import { hashTypeColor } from "../core/type-colors"
import { relatedTextColor } from "../core/contrast"
import { formatClock, formatHours, durationMinutes } from "../core/duration"
import { AXIS_PAD_TOP, AXIS_PAD_BOTTOM, LABEL_W, TRACK_PAD, inlineFontSize, SVG_LABEL_MAX_FONT_PX } from "../core/geometry"
import { estimateTextWidth, isWideGlyph, TextMeasurer, wrapTextToWidth } from "../core/text-wrap"

export interface RenderOptions {
  /** type -> css color (D2). Unknown types fall back to FALLBACK_COLOR. */
  typeColors: Record<string, string>
  /** Independent category colors for point markers. */
  markerTypeColors?: Record<string, string>
  /** px per hour, default 48 */
  hourHeight?: number
  /** total svg width, default 200 */
  width?: number
  /**
   * Horizontal budget for the right annotation lane, from fitSideLaneWidth.
   * The lane frame never exceeds SIDE_LANE_W, but labels may use slack up to
   * the budget; below MIN_SIDE_LANE_W (0) the lane hides and hover tooltips
   * carry the labels. Omitted: unmeasured, legacy character-based layout.
   */
  sideLaneWidth?: number
  /** 视图：全部 / 只看记录 / 只看计划（yyt 2026-08-17） */
  view?: "all" | "actual" | "plan"
  /**
   * Rendered pixel width of note copy at the note font (`.oneday-note`).
   * Hosts with a canvas pass `measureText`; omitted, notes wrap on a
   * script-aware estimate (CJK one em, Latin about half).
   */
  measureNote?: TextMeasurer
}

export const FALLBACK_COLOR = "#bdbdbd"
const PAD_TOP = AXIS_PAD_TOP
const PAD_BOTTOM = AXIS_PAD_BOTTOM
const PLAN_OPACITY = 0.12
const BLOCK_OPACITY = 0.95 // 盖住底部 plan 层，文字不糊（yyt 2026-08-17）
/** 统一留白 x（yyt 2026-08-19 定稿）：色块间/贴边/并列列间距全部一致 */
const GAP_X = 2
/** Text stays inside this inset; SVG text has no native padding box. */
const LABEL_INSET_X = 6
const LABEL_INSET_Y = 4
/** Below this height (px) the duration label moves to the right of the block. */
const MIN_INLINE_LABEL_H = 30
/** Below this width (px) the duration label moves to the right (并列分列后列宽变窄). */
const MIN_INLINE_LABEL_W = 56
/** Tall enough to also show the note inside the block. */
const MIN_NOTE_H = 32
/** `.oneday-note` size: `--oneday-font-svg-label` = caption − 2px. */
export const NOTE_FONT_PX = SVG_LABEL_MAX_FONT_PX - 2
/** Right lane reserved for side labels & annotations (M4: no more clipping). */
export const SIDE_LANE_W = 112
/** Narrowest lane that still fits a readable label; below it the lane hides. */
export const MIN_SIDE_LANE_W = 56
/**
 * Labels are capped at 14 characters, so any budget beyond this renders the
 * same lane; capping it keeps wide-pane resizes from re-rendering.
 */
export const MAX_SIDE_LANE_BUDGET = SIDE_LANE_W + 48
/** Estimated advance per label character used to size the marker pills. */
const SIDE_LANE_CHAR_W = 8
/**
 * Upper-bound glyph advances for the lane's 9-10px text: CJK/full-width
 * glyphs are one em, everything else about 0.6em.
 */
const LANE_WIDE_GLYPH_W = 10
const LANE_NARROW_GLYPH_W = 6

/**
 * Lane budget that fits the available content width of the scroll pane next
 * to a fixed track. The track keeps its authored width; only the lane gives
 * way. Unknown (unmeasured) widths keep the full lane.
 */
export function fitSideLaneWidth(availableWidth: number, baseWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return SIDE_LANE_W
  const lane = Math.floor(availableWidth - baseWidth)
  if (lane >= SIDE_LANE_W) return Math.min(lane, MAX_SIDE_LANE_BUDGET)
  if (lane >= MIN_SIDE_LANE_W) return lane
  return 0
}

/** Estimated rendered width of lane text (upper bound, see glyph constants). */
export function estimateLaneTextWidth(text: string): number {
  let width = 0
  for (const ch of text) width += isWideGlyph(ch) ? LANE_WIDE_GLYPH_W : LANE_NARROW_GLYPH_W
  return width
}

/** Greedy truncation to an estimated pixel budget, ending in an ellipsis. */
export function truncateLaneText(text: string, maxWidth: number): string {
  if (estimateLaneTextWidth(text) <= maxWidth) return text
  const glyphs = Array.from(text)
  let width = LANE_WIDE_GLYPH_W // the ellipsis
  let kept = 0
  for (const ch of glyphs) {
    const advance = isWideGlyph(ch) ? LANE_WIDE_GLYPH_W : LANE_NARROW_GLYPH_W
    if (width + advance > maxWidth) break
    width += advance
    kept += 1
  }
  return glyphs.slice(0, Math.max(1, kept)).join("") + "…"
}
/** Vertical row height used by the side-label collision avoidance. */
const SIDE_LINE_H = 13

let hatchUid = 0

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}



/** One item in the right label lane (thin-block label, side note, annotation). */
export interface SideItem {
  /** natural (ideal) center y */
  naturalY: number
  text: string
  cls: string
  /** source line of the block this label belongs to (hover pairing) */
  dataLine?: number
  /** block right-edge x; when set, a leader line is always drawn (多列时标注↔色块对应关系) */
  anchorX?: number
  /** Categorized point marker label. */
  markerColor?: string
  markerPlan?: boolean
}

export interface PlacedSideItem extends SideItem {
  y: number
  displaced: boolean
}

/**
 * Collision-avoiding vertical layout for the label lane (M4):
 * sorted by natural y, each item pushed down just enough to clear the
 * previous one. Displaced items get a leader line from their anchor.
 */
export function layoutSideItems(items: SideItem[], lineH = SIDE_LINE_H): PlacedSideItem[] {
  const sorted = [...items].sort((a, b) => a.naturalY - b.naturalY)
  let prevBottom = -Infinity
  return sorted.map((it) => {
    const half = lineH / 2
    const y = Math.max(it.naturalY, prevBottom + half + 1)
    prevBottom = y + half
    return { ...it, y, displaced: y > it.naturalY + 0.5 }
  })
}

/** Column layout for actual entries (calendar-style parallel events). */
interface Placed {
  entry: Entry
  x: number
  w: number
}

function placeActual(actual: Entry[], trackX: number, trackW: number): Placed[] {
  const sorted = [...actual].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const placed: Placed[] = []
  let cluster: Entry[] = []
  let clusterEnd = -1

  const flush = (): void => {
    if (cluster.length === 0) return
    const colEnds: number[] = []
    const assignment = new Map<number, number>()
    for (const e of cluster) {
      let col = colEnds.findIndex((end) => end <= e.startMin)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(e.endMin)
      } else {
        colEnds[col] = e.endMin
      }
      assignment.set(e.line, col)
    }
    const n = colEnds.length
    // 贴边布局（yyt 2026-08-19）：首列贴左缘、末列贴右缘，列间固定 gap
    // 统一间距：贴边 x、列间 x（yyt 规范：n 列有 n-1 个列间 + 左右各 1 个贴边）
    const colW = (trackW - GAP_X * (n + 1)) / n
    for (const e of cluster) {
      const col = assignment.get(e.line) ?? 0
      placed.push({ entry: e, x: trackX + GAP_X + col * (colW + GAP_X), w: colW })
    }
    cluster = []
  }

  for (const e of sorted) {
    if (cluster.length > 0 && e.startMin >= clusterEnd) flush()
    cluster.push(e)
    clusterEnd = Math.max(clusterEnd, e.endMin)
  }
  flush()
  return placed
}

/**
 * 长备注按实测宽度贪心换行（yyt：字多直接多行，放不下才截断）。
 * The block's inset is applied here so both plan and record blocks wrap
 * against the same text box.
 */
function wrapNote(text: string, blockW: number, maxLines: number, measure: TextMeasurer): string[] {
  const maxWidth = Math.max(NOTE_FONT_PX * 2, blockW - LABEL_INSET_X * 2)
  return wrapTextToWidth(text, maxWidth, maxLines, measure)
}

/** Side labels must stay inside the svg: cap length. */
function truncate(text: string, max = 12): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

export function renderTimelineSvg(doc: TimelineDoc, opts: RenderOptions): string {
  const view = opts.view ?? "all"
  const entries = doc.entries.filter((e) => (view === "all" ? true : view === "plan" ? e.plan : !e.plan))
  return renderTimelineSvgEntries(doc, entries, opts)
}

function renderTimelineSvgEntries(doc: TimelineDoc, entries: Entry[], opts: RenderOptions): string {
  const hourHeight = opts.hourHeight ?? 48
  const baseWidth = opts.width ?? 200
  const trackX = LABEL_W
  const trackW = baseWidth - LABEL_W - TRACK_PAD
  // M4: dedicated right lane for side labels & annotations (no clipping).
  // Narrow slots shrink or hide the lane; the track never moves.
  const laneBudget = opts.sideLaneWidth !== undefined && Number.isFinite(opts.sideLaneWidth)
    ? Math.max(0, Math.min(MAX_SIDE_LANE_BUDGET, Math.floor(opts.sideLaneWidth)))
    : undefined
  const laneW = Math.min(SIDE_LANE_W, laneBudget ?? SIDE_LANE_W)
  const width = baseWidth + laneW
  const laneX = trackX + trackW + 4
  const measureNote = opts.measureNote ?? ((text: string) => estimateTextWidth(text, NOTE_FONT_PX))
  const y = (min: number): number => PAD_TOP + ((min - doc.rangeStart) / 60) * hourHeight
  const axisBottom = PAD_TOP + ((doc.rangeEnd - doc.rangeStart) / 60) * hourHeight

  const parts: string[] = []
  const sideItems: SideItem[] = []

  // Hour gridlines + labels (including >24h hours, D10 自然延伸).
  const firstHour = Math.floor(doc.rangeStart / 60)
  const lastHour = Math.ceil(doc.rangeEnd / 60)
  for (let h = firstHour; h <= lastHour; h++) {
    const yy = y(h * 60)
    parts.push(`<line class="oneday-grid" x1="${trackX}" y1="${yy}" x2="${trackX + trackW}" y2="${yy}"/>`)
    parts.push(`<text class="oneday-hour" x="${LABEL_W - 6}" y="${yy + 4}" text-anchor="end">${h % 24}</text>`) // 跨零点回绕：25->1
  }
  // Track frame
  parts.push(
    `<rect class="oneday-track" x="${trackX}" y="${y(doc.rangeStart)}" width="${trackW}" height="${y(doc.rangeEnd) - y(doc.rangeStart)}"/>`
  )

  // Plan layer first (full-width translucent background + diagonal hatch, D3 覆盖语义)
  const planColors = [...new Set(entries.filter((e) => e.plan).map((e) => opts.typeColors[e.type] ?? hashTypeColor(e.type)))]
  // id 必须每次渲染唯一：同页多个时间轴块的 defs 同名 id 会跨 svg 冲撞（斜线丢失/错色）
  const uid = ++hatchUid
  if (planColors.length > 0) {
    const defs = planColors
      .map(
        (c, i) =>
          `<pattern id="oneday-hatch-${uid}-${i}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
          `<line x1="0" y1="0" x2="0" y2="6" stroke="${escapeXml(c)}" stroke-width="1.6" stroke-opacity="0.8"/></pattern>`
      )
      .join("")
    parts.push(`<defs>${defs}</defs>`)
  }
  for (const e of entries.filter((e) => e.plan)) {
    const color = opts.typeColors[e.type] ?? hashTypeColor(e.type)
    const hatchId = `oneday-hatch-${uid}-${planColors.indexOf(color)}`
    const yy = y(e.startMin)
    const hh = Math.max(2, y(e.endMin) - yy)
    parts.push(
      `<rect class="oneday-block oneday-plan" data-line="${e.line}" data-type="${escapeXml(e.type)}" x="${trackX + GAP_X}" y="${yy + GAP_X / 2}" width="${trackW - GAP_X * 2}" height="${hh - GAP_X}" rx="3" fill="${escapeXml(color)}" fill-opacity="${PLAN_OPACITY}" stroke="${escapeXml(color)}" stroke-opacity="0.7" stroke-width="1"></rect>` +
        `<rect pointer-events="none" class="oneday-plan-hatch" data-line="${e.line}" x="${trackX + GAP_X}" y="${yy + GAP_X / 2}" width="${trackW - GAP_X * 2}" height="${hh - GAP_X}" rx="3" fill="url(#${hatchId})"/>`
    )
    // plan 块也显示时长/备注（yyt 2026-08-17），样式淡一档
    const label = formatHours(durationMinutes(e.startMin, e.endMin))
    const blockW = trackW - GAP_X * 2
    const blockH = hh - GAP_X
    const labelWidth = Math.max(0, blockW - LABEL_INSET_X * 2)
    const combined = e.note ? `${label} · ${truncate(e.note, 12)}` : label
    const fsCombined = e.note ? inlineFontSize(labelWidth, blockH, combined) : 0
    const fs = inlineFontSize(labelWidth, blockH, label)
    if (fs > 0) {
      const showNote = blockH >= MIN_NOTE_H && e.note
      if (showNote) {
        const maxNoteLines = Math.max(1, Math.floor((blockH - LABEL_INSET_Y * 2 - fs) / 11))
        const noteLines = wrapNote(e.note ?? "", blockW, maxNoteLines, measureNote)
        const totalH = fs + noteLines.length * 11
        const startY = yy + GAP_X / 2 + (blockH - totalH) / 2
        parts.push(
          `<text pointer-events="none" class="oneday-duration oneday-plan-label" data-line="${e.line}" font-size="${fs}" x="${trackX + trackW / 2}" y="${startY + fs - 2}" text-anchor="middle">${label}</text>`
        )
        noteLines.forEach((line, index) => parts.push(
          `<text pointer-events="none" class="oneday-note oneday-plan-label" data-line="${e.line}" x="${trackX + trackW / 2}" y="${startY + fs + 11 * (index + 1)}" text-anchor="middle">${escapeXml(line)}</text>`
        ))
      } else if (e.note && fsCombined > 0) {
        parts.push(
          `<text pointer-events="none" class="oneday-duration oneday-plan-label" data-line="${e.line}" font-size="${fsCombined}" x="${trackX + trackW / 2}" y="${yy + hh / 2 + fsCombined / 2 - 1.5}" text-anchor="middle">${escapeXml(combined)}</text>`
        )
      } else {
        parts.push(
          `<text pointer-events="none" class="oneday-duration oneday-plan-label" data-line="${e.line}" font-size="${fs}" x="${trackX + trackW / 2}" y="${yy + hh / 2 + fs / 2 - 1.5}" text-anchor="middle">${label}</text>`
        )
      }
    }
  }

  // Actual blocks: overlapping ones split into side-by-side columns (并列日程,
  // calendar-style; yyt 2026-08-17). Plans do not participate in columns.
  // Blocks that carry inline copy are remembered so a time-point line can
  // skip them instead of striking through their duration/note text.
  const inlineTextBlocks: Array<{ x: number; w: number; y: number; h: number }> = []
  for (const p of placeActual(entries.filter((e) => !e.plan), trackX, trackW)) {
    const e = p.entry
    const color = opts.typeColors[e.type] ?? hashTypeColor(e.type)
    // 纵向每块自身内缩 x/2（yyt 规范：相邻块间隙=x，不挤压不累计）
    const yy = y(e.startMin) + GAP_X / 2
    const hh = Math.max(2, y(e.endMin) - y(e.startMin) - GAP_X)
    parts.push(
      `<rect class="oneday-block" data-line="${e.line}" data-type="${escapeXml(e.type)}" x="${p.x}" y="${yy}" width="${p.w}" height="${hh}" rx="3" fill="${escapeXml(color)}" fill-opacity="${BLOCK_OPACITY}"></rect>`
    )
    const label = formatHours(durationMinutes(e.startMin, e.endMin))
    // 备注排版（yyt 2026-08-17）：短备注与时长同行；长备注且块够高 ->
    // 时长加粗居中 + 备注第二行小字不加粗；再不行才去侧栏
    const combined = e.note ? `${label} · ${truncate(e.note, 8)}` : label
    const textInsetX = Math.min(LABEL_INSET_X, Math.max(2, p.w * 0.12))
    const labelWidth = Math.max(0, p.w - textInsetX * 2)
    const fsCombined = e.note ? inlineFontSize(labelWidth, hh, combined) : 0
    const fs = inlineFontSize(labelWidth, hh, label)
    const canTwoLine = Boolean(e.note) && hh >= MIN_NOTE_H && fs > 0
    if (canTwoLine || (e.note && fsCombined > 0) || fs > 0) inlineTextBlocks.push({ x: p.x, w: p.w, y: yy, h: hh })
    if (canTwoLine) {
      // 长备注多行：时长加粗居中在上，备注小字换行在下（放不下才省略号）
      const maxNoteLines = Math.max(1, Math.floor((hh - LABEL_INSET_Y * 2 - fs) / 11))
      const noteLines = wrapNote(e.note ?? "", p.w, maxNoteLines, measureNote)
      const totalH = fs + noteLines.length * 11
      const startY = yy + (hh - totalH) / 2
      parts.push(
        `<text pointer-events="none" class="oneday-duration" data-line="${e.line}" style="font-size:${fs}px;fill:${relatedTextColor(color)}" x="${p.x + p.w / 2}" y="${startY + fs - 2}" text-anchor="middle">${label}</text>`
      )
      noteLines.forEach((ln, i) => {
        parts.push(
          `<text pointer-events="none" class="oneday-note" data-line="${e.line}" style="fill:${relatedTextColor(color)}" x="${p.x + p.w / 2}" y="${startY + fs + 11 * (i + 1)}" text-anchor="middle">${escapeXml(ln)}</text>`
        )
      })
    } else if (e.note && fsCombined > 0) {
      parts.push(
        `<text pointer-events="none" class="oneday-duration" data-line="${e.line}" style="font-size:${fsCombined}px;fill:${relatedTextColor(color)}" x="${p.x + p.w / 2}" y="${yy + hh / 2 + fsCombined / 2 - 1.5}" text-anchor="middle">${escapeXml(combined)}</text>`
      )
    } else if (fs > 0) {
      parts.push(
        `<text pointer-events="none" class="oneday-duration" data-line="${e.line}" style="font-size:${fs}px;fill:${relatedTextColor(color)}" x="${p.x + p.w / 2}" y="${yy + hh / 2 + fs / 2 - 1.5}" text-anchor="middle">${label}</text>`
      )
      if (e.note) {
        // 实在放不进 -> 右侧标注车道
        sideItems.push({ naturalY: yy + hh / 2, text: truncate(e.note, 14), cls: "oneday-note oneday-side", dataLine: e.line, anchorX: p.x + p.w })
      }
    } else {
      // 极端小块：时长(+备注)去标注车道
      const side = e.note ? `${label} · ${truncate(e.note, 14)}` : label
      sideItems.push({ naturalY: yy + hh / 2, text: side, cls: "oneday-duration oneday-thin", dataLine: e.line, anchorX: p.x + p.w })
    }
  }

  // Categorized annotations are interactive point markers. Markers at the
  // exact same minute get a tiny source-ordered visual offset while retaining
  // their canonical timestamp in data-time-min.
  const markerView = opts.view ?? "all"
  const markers = doc.annotations.filter((a) => a.type && (markerView === "all" || (markerView === "plan") === Boolean(a.plan)))
  const markerCounts = new Map<number, number>()
  markers.forEach((marker) => markerCounts.set(marker.timeMin, (markerCounts.get(marker.timeMin) ?? 0) + 1))
  const markerIndexes = new Map<number, number>()
  for (const marker of markers) {
    const index = markerIndexes.get(marker.timeMin) ?? 0
    markerIndexes.set(marker.timeMin, index + 1)
    const count = markerCounts.get(marker.timeMin) ?? 1
    const markerY = y(marker.timeMin) + (index - (count - 1) / 2) * 7
    const color = (opts.markerTypeColors ?? opts.typeColors)[marker.type ?? ""] ?? hashTypeColor(marker.type ?? "")
    const cls = `oneday-marker${marker.plan ? " oneday-marker-plan" : ""}`
    // The visible line is painted only across the gaps between blocks that
    // show text at this height, so it never strikes through a label; the hit
    // line, the endpoint dots and the lane label still describe the full row.
    const covered = inlineTextBlocks
      .filter((block) => markerY >= block.y && markerY <= block.y + block.h)
      .map((block) => [block.x, block.x + block.w] as [number, number])
      .sort((a, b) => a[0] - b[0])
    const segments: Array<[number, number]> = []
    let cursor = trackX
    for (const [start, end] of covered) {
      if (start > cursor) segments.push([cursor, start])
      cursor = Math.max(cursor, end)
    }
    if (cursor < trackX + trackW) segments.push([cursor, trackX + trackW])
    const lineParts = segments
      .map(([x1, x2]) => `<line class="oneday-marker-line" x1="${x1}" y1="${markerY}" x2="${x2}" y2="${markerY}" stroke="${escapeXml(color)}"/>`)
      .join("")
    parts.push(
      `<g class="${cls}" data-line="${marker.line}" data-type="${escapeXml(marker.type ?? "")}" data-time-min="${marker.timeMin}" data-marker-y="${markerY}">` +
      `<line class="oneday-marker-hit" x1="${trackX}" y1="${markerY}" x2="${trackX + trackW}" y2="${markerY}" stroke="transparent" stroke-width="6"/>` +
      lineParts +
      `<circle class="oneday-marker-dot" cx="${trackX}" cy="${markerY}" r="2.5" fill="${escapeXml(color)}"/>` +
      `<circle class="oneday-marker-dot" cx="${trackX + trackW}" cy="${markerY}" r="2.5" fill="${escapeXml(color)}"/>` +
      `</g>`
    )
    sideItems.push({
      naturalY: markerY,
      text: truncate(marker.text || marker.type || "", 14),
      cls: `oneday-marker-label${marker.plan ? " oneday-marker-plan-label" : ""}`,
      dataLine: marker.line,
      anchorX: trackX + trackW,
      markerColor: color,
      markerPlan: marker.plan,
    })
  }
  // Legacy annotations keep their quiet, read-only label-lane rendering.
  for (const a of doc.annotations.filter((annotation) => !annotation.type)) {
    sideItems.push({ naturalY: y(a.timeMin), text: truncate(a.text, 14), cls: "oneday-anno" })
  }

  const placedSide = layoutSideItems(sideItems)
  const laneParts: string[] = []
  for (const it of (laneW > 0 ? placedSide : [])) {
    // Measured panes cap labels to the pixel budget left beside the track;
    // the unmeasured first paint keeps the per-item character cap.
    const text = laneBudget !== undefined
      ? truncateLaneText(it.text, laneBudget - (it.markerColor ? 12 : 6))
      : it.text
    if (it.anchorX !== undefined) {
      // 标注 ↔ 色块列的对应关系线；CSS 控制非常驻（避让偏移/focus 时才可见）
      const cls = it.displaced ? "oneday-side-leader is-displaced" : "oneday-side-leader"
      laneParts.push(
        `<line class="${cls}" data-line="${it.dataLine ?? ""}" x1="${it.anchorX}" y1="${it.naturalY}" x2="${laneX - 2}" y2="${it.y}"/>`
      )
    } else if (it.displaced) {
      laneParts.push(
        `<line class="oneday-side-leader" x1="${trackX + trackW}" y1="${it.naturalY}" x2="${laneX - 2}" y2="${it.y}"/>`
      )
    }
    const dataAttr = it.dataLine !== undefined ? ` data-line="${it.dataLine}"` : ""
    if (it.markerColor) {
      const labelW = Math.min(laneW - 8, Math.max(36, text.length * SIDE_LANE_CHAR_W + 14))
      const opacity = it.markerPlan ? 0.08 : 0.14
      laneParts.push(
        `<rect pointer-events="all" class="oneday-marker-label-bg${it.markerPlan ? " oneday-marker-plan-label" : ""}"${dataAttr} x="${laneX - 2}" y="${it.y - 7}" width="${labelW}" height="14" rx="4" fill="${escapeXml(it.markerColor)}" fill-opacity="${opacity}" stroke="${escapeXml(it.markerColor)}" stroke-opacity="0.55"/>`
      )
    }
    laneParts.push(`<text pointer-events="none" class="${it.cls}"${dataAttr} x="${laneX + (it.markerColor ? 4 : 0)}" y="${it.y + 3}">${escapeXml(text)}</text>`)
  }
  // The lane is one replaceable group so a slot resize can swap only the
  // labels while the track, blocks, markers and interaction-owned nodes stay.
  parts.push(`<g class="oneday-side-lane" data-lane-width="${laneW}">${laneParts.join("")}</g>`)

  // Height follows the full label layout even when the lane is hidden, so a
  // narrow slot never oscillates between "lane hidden" and "lane shown"
  // through its own scrollbar.
  const lastSideBottom = placedSide.length > 0 ? placedSide[placedSide.length - 1].y + SIDE_LINE_H / 2 : 0
  const height = Math.max(axisBottom, lastSideBottom) + PAD_BOTTOM

  const laneAttr = laneBudget !== undefined ? ` data-side-lane="${laneBudget}"` : ""
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" class="oneday-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-base-width="${baseWidth}"${laneAttr}>`, ...parts, "</svg>"]
  return out.join("")
}

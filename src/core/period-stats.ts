/**
 * Optional statistics widgets in a period block's rail, written to the
 * `period-stats:` header as space-separated tokens: `share` (a donut of each
 * category's share of the recorded time) and `days:<category>` (which days of
 * the period have a record of that category). The bar totals always show.
 */
export type PeriodStatsWidget = { kind: "share" } | { kind: "days"; type: string }

export function parsePeriodStatsWidget(token: string): PeriodStatsWidget | null {
  if (token === "share") return { kind: "share" }
  const days = /^days:(.+)$/.exec(token)
  return days ? { kind: "days", type: days[1] } : null
}

export function periodStatsToken(widget: PeriodStatsWidget): string {
  return widget.kind === "share" ? "share" : `days:${widget.type}`
}

/** Header tokens are space separated, so a category name with spaces is not offered for `days:`. */
export function canTrackDays(type: string): boolean {
  return type.trim() !== "" && !/\s/.test(type)
}

export interface ShareSlice { type: string | null; minutes: number; ratio: number }

/** The largest categories, the rest folded into one `null` ("other") slice. */
export function shareSlices(totals: Array<{ type: string; minutes: number }>, keep = 5): ShareSlice[] {
  const sum = totals.reduce((acc, item) => acc + item.minutes, 0)
  if (sum <= 0) return []
  const sorted = [...totals].filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes)
  const head = sorted.length > keep + 1 ? sorted.slice(0, keep) : sorted
  const rest = sorted.slice(head.length).reduce((acc, item) => acc + item.minutes, 0)
  return [
    ...head.map((item) => ({ type: item.type, minutes: item.minutes, ratio: item.minutes / sum })),
    ...(rest > 0 ? [{ type: null, minutes: rest, ratio: rest / sum }] : []),
  ]
}

/**
 * Current-time helpers for the "now" indicator (pure, Obsidian-free).
 * A block only shows the marker when its own date is today in local time.
 */

/** Local calendar day as "YYYY-MM-DD" (not UTC: the timeline is a local-day view). */
export function localDateKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * Minutes since local midnight when `date` is today, else undefined.
 * Undefined means "draw nothing": past and future days have no now.
 */
export function nowMinutesForDate(date: string | null | undefined, now: Date = new Date()): number | undefined {
  if (!date || date !== localDateKey(now)) return undefined
  return now.getHours() * 60 + now.getMinutes()
}

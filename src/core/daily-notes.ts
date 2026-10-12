/**
 * Where does a given day live? Obsidian's core Daily Notes plugin decides the
 * folder and the filename format; we read its `daily-notes.json` and never
 * invent our own convention. Pure helpers; the caller supplies a moment-style
 * formatter and does the file I/O.
 */

export interface DailyNotesConfig {
  /** Vault-relative folder, "" for the root. */
  folder: string
  /** moment format of the note name, e.g. "YYYY-MM-DD" or "YYYY.M.D". */
  format: string
  /** Template note path (without .md), "" for none. */
  template: string
}

export const DEFAULT_DAILY_NOTES_CONFIG: DailyNotesConfig = { folder: "", format: "YYYY-MM-DD", template: "" }

export function parseDailyNotesConfig(raw: unknown): DailyNotesConfig {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const str = (key: keyof DailyNotesConfig): string => (typeof data[key] === "string" ? (data[key] as string).trim() : "")
  return {
    folder: str("folder").replace(/^\/+|\/+$/g, ""),
    format: str("format") || DEFAULT_DAILY_NOTES_CONFIG.format,
    template: str("template").replace(/\.md$/i, ""),
  }
}

/** Note path for `date` (YYYY-MM-DD) under the daily-notes convention. */
export function dailyNotePath(config: DailyNotesConfig, date: string, format: (momentFormat: string, date: string) => string): string {
  const name = format(config.format, date).replace(/\.md$/i, "")
  return `${config.folder ? config.folder + "/" : ""}${name}.md`
}

/** YYYY-MM-DD read off a note name such as 2026-08-18 or 2026.8.18sun; null when the name carries no date. */
export function dateFromBasename(basename: string): string | null {
  const match = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(basename)
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const value = new Date(year, month - 1, day + days)
  const part = (input: number): string => String(input).padStart(2, "0")
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`
}

/**
 * Minimal `{{date}}` / `{{title}}` / `{{date:FMT}}` substitution, the subset of
 * the core plugin's template variables that matters for a note name.
 */
export function fillDailyTemplate(template: string, date: string, noteName: string, format: (momentFormat: string, date: string) => string): string {
  return template
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_match, fmt: string) => format(fmt, date))
    .replace(/\{\{\s*(date|title)\s*\}\}/g, noteName)
}

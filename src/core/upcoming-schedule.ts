/**
 * Copying future schedule items into diaries, independent of Obsidian: the host
 * supplies reading/writing the schedule note and writing into a day's block.
 */
import { insertEntryLine, insertTodo } from "../edit/source-rewriter"
import { addUpcoming, markUpcomingDone, parseUpcoming, pendingForDate, type UpcomingItem } from "./upcoming"

export interface UpcomingHost {
  /** The schedule note's text, or null when it does not exist. */
  readNote: () => Promise<string | null>
  /** Rewrite the schedule note, creating it when missing. */
  writeNote: (change: (text: string) => string) => Promise<void>
  /** Whether that day's diary already exists. */
  dayExists: (date: string) => Promise<boolean>
  /** Find or create that day's timeline block and rewrite it. */
  writeToDay: (date: string, transform: (blockSource: string) => string) => Promise<unknown>
  /** Redraw mounted blocks after the schedule changed. */
  onChange: () => void
}

function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** The diary lines an item becomes: a plan block when timed, otherwise a todo. */
export function applyUpcomingToBlock(source: string, items: UpcomingItem[]): string {
  let out = source
  for (const item of items) {
    if (item.startMin !== undefined && item.endMin !== undefined) {
      const line = `plan ${clock(item.startMin)}-${clock(item.endMin)} ${item.type ?? ""}${item.text ? ` ${item.text}` : ""}`.trimEnd()
      // A retry after the tick failed must not copy twice.
      if (!out.split("\n").some((existing) => existing.trim() === line)) out = insertEntryLine(out, line, item.startMin)
      continue
    }
    if (out.includes(`title=${JSON.stringify(item.text)}`)) continue
    out = insertTodo(out, {
      id: `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: item.text, group: "", estimateMin: 0, completed: false, ...(item.zone ? { zone: item.zone } : {}),
    })
  }
  return out
}

export class UpcomingSchedule {
  items: UpcomingItem[] = []
  private readonly inflight = new Set<string>()

  constructor(private readonly host: UpcomingHost) {}

  async load(): Promise<void> {
    const text = await this.host.readNote()
    this.items = text === null ? [] : parseUpcoming(text)
  }

  /** Copy a day's pending items into its diary, then tick them in the schedule note. */
  async copyInto(date: string): Promise<boolean> {
    const pending = pendingForDate(this.items, date)
    if (!pending.length || this.inflight.has(date)) return false
    this.inflight.add(date)
    try {
      await this.host.writeToDay(date, (source) => applyUpcomingToBlock(source, pending))
      await this.host.writeNote((content) => markUpcomingDone(content, pending))
      await this.load()
      return true
    } catch (error) {
      console.error("Modular Diary: failed to copy upcoming items", error)
      return false
    } finally {
      this.inflight.delete(date)
    }
  }

  /** Hand every pending item to `convert` (a week todo, say), then tick them all so they are never copied again. */
  async retire(convert: (item: UpcomingItem) => Promise<void>): Promise<number> {
    const pending = this.items.filter((item) => !item.done)
    for (const item of pending) await convert(item)
    if (pending.length) {
      await this.host.writeNote((content) => markUpcomingDone(content, pending))
      await this.load()
    }
    return pending.length
  }

  /** Add an item; when that day's diary already exists it goes in right away. */
  async add(item: Omit<UpcomingItem, "line" | "done">): Promise<void> {
    await this.host.writeNote((content) => addUpcoming(content, item))
    await this.load()
    if (await this.host.dayExists(item.date)) await this.copyInto(item.date)
    this.host.onChange()
  }
}

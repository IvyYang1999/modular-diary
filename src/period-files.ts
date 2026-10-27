/**
 * Plugin-managed week and month notes (`周期/2026-W44.md`, `周期/2026-10.md`).
 * Each holds one period block (`days: start..end` + `scope:`); the day block
 * embeds it when switched to its week or month. Nobody has to create these
 * by hand, but they are ordinary notes and can be opened and edited.
 */
import { App, TFile, normalizePath, type EventRef } from "obsidian"
import { timelineFences } from "./edit/block-identity"
import { replaceBlockInContent } from "./edit/source-rewriter"
import { carryOver, ensureRhythmSlots, periodKey, shiftScope, type PeriodScope, undoEarlyCarry } from "./core/rhythm-ledger"
import type { Rhythm } from "./core/rhythms"

export interface PeriodFilesHost {
  /** Read lazily: the plugin's app is set after this object is built. */
  app: () => App
  folder: () => string
  /** Redraw mounted blocks after a period note changed. */
  onChange: () => void
}

export function periodBlockTemplate(scope: PeriodScope): string {
  return `days: ${scope.start}..${scope.end}\nscope: ${scope.kind}\n---`
}

export class PeriodFiles {
  /** Block source by note path, for synchronous rendering. */
  readonly sources = new Map<string, string>()
  private readonly loading = new Set<string>()
  private readonly ensuring = new Map<string, Promise<string>>()
  private readonly preparing = new Set<string>()

  constructor(private readonly host: PeriodFilesHost) {}

  path(scope: PeriodScope): string {
    return normalizePath(`${this.host.folder()}/${periodKey(scope)}.md`)
  }

  private file(path: string): TFile | null {
    const found = this.host.app().vault.getAbstractFileByPath(path)
    return found instanceof TFile ? found : null
  }

  /** The block source when the note is cached; otherwise start loading and return null. */
  source(scope: PeriodScope): string | null {
    const path = this.path(scope)
    const cached = this.sources.get(path)
    if (cached !== undefined) return cached
    if (!this.loading.has(path)) {
      this.loading.add(path)
      // Redraw only when a note was read: a miss would otherwise redraw forever.
      void this.load(path).then((source) => { if (source !== null) this.host.onChange() }).finally(() => this.loading.delete(path))
    }
    return null
  }

  private async load(path: string): Promise<string | null> {
    const file = this.file(path)
    if (!file) { this.sources.delete(path); return null }
    const content = await this.host.app().vault.cachedRead(file)
    const fence = timelineFences(content).next().value
    if (!fence) { this.sources.delete(path); return null }
    this.sources.set(path, fence.source)
    return fence.source
  }

  /** Create the note for a scope when missing; resolves to its path. Concurrent calls share one creation. */
  ensure(scope: PeriodScope): Promise<string> {
    const path = this.path(scope)
    const pending = this.ensuring.get(path)
    if (pending) return pending
    const run = (async (): Promise<string> => {
      if (!this.file(path)) {
        const vault = this.host.app().vault
        const folder = path.slice(0, path.lastIndexOf("/"))
        if (folder && !vault.getAbstractFileByPath(folder)) {
          // Another caller (or the user) may have just made it.
          await vault.createFolder(folder).catch((error) => { if (vault.getAbstractFileByPath(folder) === null) throw error })
        }
        if (!this.file(path)) await vault.create(path, `\`\`\`timeline\n${periodBlockTemplate(scope)}\n\`\`\`\n`)
      }
      await this.load(path)
      return path
    })()
    this.ensuring.set(path, run)
    return run.finally(() => this.ensuring.delete(path))
  }

  /** Rewrite the block in a period note (creating the note when missing). A no-op transform touches nothing. */
  async write(scope: PeriodScope, transform: (source: string) => string): Promise<string> {
    const path = await this.ensure(scope)
    const file = this.file(path)
    if (!file) throw new Error(`period note missing: ${path}`)
    const cached = this.sources.get(path)
    if (cached !== undefined && transform(cached) === cached) return cached
    let next = ""
    await this.host.app().vault.process(file, (content) => {
      const fence = timelineFences(content).next().value
      const current = fence ? fence.source : null
      if (!fence || current === null) {
        const trimmed = content.replace(/\s+$/, "")
        next = transform(periodBlockTemplate(scope))
        return `${trimmed}${trimmed ? "\n\n" : ""}\`\`\`timeline\n${next}\n\`\`\`\n`
      }
      next = transform(current)
      return next === current ? content : replaceBlockInContent(content, fence, next)
    })
    this.sources.set(path, next)
    return next
  }

  /**
   * Bring a period up to date before it is shown: its rhythm slots exist,
   * and last period's open slots are carried in. Idempotent; writes only
   * when something changes.
   */
  async prepare(scope: PeriodScope, rhythms: Rhythm[], today: string): Promise<void> {
    const path = this.path(scope)
    if (this.preparing.has(path)) return
    this.preparing.add(path)
    try {
      const prevScope = shiftScope(scope, -1)
      const prevPath = this.path(prevScope)
      const prev = this.file(prevPath) ? await this.load(prevPath) : null
      // Open slots move on only once the previous period is over; paging ahead must not empty the current week.
      const prevEnded = prevScope.end < today
      let prevNext: string | null = null
      const step = (source: string): string => {
        let out = source
        if (prev !== null && !prevEnded) {
          const undone = undoEarlyCarry(out, prev, scope, periodKey(prevScope))
          out = undone.source
          prevNext = undone.prevSource !== prev ? undone.prevSource : null
        }
        out = ensureRhythmSlots(out, rhythms, scope)
        if (prev !== null && prevEnded) {
          const carried = carryOver(out, prev, rhythms, scope, periodKey(prevScope))
          out = carried.source
          prevNext = carried.prevSource !== prev ? carried.prevSource : null
        }
        return out
      }
      const before = this.sources.get(path) ?? await this.load(path) ?? periodBlockTemplate(scope)
      const after = await this.write(scope, step)
      const carriedPrev = prevNext as string | null
      if (carriedPrev !== null) await this.write(prevScope, () => carriedPrev)
      if (after !== before || carriedPrev !== null) this.host.onChange()
    } finally {
      this.preparing.delete(path)
    }
  }

  watch(register: (ref: EventRef) => void): void {
    const refresh = (path: string): void => {
      if (!this.sources.has(path) && !path.startsWith(`${normalizePath(this.host.folder())}/`)) return
      void this.load(path).then(() => this.host.onChange())
    }
    const vault = this.host.app().vault
    register(vault.on("modify", (file) => refresh(file.path)))
    register(vault.on("delete", (file) => { this.sources.delete(file.path); this.host.onChange() }))
    register(vault.on("rename", (file, oldPath) => { this.sources.delete(oldPath); refresh(file.path) }))
  }
}

import { getLanguage, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Menu, normalizePath, Notice, Platform, Plugin, setIcon, TAbstractFile, TFile } from "obsidian"
import { normalizeSpan, parseTimeline } from "./core/parser"
import { formatClockPlain, formatEntryLine, formatMarkerLine } from "./core/format"
import { FALLBACK_COLOR } from "./render/svg-builder"
import { hashTypeColor, pickVisibleType } from "./core/type-colors"
import { disposeInlineTextEditors, flushInlineTextEditors, renderTimelineInto } from "./render/timeline-view"
import { DEFAULT_SETTINGS, ModularDiarySettings, ModularDiarySettingTab } from "./settings"
import { CategorySettingsModal, DailyQuoteSettingsModal, HabitSettingsModal } from "./settings-modals"
import { attachDialog } from "./agent/dialog"
import { addHabitSkip, addHiddenType, addOffSlot, convertMarkerToEntry, deleteEntryLine, deleteTodo, extractBlockSourceFromContent, insertEntryLine, insertHeaderLine, insertSpanLine, setItemBody, setTextTitle, insertMarkerLine, insertTodo, moveTodo, removeHeaderValue, removeHiddenType, removeOffSlot, removeTextSection, removeTimelineBlockFromContent, replaceBlockInContent, replaceEntryLine, setEntryTodoBinding, setHeaderValue, setTextSection, updateTodo, placeTodoInBucket } from "./edit/source-rewriter"
import { buildLayerToggles, buildToolbar, LayerView } from "./edit/toolbar"
import { attachDrawInteraction, requestTimelineEntryDelete } from "./edit/draw-interaction"
import { attachMarkerInteraction } from "./edit/marker-interaction"
import { showBlockMenu, showMarkerMenu } from "./edit/block-menu"
import { attachHoverInfo, toggleBlockFocus } from "./edit/hover-info"
import { applyGridToBody, attachGridInteract } from "./edit/grid-interact"
import { compactGrid, defaultComponentSlot, GRID_COLS, GRID_ROW_H, gridRows, GridItem, HABITS_EMPTY_ROWS, MAX_GRID_COLS, serializeLayoutHeader } from "./core/grid-layout"
import { inferDate, insertPeriodBlock, insertTimelineBlock, timelineTemplate } from "./insert"
import { attachWidthHandle } from "./edit/width-handle"
import { openNotePopover } from "./edit/note-popover"
import { openPointTimePopover, openTimePopover } from "./edit/time-popover"
import { buildTimelineDateControl } from "./edit/date-control"
import { attachRowCompaction, TIMELINE_TOPBAR_COMPACTION } from "./edit/row-compaction"
import { SIDE_LANE_W } from "./render/svg-builder"
import { showActionMenuAtPoint } from "./edit/custom-menu"
import { MountedTimelineRegistry } from "./render/mounted-timeline-registry"
import { attachBlockResize } from "./edit/block-resize"
import { serializeBlockSize } from "./core/block-size"
import { routeMarkdownUndo } from "./edit/undo-routing"
import { decideTimelineOnboarding, resolveTimelineOnboardingSeen } from "./core/onboarding"
import { configureI18n, t as tr, weekdayLabel } from "./i18n"
import {
  captureViewportAnchor,
  restoreViewportAnchor,
  stabilizeViewportAnchor,
  type ViewportAnchor,
} from "./edit/viewport-anchor"
import { resolveTimelineSource } from "./edit/source-location"
import { ScrollTransactionRegistry, type ScrollTransactionKey } from "./edit/scroll-transaction"
import { chooseMutationView, findOwningView, resolvePersistedOwnerView, resolveTransactionOwner } from "./edit/view-owner"
import { timelineFenceOrdinal, timelineSourceAtOrdinal } from "./edit/block-identity"
import {
  captureInternalScroll,
  restoreInternalScroll,
  stabilizeInternalScroll,
  type TimelineInternalScrollSnapshot,
} from "./edit/internal-scroll"
import { prepareCodeMirrorReplacement } from "./edit/codemirror-write"
import { applyDurableWrite } from "./edit/durable-write"
import { RemountScrollRegistry, RemountSnapshotLatch } from "./edit/remount-scroll"
import {
  beginRemountVisual,
  RemountVisualRegistry,
  resolveRemountVisualMode,
  type RemountVisualMode,
} from "./edit/remount-visual"
import { habitProgress, isHabitDue, moveHabitInVisibleOrder, normalizeHabitDefinition, orderedHabits, type HabitDefinition } from "./core/habits"
import { filterWeekEntries, type DatedTimelineEntries } from "./core/weekly-ledger"
import { DayIndex } from "./core/day-index"
import { dailyNotePath, fillDailyTemplate, parseDailyNotesConfig, shiftDate, type DailyNotesConfig } from "./core/daily-notes"
import { ensureBlockForDate } from "./core/day-content"
import { learnTagCategories, tagCategory, unionMinutes } from "./core/tags"
import { skeletonFromSource } from "./core/template"
import { formatGoalLine, formatPeriodSpec, goalProgress, periodTotals, resolvePeriod, shiftPeriod } from "./core/period"
import { POOL_ZONE, renderPeriodInto, weekday, type PeriodDayView, type PeriodTodoView, type PeriodViewModel } from "./render/period-view"
import { buildScheduledPlan } from "./edit/timeline-schedule-drag"
import { setNotePopoverTagSuggest } from "./edit/note-popover"
import { composerDefaults, findLinkable, hourlogItems, linkableEntries, linkOf, locateHourlogItem, type HourlogItem } from "./core/hourlog"
import { renderHourlogInto, type HourlogComposerDraft } from "./render/hourlog-view"
import type { TagSuggestDeps } from "./edit/tag-suggest"

/** Obsidian ships moment on window; the typed `moment` export is not callable without esModuleInterop. */
type MomentLike = (input: string, format: string) => { format: (momentFormat: string) => string }
const momentFormat = (momentFormat: string, date: string): string =>
  ((window as unknown as { moment?: MomentLike }).moment?.(date, "YYYY-MM-DD").format(momentFormat)) ?? date
import { formatTodoViewHeaderValue, groupTodoTree, isWeeklyTodoDue, moveTodoGroupKey, todoMetrics, TODO_BUCKETS } from "./core/todos"
import { renderHabitsInto } from "./render/habits-view"
import { renderTodosInto, type NewTodoInput, type TodoEditDraft, type TodoViewItem } from "./render/todos-view"
import { renderDailyQuoteInto } from "./render/daily-quote-view"
import { dailyQuoteForDate, normalizeDailyQuoteDefinition, resolveQuoteInk } from "./core/daily-quotes"
/** Quote slot default height: header + two lines of sentence + source, on the 20px grid. */
const QUOTE_ROWS = 6
/** Hour diary default height: header, two short pieces and the composer. */
const HOURLOG_ROWS = 10
import { createPointerRedrawGate } from "./edit/pointer-interaction"
import { attachTimelineScheduleDrag } from "./edit/timeline-schedule-drag"
import { buildTodoGroupMenuOptions, buildTodoSortMenuOptions, buildTodoSubGroupMenuOptions } from "./edit/block-menu-model"
import { migrateCategoryPalettes, type LegacyCategoryPaletteSettings } from "./core/category-palettes"
import { mountSourceMode, sourceDraftCanApply, sourceDraftMatchesLive, type SourceModeSession } from "./edit/source-mode"
import { TimelineVisualCoordinator } from "./edit/timeline-visual-coordinator"
import { transactionScrollSnapshot, type OuterViewportAuthority } from "./edit/scroll-authority"
import { TextDraftRegistry, type TextDraftKey } from "./edit/text-draft"
import {
  captureEntryTarget,
  captureMarkerTarget,
  resolveEntryTarget,
  resolveMarkerTarget,
  type EntryTarget,
  type MarkerTarget,
} from "./edit/entry-target"
import {
  sameBlock,
  type BlockIdentity,
  type MarkerEditState,
  type SpanEditState,
} from "./edit/block-edit-state"
import type { Annotation, Entry, TimelineDoc } from "./core/types"

class MountedTimelineChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly dispose: () => void,
    private readonly flush: () => void,
    private readonly preserveScroll: () => void
  ) {
    super(containerEl)
  }

  onunload(): void {
    this.preserveScroll()
    this.flush()
    this.dispose()
  }
}

interface TimelineScrollSnapshot {
  internal: TimelineInternalScrollSnapshot
  viewport: ViewportAnchor | null
}

interface BlockTransformOptions {
  scrollSnapshot?: TimelineScrollSnapshot
  /** Select the single owner of the outer page position during the remount. */
  outerViewportAuthority?: OuterViewportAuthority
  /** Paint the transformed state before Obsidian remounts the processor. */
  previewVisual?: (newSource: string) => (() => void) | null | void
  /**
   * Grid interactions already paint their final geometry during pointermove;
   * cloning the whole block on commit would briefly create a second tree.
   */
  remountVisual?: RemountVisualMode
}

/**
 * Modular Diary — highlighter-style daily timeline block.
 * Markdown source is the single source of truth (mermaid-style dual view).
 * M1 渲染 / M2 对话框 / M3 画板编辑（选荧光笔→拖色块→写回；右键菜单）。
 */
export default class ModularDiaryPlugin extends Plugin {
  settings: ModularDiarySettings = DEFAULT_SETTINGS
  private readonly mountedTimelines = new MountedTimelineRegistry()
  private readonly scrollTransactions = new ScrollTransactionRegistry<object, TimelineScrollSnapshot>()
  private readonly remountScroll = new RemountScrollRegistry<object, TimelineScrollSnapshot>()
  private readonly remountVisual = new RemountVisualRegistry<object>()
  private readonly timelineVisuals = new TimelineVisualCoordinator<HTMLElement, object>()
  private readonly documentOwnerTokens = new Map<string, object>()
  private todoDrafts = new WeakMap<object, Map<string, NewTodoInput>>()
  private todoEditDrafts = new WeakMap<object, Map<string, TodoEditDraft>>()
  private readonly textDrafts = new TextDraftRegistry<object>()
  private sourceDrafts = new WeakMap<HTMLElement, SourceModeSession>()
  private readonly ledgerModifiedPaths = new Set<string>()
  /** Cross-day reads (weekly goals, push to tomorrow) go through this incremental index. */
  private readonly dayIndex = new DayIndex()
  private readonly backfilling = new WeakSet<HTMLElement>()
  /** Unsaved "write a piece" drafts per block (note path + block ordinal). */
  private readonly hourlogDrafts = new Map<string, HourlogComposerDraft>()
  /** A composer to open focused the next time this day's block renders (nudge, block menu). */
  private pendingHourlog: { date: string; draft: HourlogComposerDraft } | null = null
  private nudgeEl: HTMLElement | null = null
  /** A section just added as "custom": open its title editor on the next render. */
  private pendingSectionRename: { path: string; index: number } | null = null
  private nudgeDismissedHour = -1
  /** Period blocks being browsed away from their written `days:` (per note + block ordinal). */
  private readonly periodBrowse = new Map<string, import("./core/types").PeriodSpec>()
  private dayIndexSeeded = false
  private dayIndexRefresh: Promise<void> | null = null
  private ledgerRefreshTimer = 0

  private readonly blockSources = new WeakMap<HTMLElement, string>()

  private parse(source: string) {
    return parseTimeline(source, {
      rangeStart: this.settings.rangeStartHour * 60,
      rangeEnd: this.settings.rangeEndHour * 60,
    })
  }
  /** Currently selected highlighter (session-scoped). */
  private activeSpanType = ""
  private activeMarkerType = ""
  /** 荧光笔模式：画记录/画计划（session-scoped） */
  private drawMode: "actual" | "plan" = "actual"
  private drawTool: "span" | "marker" = "span"
  /** 图层视图：记录/计划各自独立点亮，都亮=全部（session-scoped） */
  private layerView: LayerView = { actual: true, plan: true }
  /** 色块编辑态（跨渲染保持；Esc/点别处退出） */
  private editing: SpanEditState<object> | null = null
  private markerEditing: MarkerEditState<object> | null = null

  onunload(): void {
    this.scrollTransactions.clear()
    this.remountScroll.clear()
    this.remountVisual.clear()
    this.timelineVisuals.clear()
    this.documentOwnerTokens.clear()
    this.todoDrafts = new WeakMap()
    this.todoEditDrafts = new WeakMap()
    this.textDrafts.clear()
    this.sourceDrafts = new WeakMap()
    const domWindow = activeWindow
    if (this.ledgerRefreshTimer) domWindow.clearTimeout(this.ledgerRefreshTimer)
  }
  /** 视图类即时切换（LP/阅读模式都生效，不依赖重渲染） */
  private applyViewClass(container: HTMLElement, view: LayerView): void {
    container.classList.remove("modular-diary-view-all", "modular-diary-view-actual", "modular-diary-view-plan", "modular-diary-view-none")
    const cls = view.actual && view.plan ? "all" : view.actual ? "actual" : view.plan ? "plan" : "none"
    container.classList.add(`modular-diary-view-${cls}`)
  }

  async onload(): Promise<void> {
    configureI18n(getLanguage)
    await this.loadSettings()
    this.addSettingTab(new ModularDiarySettingTab(this.app, this))
    // Only the touched note is re-read; other days keep their indexed data.
    const invalidateLedger = (file: TAbstractFile, oldPath?: string): void => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        if (oldPath) this.dayIndex.remove(oldPath)
        return
      }
      if (oldPath) this.dayIndex.rename(oldPath, file.path)
      else this.dayIndex.markDirty(file.path)
      this.ledgerModifiedPaths.add(file.path)
      if (this.ledgerRefreshTimer) activeWindow.clearTimeout(this.ledgerRefreshTimer)
      this.ledgerRefreshTimer = activeWindow.setTimeout(() => {
        this.ledgerRefreshTimer = 0
        const modifiedPaths = new Set(this.ledgerModifiedPaths)
        this.ledgerModifiedPaths.clear()
        this.rerenderMountedTimelines(modifiedPaths)
      }, 120)
    }
    this.registerEvent(this.app.vault.on("modify", (file) => invalidateLedger(file)))
    this.registerEvent(this.app.vault.on("create", (file) => invalidateLedger(file)))
    this.registerEvent(this.app.vault.on("delete", (file) => { this.dayIndex.remove(file.path); invalidateLedger(file) }))
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => invalidateLedger(file, oldPath)))

    // 插入入口：命令面板 + 编辑器右键菜单
    this.addCommand({
      id: "insert-timeline-block",
      name: tr("insertTimelineBlock"),
      editorCallback: (editor) => {
        insertTimelineBlock(editor, this.app.workspace.getActiveFile()?.basename ?? null, this.insertTemplate())
      },
    })
    setNotePopoverTagSuggest(this.tagSuggestDeps())
    this.setupHourlyNudge()
    this.addCommand({
      id: "insert-period-block",
      name: tr("insertPeriodBlock"),
      editorCallback: (editor) => {
        insertPeriodBlock(editor)
      },
    })
    // 撤销/重做兜底按窗口注册：弹出窗口拥有独立 Document。
    const undoDocs = new WeakSet<Document>()
    const registerUndo = (dom: Document): void => {
      if (undoDocs.has(dom)) return
      undoDocs.add(dom)
      this.registerDomEvent(dom, "keydown", (e: KeyboardEvent) => {
        routeMarkdownUndo(e, () => {
          const target = e.target as Element | null
          let owningView: MarkdownView | null = null
          if (target) {
            this.app.workspace.iterateAllLeaves((leaf) => {
              if (owningView) return
              const candidate = leaf.view
              if (candidate instanceof MarkdownView && candidate.containerEl.contains(target)) owningView = candidate
            })
          }
          const view = owningView ?? this.app.workspace.getActiveViewOfType(MarkdownView)
          if (!view) return null
          const syncVisuals = (): void => {
            const path = view.file?.path
            if (!path) return
            this.timelineVisuals.syncFromContent(
              path,
              view,
              view.editor.getValue(),
              timelineSourceAtOrdinal
            )
          }
          return {
            undo: () => {
              view.editor.undo()
              syncVisuals()
            },
            redo: () => {
              view.editor.redo()
              syncVisuals()
            },
          }
        })
      }, { capture: true })
    }
    registerUndo(document)
    this.app.workspace.iterateAllLeaves((leaf) => registerUndo(leaf.view.containerEl.ownerDocument))

    // Paste is an external CodeMirror transaction. Freeze each Modular Diary block's
    // last stable visual snapshot before CM can scroll or replace processor
    // hosts; the owning block consumes it only if its timeline source remains
    // unchanged. This closes the lifecycle gap that made the first paste jump
    // while a later host-reuse attempt happened to stay put.
    const pasteDocs = new WeakSet<Document>()
    const registerPasteContinuity = (dom: Document): void => {
      if (pasteDocs.has(dom)) return
      pasteDocs.add(dom)
      this.registerDomEvent(dom, "paste", (event: ClipboardEvent) => {
        const target = event.target as Element | null
        if (!target) return
        let owningView: MarkdownView | null = null
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (owningView) return
          const candidate = leaf.view
          if (candidate instanceof MarkdownView && candidate.containerEl.contains(target)) owningView = candidate
        })
        const view = owningView as MarkdownView | null
        if (!view) return
        const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
        view.containerEl.querySelectorAll<HTMLElement>(".modular-diary-container").forEach((container: HTMLElement) => {
          container.dispatchEvent(new CustomEventCtor("modular-diary-before-external-edit", { bubbles: true }))
        })
      }, { capture: true })
    }
    registerPasteContinuity(document)
    this.app.workspace.iterateAllLeaves((leaf) => registerPasteContinuity(leaf.view.containerEl.ownerDocument))
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, popoutWindow) => {
      registerUndo(popoutWindow.document)
      registerPasteContinuity(popoutWindow.document)
    }))

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) =>
          item
            .setTitle(tr("insertTimeline"))
            .setIcon("calendar-clock")
            .onClick(() => {
              insertTimelineBlock(editor, this.app.workspace.getActiveFile()?.basename ?? null, this.insertTemplate())
            })
        )
        menu.addItem((item) =>
          item
            .setTitle(tr("insertPeriodBlock"))
            .setIcon("calendar-range")
            .onClick(() => {
              insertPeriodBlock(editor)
            })
        )
      })
    )

    this.registerMarkdownCodeBlockProcessor("timeline", (source, el, ctx) => {
      this.blockSources.set(el, source)
      const mountKey = this.scrollTransactionKey(el, ctx)
      const snapshotLatch = new RemountSnapshotLatch<TimelineScrollSnapshot>()
      const pointerRedrawGate = createPointerRedrawGate()
      let redrawQueue = Promise.resolve()
      let stopTracking = (): void => undefined
      let releaseFreezeTimer = 0
      const startTracking = (): void => {
        stopTracking()
        const current = el.querySelector<HTMLElement>(".modular-diary-container")
        if (!current) return
        const update = (): void => {
          if (current.isConnected) snapshotLatch.update(this.captureScroll(current))
        }
        update()
        const snapshot = snapshotLatch.value
        const scrollOwners = new Set<HTMLElement>([
          ...Array.from(current.querySelectorAll<HTMLElement>(".modular-diary-block-scroll, .modular-diary-svg-holder, .modular-diary-text-pane")),
          ...(snapshot?.viewport?.scroller ? [snapshot.viewport.scroller] : []),
        ])
        scrollOwners.forEach((owner) => owner.addEventListener("scroll", update, { passive: true }))
        stopTracking = () => {
          scrollOwners.forEach((owner) => owner.removeEventListener("scroll", update))
          stopTracking = (): void => undefined
        }
      }
      const performRedraw = async (): Promise<void> => {
        // An optimistic final-state render is the sole visual owner until the
        // matching Markdown processor arrives. An old processor callback must
        // not repaint persisted-but-stale content over it.
        if (!this.timelineVisuals.shouldRender(el, source)) return
        await flushInlineTextEditors(el)
        if (!this.timelineVisuals.shouldRender(el, source)) return
        const current = el.querySelector<HTMLElement>(".modular-diary-container")
        // A source write owns its original snapshot across the replacement.
        // Ordinary settings redraws keep a local snapshot, but must never
        // overwrite an in-flight write after CodeMirror has already moved.
        const key = this.scrollTransactionKey(el, ctx)
        const pending = this.scrollTransactions.claim(key, source)
        const remounted = this.remountScroll.take(key, source)
        const scrollSnapshot = pending ?? remounted ?? (current ? this.captureScroll(current) : null)
        if (scrollSnapshot) snapshotLatch.update(scrollSnapshot)
        stopTracking()
        disposeInlineTextEditors(el)
        el.replaceChildren()
        this.renderTimelineBlock(source, el, ctx, scrollSnapshot)
        this.timelineVisuals.accept(el, source)
        // A processor host may be reused instead of reconstructed. Complete
        // the visual handoff on every redraw, not only on initial registration;
        // otherwise the fixed fallback clone survives until its TTL and turns
        // into a ghost as soon as the user scrolls or resizes a component.
        this.remountVisual.complete(key)
        const domWindow = el.ownerDocument.defaultView
        if (domWindow?.requestAnimationFrame) {
          domWindow.requestAnimationFrame(() => domWindow.requestAnimationFrame(startTracking))
        } else startTracking()
      }
      const queueRedraw = (): void => {
        redrawQueue = redrawQueue.then(performRedraw, performRedraw)
      }
      const redraw = (): void => {
        const current = el.querySelector<HTMLElement>(".modular-diary-container")
        if (!current) {
          queueRedraw()
          return
        }
        pointerRedrawGate.run(current, () => {
          if (el.isConnected) queueRedraw()
        })
      }
      const previewMountedSource = (nextSource: string, previousSource: string): (() => void) | null => {
        const current = el.querySelector<HTMLElement>(".modular-diary-container")
        if (!current?.isConnected) return null
        const scrollSnapshot = this.captureScroll(current)
        const paint = (value: string): void => {
          void flushInlineTextEditors(el)
          stopTracking()
          disposeInlineTextEditors(el)
          el.replaceChildren()
          this.renderTimelineBlock(value, el, ctx, scrollSnapshot)
          const domWindow = el.ownerDocument.defaultView
          if (domWindow?.requestAnimationFrame) {
            domWindow.requestAnimationFrame(() => domWindow.requestAnimationFrame(startTracking))
          } else startTracking()
        }
        paint(nextSource)
        return () => paint(previousSource)
      }
      const unregisterVisual = this.timelineVisuals.register(el, {
        path: ctx.sourcePath,
        owner: mountKey.owner,
        blockOrdinal: mountKey.blockOrdinal,
        source,
        preview: previewMountedSource,
      })
      const unregister = this.mountedTimelines.register(ctx.sourcePath, () => {
        if (el.isConnected) redraw()
      })
      const freezeBeforeExternalEdit = (): void => {
        const current = el.querySelector<HTMLElement>(".modular-diary-container")
        if (!current?.isConnected) return
        snapshotLatch.freeze(this.captureScroll(current))
        const domWindow = el.ownerDocument.defaultView
        if (!domWindow) return
        if (releaseFreezeTimer) domWindow.clearTimeout(releaseFreezeTimer)
        releaseFreezeTimer = domWindow.setTimeout(() => {
          releaseFreezeTimer = 0
          snapshotLatch.release()
          if (current.isConnected) snapshotLatch.update(this.captureScroll(current))
        }, 1_500)
      }
      el.addEventListener("modular-diary-before-external-edit", freezeBeforeExternalEdit)
      ctx.addChild(new MountedTimelineChild(
        el,
        () => {
          unregister()
          unregisterVisual()
          pointerRedrawGate.clear()
          el.removeEventListener("modular-diary-before-external-edit", freezeBeforeExternalEdit)
          const domWindow = el.ownerDocument.defaultView
          if (releaseFreezeTimer && domWindow) domWindow.clearTimeout(releaseFreezeTimer)
          releaseFreezeTimer = 0
        },
        () => {
          void flushInlineTextEditors(el)
          disposeInlineTextEditors(el)
        },
        () => {
          const current = el.querySelector<HTMLElement>(".modular-diary-container")
          if (current?.isConnected) snapshotLatch.update(this.captureScroll(current))
          if (snapshotLatch.value) this.remountScroll.remember(mountKey, source, snapshotLatch.value)
          stopTracking()
        }
      ))
      redraw()
      this.remountVisual.complete(mountKey)
    })
  }

  private renderTimelineBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    scrollSnapshot: TimelineScrollSnapshot | null
  ): void {
      const dom = el.ownerDocument
      const domWindow = dom.defaultView
      this.blockSources.set(el, source)
      const maybePeriod = this.parse(source)
      if (maybePeriod.period) {
        el.empty()
        this.renderPeriodBlock(source, el, ctx, maybePeriod)
        return
      }
      const doc = this.parse(source)
      // 渲染色号：全局优先，退休板兜底（删除/改名的类型在旧块里保色）
      const spanPaletteForRender = { ...this.settings.spanRetiredTypeColors, ...this.settings.spanTypeColors }
      const markerPaletteForRender = { ...this.settings.markerRetiredTypeColors, ...this.settings.markerTypeColors }
      const hasAvailableHighlighter = Object.keys(this.settings.spanTypeColors)
        .some((type) => !doc.hiddenTypes.includes(type))
        || Object.keys(this.settings.markerTypeColors).some((type) => !doc.hiddenMarkerTypes.includes(type))
      const onboardingDecision = decideTimelineOnboarding(
        this.settings.timelineOnboardingSeen,
        doc.entries.length + doc.annotations.length,
        doc.errors.length,
        hasAvailableHighlighter
      )
      if (onboardingDecision === "consume") {
        // 已经有记录的人不再是首次创建场景；不要在之后遇到空块时补播教程。
        this.settings.timelineOnboardingSeen = true
        void this.saveSettings()
      }
      const showTimelineOnboarding = onboardingDecision === "show"
      const dateStr = this.blockDate(doc, ctx.sourcePath)
      // A tag first seen on a categorized block adopts that category (yyt 2026-09-28).
      // A day whose block is still empty is refilled from todos pushed to it
      // from other days or period blocks; a day with content is left alone,
      // so a deliberate delete on that day stays deleted.
      if (dateStr && doc.todos.length === 0 && doc.entries.length === 0 && doc.spans.length === 0 && this.dayIndexReady() && !this.backfilling.has(el)) {
        const arrivals = this.dayIndex.arrivalsFor(dateStr)
        if (arrivals.length > 0) {
          this.backfilling.add(el)
          void this.applyBlockTransform(el, ctx, source, (current) => arrivals.reduce((out, todo) =>
            this.parse(out).todos.some((own) => own.id === todo.id) ? out : insertTodo(out, {
              id: todo.id, title: todo.title, group: todo.group, type: todo.type, estimateMin: todo.estimateMin, completed: false, due: todo.due, bucket: todo.bucket, note: todo.note,
            }), current)).catch((error: unknown) => console.error("Modular Diary: failed to refill a recreated day", error))
            .finally(() => this.backfilling.delete(el))
        }
      }
      const learnedTags = learnTagCategories(doc, this.settings.tagCategories)
      if (Object.keys(learnedTags).length > 0) {
        this.settings.tagCategories = { ...this.settings.tagCategories, ...learnedTags }
        void this.saveSettings()
      }
      const tagStyle = (tag: string): { background: string; color: string } | null => this.tagStyle(tag)
      const selectedQuote = dailyQuoteForDate(this.settings.dailyQuotes, dateStr ?? "")
      const dueHabits = dateStr ? orderedHabits(this.settings.habits
        .filter((habit) => isHabitDue(habit, dateStr) && !doc.habitSkips.includes(habit.id))) : []
      const dueWeeklyTodos = dateStr ? this.settings.weeklyTodos
        .filter((todo) => isWeeklyTodoDue(todo, dateStr))
        .sort((a, b) => a.order - b.order) : []
      const needsWeeklyLedger = dueHabits.some((habit) => habit.targetPeriod === "week") || dueWeeklyTodos.length > 0
      const weeklyDatedEntries = dateStr && needsWeeklyLedger
        ? this.datedEntriesForWeek(dateStr, doc.entries)
        : (dateStr ? [{ date: dateStr, entries: doc.entries }] : [])
      const weeklyEntries = weeklyDatedEntries.flatMap((item) => item.entries)
      const layoutHas = (id: string): boolean => Boolean(doc.layout?.some((item) => item.id === id))
      const extraSlots: GridItem[] = []
      if (dueHabits.length > 0 || layoutHas("habits")) {
        extraSlots.push(defaultComponentSlot("habits", Math.max(HABITS_EMPTY_ROWS, dueHabits.length * 2 + 2), doc.side))
      }
      if (doc.todos.length > 0 || dueWeeklyTodos.length > 0 || layoutHas("todos")) {
        extraSlots.push(defaultComponentSlot("todos", Math.max(5, (doc.todos.length + dueWeeklyTodos.length) * 2 + 3), doc.side))
      }
      if (layoutHas("quote")) extraSlots.push(defaultComponentSlot("quote", QUOTE_ROWS, doc.side))
      const diaryItems = hourlogItems(doc)
      const pendingDiary = this.pendingHourlog && this.pendingHourlog.date === dateStr ? this.pendingHourlog : null
      if ((diaryItems.length > 0 || layoutHas("hourlog") || pendingDiary) && !doc.hiddenSlots.includes("hourlog")) {
        extraSlots.push(defaultComponentSlot("hourlog", Math.max(HOURLOG_ROWS, diaryItems.length * 4 + 6), doc.side))
      }
      const textBlockKey = {
        ...this.mutationBlockKey(el, ctx), source,
        section: () => el.isConnected ? ctx.getSectionInfo(el) : null,
      }
      const blockIdentity: BlockIdentity<object> = {
        owner: textBlockKey.owner,
        path: textBlockKey.path,
        blockOrdinal: textBlockKey.blockOrdinal,
      }
      const draftBlockOrdinal = textBlockKey.blockOrdinal
      const textDraftKey = (index: number): TextDraftKey<object> => ({
        owner: textBlockKey.owner,
        path: textBlockKey.path,
        blockOrdinal: draftBlockOrdinal,
        index,
      })
      const saveText = async (index: number, text: string): Promise<void> => {
        try {
          const key = textDraftKey(index)
          await this.textDrafts.enqueue(key, () =>
            this.applyTextBlockTransform(textBlockKey, (s) => setTextSection(s, text, index))
          )
        } catch (error) {
          new Notice(error instanceof Error ? error.message : tr("textSaveFailed"), 8000)
          throw error
        }
      }
      const container = renderTimelineInto(
        el,
        doc,
        {
          typeColors: spanPaletteForRender,
          markerTypeColors: markerPaletteForRender,
          hourHeight: this.settings.hourHeight,
          width: this.settings.width,
          showTimelineOnboarding,
          extraSlots,
          tagStyle,
          onAddFirstCategory: () => this.openCategorySettings(this.drawTool),
        },
        {
          renderMarkdown: (host, text) => {
            // 单换行 -> markdown 硬换行（行尾两空格）：无论 Obsidian 段落策略如何，
            // 单换行都留在同一段落内，p+p 间距只对应源码真正的空行（yyt 2026-08-19）
            const normalized = text.replace(/(?<!\n)\n(?!\n)/g, "  \n")
            void MarkdownRenderer.render(this.app, normalized, host, ctx.sourcePath, this)
          },
          onSave: saveText,
          onRenameTitle: (index, title) => this.applyBlockTransform(el, ctx, source, (s) => setTextTitle(s, index, title || undefined)),
          autoRenameIndex: (() => {
            const pending = this.pendingSectionRename
            if (!pending || pending.path !== ctx.sourcePath || pending.index >= doc.texts.length) return undefined
            this.pendingSectionRename = null
            return pending.index
          })(),
          getDraft: (index) => this.textDrafts.get(textDraftKey(index)),
          onDraftChange: (index, draft, savedValue) => {
            const key = textDraftKey(index)
            // A completion from a disposed renderer must not replace or clear
            // newer typing in the remounted editor.
            if (savedValue !== undefined && this.textDrafts.get(key)?.value !== savedValue) return
            if (draft) this.textDrafts.set(key, draft)
            else this.textDrafts.delete(key)
          },
        }
      )
      const previewTimeline = (nextSource: string): (() => void) | null =>
        this.timelineVisuals.preview(el, nextSource)
      const mountCurrentSourceMode = (session: SourceModeSession): void => {
        mountSourceMode(container, session.draft, {
          validate: (draft) => sourceDraftCanApply(draft, (value) => this.parse(value)),
          onDraftChange: (draft) => {
            session.draft = draft
            this.sourceDrafts.set(el, session)
          },
          onCancel: () => {
            this.sourceDrafts.delete(el)
          },
          onApply: async (draft) => {
            // Delete before the write so a synchronous processor remount cannot
            // reopen source mode after a successful transaction. Restore only
            // when the mutation fails; the user's draft then remains intact.
            this.sourceDrafts.delete(el)
            try {
              await this.applyBlockTransform(el, ctx, source, (liveSource) => {
                if (!sourceDraftMatchesLive(session.originalSource, liveSource)) {
                  throw new Error(tr("sourceChanged"))
                }
                const errors = sourceDraftCanApply(draft, (value) => this.parse(value))
                if (errors.length > 0) {
                  throw new Error(tr("sourceLineError", {
                    line: errors[0].line + 1,
                    reason: errors[0].reason,
                  }))
                }
                return draft
              })
            } catch (error) {
              session.draft = draft
              this.sourceDrafts.set(el, session)
              throw error
            }
          },
        })
      }
      if (showTimelineOnboarding) {
        // 先同步关掉内存中的门，再异步持久化：同一页面有多个空块时也只展示一次。
        this.settings.timelineOnboardingSeen = true
        void this.saveSettings()
      }
      // 色板 = 全局 ∪ 本块用过的类型（旧块用过的已删类型保留显示，yyt 2026-08-17）
      const usedSpanTypes = [...new Set(doc.entries.map((entry) => entry.type))]
      const usedMarkerTypes = [...new Set(doc.annotations.flatMap((marker) => marker.type ? [marker.type] : []))]
      const spanPaletteTypes = [...Object.keys(this.settings.spanTypeColors), ...usedSpanTypes.filter((type) => !(type in this.settings.spanTypeColors))]
      const markerPaletteTypes = [...Object.keys(this.settings.markerTypeColors), ...usedMarkerTypes.filter((type) => !(type in this.settings.markerTypeColors))]
      const spanPaletteColors = Object.fromEntries(spanPaletteTypes.map((type) => [type, spanPaletteForRender[type] ?? hashTypeColor(type)]))
      const markerPaletteColors = Object.fromEntries(markerPaletteTypes.map((type) => [type, markerPaletteForRender[type] ?? hashTypeColor(type)]))
      const visibleSpanTypes = spanPaletteTypes.filter((type) => !doc.hiddenTypes.includes(type))
      const visibleMarkerTypes = markerPaletteTypes.filter((type) => !doc.hiddenMarkerTypes.includes(type))
      // 可用类型属于“这个 block”的状态；不能让一个全隐藏 block 把同页其它
      // block 的画笔清空，也不能让其它 block 的偏好穿透进全隐藏 block。
      let blockActiveSpanType = pickVisibleType(this.activeSpanType, visibleSpanTypes)
      let blockActiveMarkerType = pickVisibleType(this.activeMarkerType, visibleMarkerTypes)
      if (this.activeSpanType === "" && blockActiveSpanType) this.activeSpanType = blockActiveSpanType
      if (this.activeMarkerType === "" && blockActiveMarkerType) this.activeMarkerType = blockActiveMarkerType

      const slotLabels: Record<string, string> = {
        toolbar: tr("category"),
        stats: tr("statistics"),
        dialog: tr("quickRecord"),
        habits: tr("habits"),
        todos: tr("todos"),
        quote: tr("dailyQuote"),
        hourlog: tr("hourlog"),
      }

      const showMoreMenu = (x: number, y: number): void => {
        const menu = new Menu()
        menu.addItem((item) => item.setTitle(tr("editSource")).setIcon("code-2").setSection("source").onClick(() => {
          const session = this.sourceDrafts.get(el) ?? { originalSource: source, draft: source }
          this.sourceDrafts.set(el, session)
          mountCurrentSourceMode(session)
        }))
        menu.addSeparator()
        menu.addItem((item) => item.setTitle(tr("components")).setIsLabel(true).setSection("components"))
        // 添加文本框（常驻，可多个；落在点击的格子附近）。带标题的栏目（感恩日记、阅读笔记…）走同一条路。
        const addTextSection = (title?: string): void => {
            void this.applyBlockTransform(el, ctx, source, (s) => {
              const newId = doc.texts.length === 0 ? "text" : `text${doc.texts.length + 1}`
              let out = setTextSection(s, "", doc.texts.length, title) // 追加空文本区
              if (body) {
                const bodyRect = body.getBoundingClientRect()
                if (bodyRect.width > 100) {
                  const columns = Number(body.dataset.gridCols) || GRID_COLS
                  const cellW = bodyRect.width / columns
                  const gx = Math.min(MAX_GRID_COLS - 6, Math.max(0, Math.floor((x - bodyRect.left) / cellW)))
                  const gy = Math.max(0, Math.floor((y - bodyRect.top) / GRID_ROW_H))
                  const items = Array.from(body.querySelectorAll<HTMLElement>(".modular-diary-slot")).map((sl) => ({
                    id: sl.dataset.slot as GridItem["id"],
                    x: Number(sl.dataset.x), y: Number(sl.dataset.y), w: Number(sl.dataset.w), h: Number(sl.dataset.h),
                  }))
                  items.push({ id: newId, x: gx, y: gy, w: 6, h: 4 })
                  out = setHeaderValue(out, "layout", serializeLayoutHeader(compactGrid(items, newId)))
                }
              }
              return out
            })
        }
        menu.addItem((item) => item.setTitle(tr("addTextBox")).setIcon("file-plus-2").setSection("components").onClick(() => addTextSection()))
        menu.addItem((item) => {
          item.setTitle(tr("addTitledSection")).setIcon("heading").setSection("components")
          const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.()
          const target = sub ?? menu
          for (const preset of [tr("sectionGratitude"), tr("sectionReading"), tr("sectionReview")]) {
            target.addItem((presetItem) => presetItem.setTitle(preset).onClick(() => addTextSection(preset)))
          }
          target.addItem((presetItem) => presetItem.setTitle(tr("sectionCustom")).onClick(() => {
            // A custom section opens with its title ready to type.
            this.pendingSectionRename = { path: ctx.sourcePath, index: doc.texts.length }
            addTextSection(tr("sectionNew"))
          }))
        })
        for (const [slotId, label, icon] of [
          ["habits", tr("addHabitComponent"), "list-checks"],
          ["todos", tr("addTodoComponent"), "list-todo"],
          ["quote", tr("addDailyQuoteComponent"), "quote"],
          ["hourlog", tr("addHourlogComponent"), "book-open-text"],
        ] as const) {
          if (container.querySelector(`.modular-diary-slot-${slotId}`) || doc.hiddenSlots.includes(slotId)) continue
          menu.addItem((item) => item.setTitle(label).setIcon(icon).setSection("components").onClick(() => {
            void this.applyBlockTransform(el, ctx, source, (value) => this.addComponentSlot(value, doc, container, slotId))
          }))
        }
        // 隐藏组件恢复（off: 头）
        for (const slotId of doc.hiddenSlots) {
          menu.addItem((item) =>
            item.setTitle(tr("showComponent", { name: slotLabels[slotId] ?? slotId })).setIcon("eye").setSection("components").onClick(() => {
              void this.applyBlockTransform(el, ctx, source, (s) => removeOffSlot(s, slotId))
            })
          )
        }
        menu.addSeparator()
        menu.addItem((item) => item.setTitle(tr("layout")).setIsLabel(true).setSection("layout"))
        menu.addItem((item) =>
          item.setTitle(tr("setDefaultLayout")).setIcon("bookmark").setSection("layout").onClick(() => {
            const previousLayout = this.settings.templateLayout
            const previousWidth = this.settings.templateWidth
            const previousHasText = this.settings.templateHasText
            if (body) {
              const items = Array.from(body.querySelectorAll<HTMLElement>(".modular-diary-slot")).map((sl) => ({
                id: sl.dataset.slot as GridItem["id"],
                x: Number(sl.dataset.x), y: Number(sl.dataset.y), w: Number(sl.dataset.w), h: Number(sl.dataset.h),
              }))
              this.settings.templateLayout = serializeLayoutHeader(items)
            }
            this.settings.templateWidth = doc.width
            this.settings.templateHasText = doc.texts.length > 0
            // The template is now this block's shape: layout as it sits on screen, hidden
            // components, todo layout and every text section with its title. The old one
            // can come back from the notice.
            const previous = { source: this.settings.templateSource, layout: previousLayout, width: previousWidth, hasText: previousHasText }
            this.settings.templateSource = skeletonFromSource(this.settings.templateLayout ? setHeaderValue(source, "layout", this.settings.templateLayout) : source)
            const notice = new Notice(tr("templateSaved"), 8000)
            const undo = notice.noticeEl.createEl("button", { cls: "modular-diary-notice-undo", text: tr("undo") })
            undo.addEventListener("click", () => {
              this.settings.templateSource = previous.source
              this.settings.templateLayout = previous.layout
              this.settings.templateWidth = previous.width
              this.settings.templateHasText = previous.hasText
              void this.saveSettings()
              notice.hide()
            })
            void this.saveSettings()
          })
        )
        menu.addItem((item) =>
          item.setTitle(tr("resetLayout")).setIcon("layout-grid").setSection("layout").onClick(() => {
            void this.applyBlockTransform(el, ctx, source, (s) => removeHeaderValue(s, "layout"))
          })
        )
        menu.addSeparator()
        menu.addItem((item) =>
          item
            .setTitle(tr("deleteModularDiaryBlock"))
            .setIcon("trash-2")
            .setWarning(true)
            .setSection("danger")
            .onClick(() => {
              void this.deleteTimelineBlock(el, ctx).catch((error: unknown) => {
                console.error("Modular Diary: failed to delete timeline block", error)
                new Notice(error instanceof Error ? error.message : tr("sourceChanged"))
              })
            })
        )
        menu.showAtPosition({ x, y }, dom)
      }

      const liveContainer = (): HTMLElement | null => {
        if (container.isConnected) return container
        return this.timelineVisuals
          .findHost(blockIdentity.path, blockIdentity.owner, blockIdentity.blockOrdinal)
          ?.querySelector<HTMLElement>(".modular-diary-container") ?? null
      }
      const targetForEntryLine = (line: number): EntryTarget | null => {
        const entry = doc.entries.find((item) => item.line === line)
        return entry ? captureEntryTarget(entry) : null
      }
      const targetForMarkerLine = (line: number): MarkerTarget | null => {
        const marker = doc.annotations.find((item) => item.line === line && item.type)
        return marker ? captureMarkerTarget(marker) : null
      }
      const rewriteEntryTarget = (
        value: string,
        target: EntryTarget,
        update: (entry: Entry) => string,
      ): string => {
        const current = resolveEntryTarget(this.parse(value).entries, target)
        if (!current) throw new Error(tr("sourceChanged"))
        return replaceEntryLine(value, current.line, update(current))
      }
      const rewriteMarkerTarget = (
        value: string,
        target: MarkerTarget,
        update: (marker: Annotation) => string,
      ): string => {
        const current = resolveMarkerTarget(this.parse(value).annotations, target)
        if (!current?.type) throw new Error(tr("sourceChanged"))
        return replaceEntryLine(value, current.line, update(current))
      }
      const currentEditingLine = (): number | null => {
        const state = this.editing
        if (!state || !sameBlock(state, blockIdentity)) return null
        const current = resolveEntryTarget(doc.entries, state.target)
        if (!current) {
          this.editing = null
          return null
        }
        state.target.line = current.line
        return current.line
      }
      const currentMarkerEditingLine = (): number | null => {
        const state = this.markerEditing
        if (!state || !sameBlock(state, blockIdentity)) return null
        const current = resolveMarkerTarget(doc.annotations, state.target)
        if (!current) {
          this.markerEditing = null
          return null
        }
        state.target.line = current.line
        return current.line
      }
      const clearBlockEditState = (): void => {
        if (sameBlock(this.editing, blockIdentity)) this.editing = null
        if (sameBlock(this.markerEditing, blockIdentity)) this.markerEditing = null
      }

      const hourlogKey = `${ctx.sourcePath}#${this.scrollTransactionKey(el, ctx).blockOrdinal}`
      const flashTimeline = (line: number): void => {
        const live = liveContainer()
        const target = live?.querySelector<Element>(`rect.modular-diary-block[data-line="${line}"], .modular-diary-diary-mark[data-line="${line}"]`)
        if (!target) return
        target.scrollIntoView({ block: "nearest", inline: "nearest" })
        target.classList.add("is-flash")
        dom.defaultView?.setTimeout(() => target.classList.remove("is-flash"), 1400)
      }
      const focusDiaryCard = (line: number): void => {
        const card = liveContainer()?.querySelector<HTMLElement>(`.modular-diary-hourlog-item[data-line="${line}"]`)
        if (!card) return
        card.scrollIntoView({ block: "nearest" })
        card.classList.add("is-flash")
        dom.defaultView?.setTimeout(() => card.classList.remove("is-flash"), 1400)
        const area = card.querySelector<HTMLTextAreaElement>("textarea")
        if (area) { area.focus({ preventScroll: true }); area.setSelectionRange(area.value.length, area.value.length) }
      }
      const editNote = (ln: number, suffix = ""): void => {
        const target = targetForEntryLine(ln)
        // 写回触发的重渲染可能已替换 container；只允许回到同一个块，
        // 绝不能用 document.querySelector 命中同页/同文件的另一个块。
        const live = liveContainer()
        if (!live) return
        const rect = live.querySelector(`rect.modular-diary-block[data-line="${ln}"]`)
        const e0 = doc.entries.find((it) => it.line === ln)
        if (!rect || !e0 || !target) return
        openNotePopover(live, rect, rect.getBoundingClientRect(), `${e0.note ?? ""}${suffix}`, async (typed) => {
          const note = suffix ? typed.replace(/\s*#\s*$/, "") : typed
          if (suffix && note === (e0.note ?? "")) return
          try {
            await this.applyBlockTransform(el, ctx, source, (s) => {
              const entries = this.parse(s).entries
              // A failed disk acknowledgement may follow a successful editor
              // mutation. Retrying that exact intended value is safe too.
              const current = resolveEntryTarget(entries, target)
                ?? resolveEntryTarget(entries, captureEntryTarget({ ...e0, note: note || undefined }))
              if (!current) throw new Error(tr("sourceChanged"))
              return replaceEntryLine(s, current.line, formatEntryLine({ ...current, note: note || undefined }))
            }, { previewVisual: previewTimeline })
          } catch (error) {
            if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) {
              new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 8000)
            }
            throw error
          }
        })
        if (suffix) {
          // Put the caret after the "#" and let the tag picker open straight away.
          const input = dom.querySelector<HTMLInputElement>(".modular-diary-note-popover input")
          if (input) { input.setSelectionRange(input.value.length, input.value.length); input.dispatchEvent(new Event("input", { bubbles: true })) }
        }
      }

      const toolbar = buildToolbar({
        typeColors: spanPaletteColors,
        markerTypeColors: markerPaletteColors,
        hiddenTypes: doc.hiddenTypes,
        markerHiddenTypes: doc.hiddenMarkerTypes,
        activeType: blockActiveSpanType,
        activeMarkerType: blockActiveMarkerType,
        brushMode: this.drawMode,
        drawTool: this.drawTool,
        onDrawToolChange: (tool) => { this.drawTool = tool },
        onBrushModeChange: (mode) => {
          this.drawMode = mode
        },
        onSelect: (type) => {
          if (this.drawTool === "marker") {
            blockActiveMarkerType = type
            this.activeMarkerType = type
          } else {
            blockActiveSpanType = type
            this.activeSpanType = type
          }
        },
        onHide: (type) => {
          void this.applyBlockTransform(el, ctx, source, (s) => addHiddenType(s, type, this.drawTool))
        },
        onShow: (type) => {
          void this.applyBlockTransform(el, ctx, source, (s) => removeHiddenType(s, type, this.drawTool))
        },
        onAddNew: () => this.openCategorySettings(this.drawTool),
        categoriesCollapsed: this.settings.categoriesCollapsed,
        onCategoriesCollapsedChange: (collapsed) => {
          this.settings.categoriesCollapsed = collapsed
          void this.saveSettings()
        },
        domDocument: dom,
      })
      // 填槽：工具栏/状态行/对话框各就各位（插槽位置由 layout 决定）
      const toolbarSlot = container.querySelector<HTMLElement>(".modular-diary-slot-toolbar")
      if (toolbarSlot) {
        // Geometry controls are still real content when the selected tool has
        // no categories.  Only the second row is empty; preserving the normal
        // slot shell keeps both tools on the same top/content inset.
        toolbarSlot.classList.remove("is-empty-state")
        toolbarSlot.appendChild(toolbar.el)
      }
      const timelineSlot = container.querySelector<HTMLElement>(".modular-diary-slot-timeline")
      if (timelineSlot) {
        timelineSlot.appendChild(toolbar.statusEl)
        // 顶栏：日期+星期（跨期统计锚点）在左，记录/计划开关在右
        const topbar = dom.createElement("div")
        topbar.className = "modular-diary-timeline-topbar" // 宽度跟随元素块（槽位），非时间轴矩形
        if (dateStr) {
          const wd = weekdayLabel(dateStr)
          const dateEl = buildTimelineDateControl(container, dateStr, wd, (date) => {
            void this.applyBlockTransform(el, ctx, source, (value) => setHeaderValue(value, "date", date))
          })
          topbar.appendChild(dateEl)
        }
        topbar.appendChild(buildLayerToggles(this.layerView, (view) => {
          this.layerView = view
          this.applyViewClass(container, view)
          // 只剩单图层时联动画笔（都亮则不动，画笔可独立切）
          if (view.actual && !view.plan) this.drawMode = "actual"
          else if (view.plan && !view.actual) this.drawMode = "plan"
          toolbar.setBrushMode(this.drawMode)
        }, dom))
        timelineSlot.prepend(topbar)
        // 窄槽位：图层开关退化为纯图标，顶栏永不换行（chrome 高度保持常量）。
        attachRowCompaction(topbar, TIMELINE_TOPBAR_COMPACTION)
      }

      const habitsSlot = container.querySelector<HTMLElement>(".modular-diary-slot-habits")
      if (habitsSlot) {
        renderHabitsInto(habitsSlot, dueHabits.map((habit) => ({
          habit,
          progress: habitProgress(
            habit,
            habit.targetPeriod === "week" ? weeklyEntries : doc.entries,
            habit.targetPeriod === "week" ? weeklyDatedEntries : []
          ),
        })), {
          typeColors: spanPaletteForRender,
          onEdit: () => this.openHabitSettings(),
          onMove: (id, targetIndex) => {
            this.settings.habits = moveHabitInVisibleOrder(
              this.settings.habits, dueHabits.map((habit) => habit.id), id, targetIndex,
            )
            void this.saveSettings({ rerender: true })
          },
          onMenu: (habit, x, y) => {
            const menu = new Menu()
            if (dateStr) menu.addItem((item) => item.setTitle(tr("skipToday")).setIcon("calendar-x-2").onClick(() => {
              void this.applyBlockTransform(el, ctx, source, (value) => addHabitSkip(value, habit.id))
            }))
            if (dateStr) menu.addItem((item) => item.setTitle(tr("endFutureHabit")).setIcon("calendar-off").onClick(() => {
              const stored = this.settings.habits.find((item) => item.id === habit.id)
              if (!stored) return
              stored.endDate = this.previousDate(dateStr)
              void this.saveSettings({ rerender: true })
            }))
            menu.addItem((item) => item.setTitle(tr("habitSettings")).setIcon("settings-2").onClick(() => this.openHabitSettings()))
            menu.showAtPosition({ x, y }, dom)
          },
        })
      }

      const todosSlot = container.querySelector<HTMLElement>(".modular-diary-slot-todos")
      const todoViewItems: TodoViewItem[] = [
        ...doc.todos.map((todo) => {
          const metrics = todoMetrics(todo, doc.entries)
          return { ...todo, weekly: false, estimateMinutes: metrics.estimateMinutes, actualMinutes: metrics.actualMinutes, movedTo: todo.moved, bucket: todo.bucket }
        }),
        ...dueWeeklyTodos.map((todo) => {
          const actualMinutes = weeklyEntries
            .filter((entry) => !entry.plan && entry.todoId === todo.id)
            .reduce((sum, entry) => sum + entry.endMin - entry.startMin, 0)
          return {
            ...todo, weekly: true, estimateMinutes: todo.targetMinutes, actualMinutes,
            completed: actualMinutes >= todo.targetMinutes,
          }
        }),
      ]
      if (todosSlot) {
        const draftKey = this.scrollTransactionKey(el, ctx)
        let ownerDrafts = this.todoDrafts.get(draftKey.owner)
        if (!ownerDrafts) {
          ownerDrafts = new Map()
          this.todoDrafts.set(draftKey.owner, ownerDrafts)
        }
        let ownerEditDrafts = this.todoEditDrafts.get(draftKey.owner)
        if (!ownerEditDrafts) {
          ownerEditDrafts = new Map()
          this.todoEditDrafts.set(draftKey.owner, ownerEditDrafts)
        }
        const draftId = `${draftKey.path}\u0000${draftKey.blockOrdinal}`
        const editDraft = ownerEditDrafts.get(draftId) ?? null
        if (editDraft && !todoViewItems.some((item) => item.id === editDraft.id)) ownerEditDrafts.delete(draftId)
        renderTodosInto(todosSlot, todoViewItems, {
          categories: spanPaletteTypes,
          tagStyle,
          tagSuggest: this.tagSuggestDeps(),
          typeColors: spanPaletteForRender,
          view: doc.todoView,
          draft: ownerDrafts.get(draftId) ?? null,
          onDraftChange: (draft) => {
            if (draft) ownerDrafts?.set(draftId, { ...draft })
            else ownerDrafts?.delete(draftId)
          },
          editDraft: ownerEditDrafts.get(draftId) ?? null,
          onEditDraftChange: (draft) => {
            if (draft) ownerEditDrafts?.set(draftId, { id: draft.id, input: { ...draft.input } })
            else ownerEditDrafts?.delete(draftId)
          },
          onSetBucket: (id, bucket, beforeId) => void this.applyBlockTransform(el, ctx, source, (value) => placeTodoInBucket(value, id, bucket, beforeId ?? null)),
          groupOrder: doc.todoGroupOrder,
          onMoveGroup: (key, targetIndex) => {
            const tree = groupTodoTree(todoViewItems, doc.todoView, doc.todoGroupOrder)
            void this.applyBlockTransform(el, ctx, source, (value) =>
              setHeaderValue(value, "todo-groups", JSON.stringify(moveTodoGroupKey(tree, key, targetIndex))))
          },
          onLayoutMenu: (x, y) => {
            const menu = new Menu()
            const current = doc.todoView.layout ?? "list"
            for (const [value, label, icon] of [["list", tr("todoLayoutList"), "list"], ["abc", tr("todoLayoutAbc"), "columns-3"], ["matrix", tr("todoLayoutMatrix"), "grid-2x2"]] as const) {
              menu.addItem((item) => item.setTitle(label).setIcon(icon).setChecked(current === value).onClick(() =>
                void this.applyBlockTransform(el, ctx, source, (text) =>
                  setHeaderValue(text, "todo-view", formatTodoViewHeaderValue({ ...doc.todoView, layout: value })))))
            }
            menu.showAtPosition({ x, y }, dom)
          },
          onGroupMenu: (x, y) => {
            const setView = (patch: Partial<typeof doc.todoView>): void => {
              const next = { ...doc.todoView, ...patch }
              void this.applyBlockTransform(el, ctx, source, (value) =>
                setHeaderValue(value, "todo-view", formatTodoViewHeaderValue(next)))
            }
            this.showTodoGroupMenu(dom, x, y, doc.todoView, setView)
          },
          onSortMenu: (x, y) => {
            const menu = new Menu()
            const setView = (patch: Partial<typeof doc.todoView>): void => {
              const next = { ...doc.todoView, ...patch }
              void this.applyBlockTransform(el, ctx, source, (value) =>
                setHeaderValue(value, "todo-view", formatTodoViewHeaderValue(next)))
            }
            buildTodoSortMenuOptions(doc.todoView.sortBy, {
              manual: tr("todoSortManual"),
              estimate: tr("todoSortEstimate"),
              actual: tr("todoSortActual"),
            }).forEach(({ value, title, checked }) => menu.addItem((item) => item
              .setTitle(title)
              .setChecked(checked)
              .onClick(() => setView({ sortBy: value }))))
            menu.showAtPosition({ x, y }, dom)
          },
          onAdd: (input) => {
            const value = {
              id: `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              title: input.title, group: "", type: input.type,
              estimateMin: input.estimateMinutes, completed: false,
              ...(input.bucket ? { bucket: input.bucket } : {}),
              ...(input.note ? { note: input.note } : {}),
            }
            void this.applyBlockTransform(el, ctx, source, (current) => insertTodo(
              this.addComponentSlot(current, doc, container, "todos"), value
            ))
          },
          onEdit: (id, input) => {
            const weekly = this.settings.weeklyTodos.find((item) => item.id === id)
            if (weekly) {
              weekly.title = input.title
              weekly.type = input.type
              weekly.targetMinutes = input.estimateMinutes
              weekly.note = input.note
              void this.saveSettings({ rerender: true })
              return
            }
            void this.applyBlockTransform(el, ctx, source, (value) => updateTodo(value, id, {
              title: input.title,
              type: input.type,
              estimateMin: input.estimateMinutes,
              note: input.note,
            }))
          },
          onToggle: (id, completed) => {
            return this.applyBlockTransform(el, ctx, source, (value) => updateTodo(value, id, { completed }))
          },
          onMove: (id, targetIndex) => {
            const weekly = this.settings.weeklyTodos.find((item) => item.id === id)
            if (weekly) {
              const ordered = [...this.settings.weeklyTodos].sort((a, b) => a.order - b.order)
              const from = ordered.findIndex((item) => item.id === id)
              const [moved] = ordered.splice(from, 1)
              ordered.splice(Math.max(0, Math.min(targetIndex - doc.todos.length, ordered.length)), 0, moved)
              ordered.forEach((item, index) => { item.order = index })
              this.settings.weeklyTodos = ordered
              void this.saveSettings({ rerender: true })
            } else void this.applyBlockTransform(el, ctx, source, (value) => moveTodo(value, id, targetIndex))
          },
          onMenu: (todo, x, y, edit) => {
            const menu = new Menu()
            menu.addItem((item) => item.setTitle(tr("editTodo")).setIcon("pencil").onClick(edit))
            const layoutNow = doc.todoView.layout ?? "list"
            if (layoutNow !== "list" && !todo.weekly) menu.addItem((item) => {
              // Keyboard path into a cell, mirroring the grip drag.
              item.setTitle(tr("moveToBucket")).setIcon("move-right")
              const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.() ?? menu
              for (const [key, labelKey] of [...TODO_BUCKETS[layoutNow], ["", "bucketNone"] as const]) {
                sub.addItem((cell) => cell.setTitle(tr(labelKey)).setChecked((todo.bucket ?? "") === key).onClick(() =>
                  void this.applyBlockTransform(el, ctx, source, (value) => updateTodo(value, todo.id, { bucket: key || undefined }))))
              }
            })
            if (todo.weekly && dateStr) {
              menu.addItem((item) => item.setTitle(tr("endFutureTodo")).setIcon("calendar-off").onClick(() => {
                const stored = this.settings.weeklyTodos.find((item) => item.id === todo.id)
                if (!stored) return
                stored.endDate = this.previousDate(dateStr)
                void this.saveSettings({ rerender: true })
              }))
            } else if (todo.movedTo) {
              const movedTo = todo.movedTo
              menu.addItem((item) => item.setTitle(tr("recallTodo")).setIcon("undo-2").onClick(() => {
                void (async () => {
                  try {
                    await this.writeToDay(movedTo, (blockSource) => deleteTodo(blockSource, todo.id))
                    await this.applyBlockTransform(el, ctx, source, (current) => updateTodo(current, todo.id, { moved: undefined }))
                  } catch (error) {
                    console.error("Modular Diary: failed to recall a pushed todo", error)
                    if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) new Notice(tr("periodWriteFailed", { date: movedTo }))
                  }
                })()
              }))
              menu.addItem((item) => item.setTitle(tr("deleteTodo")).setIcon("trash").onClick(() => {
                void this.applyBlockTransform(el, ctx, source, (value) => deleteTodo(value, todo.id))
              }))
            } else {
              if (dateStr) menu.addItem((item) => item.setTitle(tr("pushTodoToTomorrow")).setIcon("calendar-plus").onClick(() => {
                const target = shiftDate(dateStr, 1)
                const value = {
                  id: todo.id, title: todo.title, group: todo.group, type: todo.type,
                  estimateMin: todo.estimateMinutes, completed: false, due: doc.todos.find((own) => own.id === todo.id)?.due,
                  bucket: doc.todos.find((own) => own.id === todo.id)?.bucket,
                  note: doc.todos.find((own) => own.id === todo.id)?.note,
                }
                void (async () => {
                  try {
                    // Tomorrow first: if that write fails nothing here changes.
                    // Today's line stays as a shadow (moved=) so the push survives
                    // tomorrow's note being deleted and recreated.
                    await this.writeToDay(target, (blockSource) =>
                      this.parse(blockSource).todos.some((existing) => existing.id === todo.id) ? blockSource : insertTodo(blockSource, value))
                    await this.applyBlockTransform(el, ctx, source, (current) => updateTodo(current, todo.id, { moved: target }))
                    new Notice(tr("pushedTodoToDay", { date: target }))
                  } catch (error) {
                    console.error("Modular Diary: failed to push todo to tomorrow", error)
                    if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) new Notice(tr("pushTodoFailed"))
                  }
                })()
              }))
              menu.addItem((item) => item.setTitle(tr("deleteTodo")).setIcon("trash").onClick(() => {
                void this.applyBlockTransform(el, ctx, source, (value) => deleteTodo(value, todo.id))
              }))
            }
            menu.showAtPosition({ x, y }, dom)
          },
        })
      }

      const hourlogSlot = container.querySelector<HTMLElement>(".modular-diary-slot-hourlog")
      if (hourlogSlot) {
        const isToday = dateStr === inferDate(null)
        const now = new Date()
        const lastEnd = diaryItems.reduce((max, item) => Math.max(max, item.endMin), doc.rangeStart)
        const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : Math.min(doc.rangeEnd, lastEnd + 60)
        const fallback = composerDefaults(diaryItems, nowMin)
        const draft: HourlogComposerDraft = pendingDiary?.draft
          ?? this.hourlogDrafts.get(hourlogKey)
          ?? { startMin: fallback.startMin, endMin: fallback.endMin, link: null, body: "" }
        if (pendingDiary) this.pendingHourlog = null
        // Every write finds its piece by identity + ordinal + the text it showed; a mismatch refuses.
        const writeBody = (item: HourlogItem, body: string | undefined): Promise<void> => this.applyBlockTransform(el, ctx, source, (s) => {
          const line = locateHourlogItem(this.parse(s), item)
          if (line === null) throw new Error(tr("sourceChanged"))
          // Clearing removes the piece: a block keeps its line without a body; a span goes entirely.
          if (body === undefined && item.kind === "span") return deleteEntryLine(s, line)
          return setItemBody(s, line, body)
        })
        const removePiece = (item: HourlogItem): void => {
          void writeBody(item, undefined).then(() => {
            new Notice(tr("diaryDeleted", { time: formatClockPlain(item.startMin) }))
          }, (error: unknown) => {
            if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) new Notice(error instanceof Error ? error.message : tr("sourceChanged"))
          })
        }
        renderHourlogInto(hourlogSlot, diaryItems, {
          typeColors: spanPaletteForRender,
          tagStyle,
          tagSuggest: this.tagSuggestDeps(),
          linkable: linkableEntries(doc),
          range: { startMin: doc.rangeStart, endMin: doc.rangeEnd },
          composer: draft,
          onComposerChange: (next) => { if (next) this.hourlogDrafts.set(hourlogKey, next); else this.hourlogDrafts.delete(hourlogKey) },
          onCreate: async (next) => {
            await this.applyBlockTransform(el, ctx, source, (s) => {
              if (next.link) {
                // Only a block that still has no diary; an existing body is never replaced.
                const target = findLinkable(this.parse(s), next.link)
                if (!target) throw new Error(tr("sourceChanged"))
                return setItemBody(s, target.line, next.body)
              }
              return insertSpanLine(s, { startMin: next.startMin, endMin: next.endMin, body: next.body })
            })
            this.hourlogDrafts.delete(hourlogKey)
          },
          onSaveBody: (item, body) => writeBody(item, body.trim() ? body : undefined),
          onExtendRange: (startMin) => void this.applyBlockTransform(el, ctx, source, (s) =>
            setHeaderValue(s, "range", `${Math.floor(startMin / 60)}-${Math.ceil(doc.rangeEnd / 60)}`)),
          onMenu: (item, x, y) => {
            const menu = new Menu()
            menu.addItem((mi) => mi.setTitle(tr("showOnTimeline")).setIcon("crosshair").onClick(() => flashTimeline(item.line)))
            menu.addItem((mi) => mi.setTitle(tr("deleteDiary")).setIcon("trash").onClick(() => removePiece(item)))
            menu.showAtPosition({ x, y }, dom)
          },
          onLocate: (item) => flashTimeline(item.line),
        })
      }
      // Brackets on the timeline lead to their piece of diary.
      container.querySelectorAll<SVGGElement>(".modular-diary-diary-mark").forEach((mark) => {
        mark.addEventListener("click", (event) => { event.stopPropagation(); focusDiaryCard(Number(mark.dataset.line)) })
        mark.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          focusDiaryCard(Number(mark.dataset.line))
        })
        mark.addEventListener("pointerdown", (event) => event.stopPropagation())
      })

      const quoteSlot = container.querySelector<HTMLElement>(".modular-diary-slot-quote")
      if (quoteSlot) {
        // The sentence of the day and its tint come from settings only; the
        // block source carries nothing about quotes (2026-09-10).
        const inkColor = resolveQuoteInk(selectedQuote, this.settings.dailyQuoteInk, {
          ...this.settings.spanRetiredTypeColors,
          ...this.settings.spanTypeColors,
        })
        renderDailyQuoteInto(quoteSlot, selectedQuote, { inkColor }, {
          onEdit: () => new DailyQuoteSettingsModal(this.app, this).open(),
        })
      }
      const col = container.querySelector(".modular-diary-timeline-col")
      const body = container.querySelector<HTMLElement>(".modular-diary-body")
      if (body) {
        attachBlockResize(container, body, {
          initialSize: doc.blockSize,
          initialCanvasWidth: doc.canvasWidth,
          // Height changes are live during pointermove. Capture before that
          // first geometry change, then carry the same immutable snapshot
          // through the Markdown replacement on pointerup.
          onStart: () => this.captureScroll(container),
          onPreview: (snapshot) => restoreViewportAnchor(snapshot.viewport, container),
          onCancel: (snapshot) => restoreInternalScroll(snapshot.internal, container),
          onCommit: (size, canvasWidth, snapshot) => {
            void this.applyBlockTransform(el, ctx, source, (s) => {
              let out = setHeaderValue(s, "block-size", serializeBlockSize(size))
              out = setHeaderValue(out, "canvas-width", String(canvasWidth))
              return out
            }, { scrollSnapshot: snapshot })
          },
        })
      }
      // 先按当前宽度折叠分类，再量高：否则槽位会按未折叠的八行分类撑高。
      toolbar.layout()
      // 自动量高：内容比格子高的槽位撑开格子（修新建块截断），只改显示不自动写源码
      this.fitSlotHeights(container)
      this.restoreScroll(scrollSnapshot, container)
      // 初始调整全部完成后开启动画（is-settling 期间槽位不过渡，杀创建闪缩）
      domWindow?.setTimeout(() => body?.classList.remove("is-settling"), 350)

      // 网格组件交互：拖拽移动 + 八向缩放，写回 layout 头——所有块可用
      if (body) {
        attachGridInteract(body, (items) => {
          void this.applyBlockTransform(
            el,
            ctx,
            source,
            (s) => setHeaderValue(s, "layout", serializeLayoutHeader(items)),
            { remountVisual: "live-preview" }
          )
        })
      }

      const wireTimeline = (): void => {
        const deleteTimelineEntry = async (line: number): Promise<void> => {
          const target = targetForEntryLine(line)
          if (!target) throw new Error(tr("sourceChanged"))
          // Context-menu deletion does not pass through the keyboard handler.
          // End the current edit session before the source mutation so a
          // synchronous Obsidian rerender cannot reuse the deleted line number.
          if (sameBlock(this.editing, blockIdentity) && currentEditingLine() === line) {
            const svgEl = container.querySelector<SVGSVGElement>("svg.modular-diary-svg")
            if (svgEl) {
              const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
              svgEl.dispatchEvent(new CustomEventCtor("modular-diary-exit-edit"))
            }
            // The DOM may already have been detached; keep the model invariant
            // independent from whether the visual cleanup listener was present.
            this.editing = null
          }
          try {
            await this.applyBlockTransform(el, ctx, source, (s) => {
              const current = resolveEntryTarget(this.parse(s).entries, target)
              if (!current) throw new Error(tr("sourceChanged"))
              return deleteEntryLine(s, current.line)
            }, {
              previewVisual: previewTimeline,
            })
          } catch (error) {
            if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) {
              new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 8000)
            }
            throw error
          }
        }
        const requestDeleteTimelineEntry = (line: number): void => {
          const svgEl = container.querySelector<SVGSVGElement>("svg.modular-diary-svg")
          if (svgEl && requestTimelineEntryDelete(svgEl, line)) return
          void deleteTimelineEntry(line)
        }

        attachHoverInfo(container, doc)
        attachDrawInteraction(container, doc, {
        hourHeight: this.settings.hourHeight,
        getActiveType: () => blockActiveSpanType || null,
        getMode: () => this.drawMode,
        getTool: () => this.drawTool,
        isInteractionLocked: () => sameBlock(this.markerEditing, blockIdentity),
        typeColor: (type) => spanPaletteForRender[type] ?? hashTypeColor(type),
        onCreate: (entryLine, startMin) => {
          clearBlockEditState()
          return this.applyBlockTransform(
            el,
            ctx,
            source,
            (s) => insertEntryLine(this.persistLayoutOnce(s, doc, container), entryLine, startMin),
            { previewVisual: previewTimeline },
          )
        },
        onBlockClick: (line) => {
          toggleBlockFocus(container, line)
        },
        onTrackMenu: (x, y) => {
          showMoreMenu(x, y)
        },
        onExtendRange: (startMin, endMin) => {
          // Range steps change the whole SVG frame. Paint that final frame in
          // the mounted timeline first; otherwise the generic remount bridge
          // and the replacement processor can expose two complete timelines.
          return this.applyBlockTransform(
            el,
            ctx,
            source,
            (s) => setHeaderValue(s, "range", `${Math.round(startMin / 60)}-${Math.round(endMin / 60)}`),
            { previewVisual: previewTimeline },
          )
        },
        onEditNote: (ln) => editNote(ln),
        onDeleteEntry: deleteTimelineEntry,
        getEditingLine: currentEditingLine,
        setEditingLine: (line) => {
          if (line === null) {
            if (sameBlock(this.editing, blockIdentity)) this.editing = null
            return
          }
          const target = targetForEntryLine(line)
          this.editing = target ? { ...blockIdentity, target } : null
        },
        onUpdateSpan: (line, startMin, endMin) => {
          const target = targetForEntryLine(line)
          if (!target) return Promise.reject(new Error(tr("sourceChanged")))
          const original = doc.entries.find((entry) => entry.line === line)
          if (sameBlock(this.editing, blockIdentity) && original) {
            this.editing = {
              ...blockIdentity,
              target: captureEntryTarget({ ...original, startMin, endMin }),
            }
          }
          return this.applyBlockTransform(el, ctx, source, (s) => rewriteEntryTarget(
            s,
            target,
            (entry) => formatEntryLine({ ...entry, startMin, endMin }),
          ), { previewVisual: previewTimeline })
        },
        onMutationError: (error) => {
          // Durable-write failures already emitted the persistent warning at
          // the commit boundary. Earlier ownership/source failures arrive
          // here and must not remain silent.
          const alreadyReported = error instanceof Error
            && Boolean((error as Error & { modularDiaryNoticeReported?: boolean }).modularDiaryNoticeReported)
          if (!alreadyReported) {
            new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 0)
          }
        },
        onBlockMenu: (line, x, y) => {
          const entry = doc.entries.find((e) => e.line === line)
          const menuTarget = entry ? captureEntryTarget(entry) : null
          if (!entry || !menuTarget) return
          showBlockMenu(this.app, entry, spanPaletteTypes, todoViewItems.map((todo) => ({ id: todo.id, title: todo.title })), x, y, {
            editNote,
            addTag: (ln) => editNote(ln, `${entry.note ? " " : ""}#`),
            openDiary: (ln) => {
              const existing = container.querySelector<HTMLElement>(`.modular-diary-hourlog-item[data-line="${ln}"]`)
              if (existing) { focusDiaryCard(ln); return }
              // Start a piece on this block: the composer opens linked to it.
              const draft: HourlogComposerDraft = { startMin: entry.startMin, endMin: entry.endMin, link: linkOf(entry), body: "", focus: true }
              if (container.querySelector(".modular-diary-slot-hourlog")) {
                this.hourlogDrafts.set(hourlogKey, draft)
                this.rerenderMountedTimelines()
              } else if (dateStr) {
                this.pendingHourlog = { date: dateStr, draft }
                void this.applyBlockTransform(el, ctx, source, (value) => this.addComponentSlot(value, doc, container, "hourlog"))
              }
            },
            editTimes: (ln) => {
              const live = liveContainer()
              if (!live) return
              const rect = live.querySelector(`rect.modular-diary-block[data-line="${ln}"]`)
              const e0 = doc.entries.find((it) => it.line === ln)
              if (!rect || !e0) return
              openTimePopover(live, rect, rect.getBoundingClientRect(), {
                start: formatClockPlain(e0.startMin),
                end: formatClockPlain(e0.endMin),
              }, (st, en) => {
                void this.applyBlockTransform(el, ctx, source, (s2) => rewriteEntryTarget(s2, menuTarget, (current) => {
                  const d = this.parse(s2)
                  const [sh, sm] = st.split(":").map(Number)
                  const [eh, em] = en.split(":").map(Number)
                  const [startMin, endMin] = normalizeSpan(sh * 60 + sm, eh * 60 + em, d.rangeStart)
                  return formatEntryLine({ ...current, startMin, endMin })
                }), { previewVisual: previewTimeline })
              })
            },
            editSpan: (ln) => {
              const target = targetForEntryLine(ln)
              this.editing = target ? { ...blockIdentity, target } : null
              const svgEl = container.querySelector("svg.modular-diary-svg")
              const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
              svgEl?.dispatchEvent(new CustomEventCtor("modular-diary-sync-edit"))
            },
            setNote: (ln, note) =>
              void this.applyBlockTransform(el, ctx, source, (s) => rewriteEntryTarget(
                s,
                menuTarget,
                (current) => formatEntryLine({ ...current, note: note || undefined }),
              ), { previewVisual: previewTimeline }),
            setType: (ln, type) =>
              void this.applyBlockTransform(el, ctx, source, (s) => rewriteEntryTarget(
                s,
                menuTarget,
                (current) => formatEntryLine({ ...current, type }),
              ), { previewVisual: previewTimeline }),
            setTodo: (ln, todoId) =>
              void this.applyBlockTransform(el, ctx, source, (s) => {
                const current = resolveEntryTarget(this.parse(s).entries, menuTarget)
                if (!current) throw new Error(tr("sourceChanged"))
                return setEntryTodoBinding(s, current.line, todoId)
              }, { previewVisual: previewTimeline }),
            remove: requestDeleteTimelineEntry,
            togglePlan: (ln) =>
              void this.applyBlockTransform(el, ctx, source, (s) => rewriteEntryTarget(
                s,
                menuTarget,
                (current) => formatEntryLine({ ...current, plan: !current.plan }),
              ), { previewVisual: previewTimeline }),
          }, dom)
        },
        })

        attachTimelineScheduleDrag(container, doc, {
          hourHeight: this.settings.hourHeight,
          typeColor: (type) => spanPaletteForRender[type] ?? hashTypeColor(type),
          onCreate: (plan) => {
            clearBlockEditState()
            void this.applyBlockTransform(el, ctx, source, (value) => insertEntryLine(
              this.persistLayoutOnce(value, doc, container), plan.line, plan.startMin,
            ), { previewVisual: previewTimeline })
          },
        })

        const markerAnchor = (line: number): SVGGElement | null => {
          const live = liveContainer()
          return live?.querySelector<SVGGElement>(`g.modular-diary-marker[data-line="${line}"]`) ?? null
        }
        const editMarkerNote = (line: number): void => {
          const target = targetForMarkerLine(line)
          const anchor = markerAnchor(line)
          const marker = doc.annotations.find((item) => item.line === line && item.type)
          const live = anchor?.closest<HTMLElement>(".modular-diary-container")
          if (!anchor || !marker || !live || !target) return
          openNotePopover(live, anchor, anchor.getBoundingClientRect(), marker.text, async (text) => {
            try {
              await this.applyBlockTransform(el, ctx, source, (value) => {
                const markers = this.parse(value).annotations
                const current = resolveMarkerTarget(markers, target)
                  ?? resolveMarkerTarget(markers, captureMarkerTarget({ ...marker, text }))
                if (!current?.type) throw new Error(tr("sourceChanged"))
                return replaceEntryLine(value, current.line, formatMarkerLine({ ...current, type: current.type, text }))
              })
            } catch (error) {
              if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) {
              new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 8000)
            }
              throw error
            }
          }, { kind: "marker" })
        }
        const deleteMarker = (line: number): void => {
          const target = targetForMarkerLine(line)
          if (!target) return
          if (sameBlock(this.markerEditing, blockIdentity) && currentMarkerEditingLine() === line) this.markerEditing = null
          void this.applyBlockTransform(el, ctx, source, (value) => {
            const current = resolveMarkerTarget(this.parse(value).annotations, target)
            if (!current) throw new Error(tr("sourceChanged"))
            return deleteEntryLine(value, current.line)
          })
        }
        attachMarkerInteraction(container, doc, {
          hourHeight: this.settings.hourHeight,
          isMarkerTool: () => this.drawTool === "marker",
          getActiveType: () => blockActiveMarkerType || null,
          getMode: () => this.drawMode,
          isInteractionLocked: () => sameBlock(this.editing, blockIdentity),
          typeColor: (type) => markerPaletteForRender[type] ?? hashTypeColor(type),
          getEditingLine: currentMarkerEditingLine,
          setEditingLine: (line) => {
            if (line === null) {
              if (sameBlock(this.markerEditing, blockIdentity)) this.markerEditing = null
              return
            }
            const target = targetForMarkerLine(line)
            this.markerEditing = target ? { ...blockIdentity, target } : null
          },
          onCreate: (line, timeMin) => {
            clearBlockEditState()
            void this.applyBlockTransform(el, ctx, source, (value) => insertMarkerLine(this.persistLayoutOnce(value, doc, container), line, timeMin))
          },
          onMove: (line, timeMin) => {
            const target = targetForMarkerLine(line)
            if (!target) return
            const original = doc.annotations.find((marker) => marker.line === line && marker.type)
            if (sameBlock(this.markerEditing, blockIdentity) && original) {
              this.markerEditing = {
                ...blockIdentity,
                target: captureMarkerTarget({ ...original, timeMin }),
              }
            }
            void this.applyBlockTransform(el, ctx, source, (value) => rewriteMarkerTarget(
              value,
              target,
              (marker) => formatMarkerLine({ ...marker, type: marker.type!, timeMin }),
            ))
          },
          onEditNote: editMarkerNote,
          onDelete: deleteMarker,
          onMenu: (line, x, y) => {
            const marker = doc.annotations.find((item) => item.line === line && item.type)
            const menuTarget = marker ? captureMarkerTarget(marker) : null
            if (!marker?.type || !menuTarget) return
            showMarkerMenu(marker, markerPaletteTypes, x, y, {
              editNote: editMarkerNote,
              editMove: (targetLine) => {
                const target = targetForMarkerLine(targetLine)
                this.markerEditing = target ? { ...blockIdentity, target } : null
                const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
                container.querySelector("svg.modular-diary-svg")?.dispatchEvent(new CustomEventCtor("modular-diary-marker-sync-edit"))
              },
              editTime: (targetLine) => {
                const anchor = markerAnchor(targetLine)
                const current = doc.annotations.find((item) => item.line === targetLine && item.type)
                const live = anchor?.closest<HTMLElement>(".modular-diary-container")
                if (!anchor || !current?.type || !live) return
                openPointTimePopover(live, anchor, anchor.getBoundingClientRect(), formatClockPlain(current.timeMin), (clock) => {
                  const [hour, minute] = clock.split(":").map(Number)
                  void this.applyBlockTransform(el, ctx, source, (value) => rewriteMarkerTarget(value, menuTarget, (latest) => {
                    const parsed = this.parse(value)
                    let timeMin = hour * 60 + minute
                    if (timeMin < parsed.rangeStart) timeMin += 24 * 60
                    return formatMarkerLine({ ...latest, type: latest.type!, timeMin })
                  }))
                })
              },
              setType: (targetLine, type) => void this.applyBlockTransform(el, ctx, source, (value) => rewriteMarkerTarget(
                value,
                menuTarget,
                (latest) => formatMarkerLine({ ...latest, type }),
              )),
              togglePlan: (targetLine) => void this.applyBlockTransform(el, ctx, source, (value) => rewriteMarkerTarget(
                value,
                menuTarget,
                (latest) => formatMarkerLine({ ...latest, type: latest.type!, plan: !latest.plan }),
              )),
              convertToSpan: (targetLine) => {
                if (sameBlock(this.markerEditing, blockIdentity) && currentMarkerEditingLine() === targetLine) this.markerEditing = null
                void this.applyBlockTransform(el, ctx, source, (value) => {
                  const latest = resolveMarkerTarget(this.parse(value).annotations, menuTarget)
                  if (!latest) throw new Error(tr("sourceChanged"))
                  return convertMarkerToEntry(value, latest.line)
                }, { previewVisual: previewTimeline })
              },
              remove: deleteMarker,
            }, dom)
          },
        })
      }

      wireTimeline()
      this.applyViewClass(container, this.layerView)

      // 初始宽度自适应内容：无 layout 头时，时间轴槽位收到内容自然宽（yyt 2026-08-17）
      if (doc.layout === undefined && (doc.entries.length > 0 || doc.annotations.length > 0) && body) {
        const slotEl = container.querySelector<HTMLElement>(".modular-diary-slot-timeline")
        if (slotEl) {
          domWindow?.requestAnimationFrame(() => {
            const bodyW = body.getBoundingClientRect().width
            const natural = (doc.width ?? this.settings.width) + SIDE_LANE_W + 8
            if (bodyW > 200 && natural < bodyW * 0.9) {
              const cols = Math.min(GRID_COLS, Math.max(2, Math.round((natural / bodyW) * GRID_COLS)))
              slotEl.dataset.w = String(cols)
              slotEl.style.width = `${(cols / GRID_COLS) * 100}%`
            }
          })
        }
      }

      // 轨道宽度手柄：时间轴本体右缘的窄条，拖了写回 width: 头（yyt：边界要可调）
      attachWidthHandle(container, doc.width ?? this.settings.width, (baseWidth) => {
        void this.applyBlockTransform(el, ctx, source, (s) =>
          setHeaderValue(s, "width", String(baseWidth))
        )
      })

      // 右下角：设置快捷入口。
      const settingsButton = dom.createElement("button")
      settingsButton.type = "button"
      settingsButton.className = "modular-diary-open-settings"
      setIcon(settingsButton, "settings")
      settingsButton.setAttribute("aria-label", tr("openSettings"))
      settingsButton.addEventListener("click", (e) => {
        e.stopPropagation()
        this.openSettings()
      })
      container.appendChild(settingsButton)

      // 当前 block 的低频附加操作：组件管理 + 布局，不再误用「添加」语义。
      const more = dom.createElement("button")
      more.type = "button"
      more.className = "modular-diary-more-actions"
      setIcon(more, "ellipsis")
      more.setAttribute("aria-label", tr("moreActions"))
      more.setAttribute("aria-haspopup", "menu")
      more.addEventListener("click", (e) => {
        e.stopPropagation()
        const r = more.getBoundingClientRect()
        showMoreMenu(r.left, r.top)
      })
      container.appendChild(more)

      // 触控端不直接暴露细小手柄：先进入显式布局编辑态，再显示放大的命中区。
      const layoutEdit = dom.createElement("button")
      layoutEdit.type = "button"
      layoutEdit.className = "modular-diary-layout-edit-toggle"
      layoutEdit.setAttribute("aria-pressed", "false")
      const layoutEditIcon = dom.createElement("span")
      layoutEditIcon.className = "modular-diary-layout-edit-icon"
      layoutEditIcon.setAttribute("aria-hidden", "true")
      const layoutEditLabel = dom.createElement("span")
      const syncLayoutEdit = (active: boolean): void => {
        container.classList.toggle("is-layout-editing", active)
        layoutEdit.setAttribute("aria-pressed", String(active))
        layoutEdit.setAttribute("aria-label", active ? tr("finishLayout") : tr("editLayout"))
        layoutEditLabel.textContent = active ? tr("finishLayout") : tr("editLayout")
        setIcon(layoutEditIcon, active ? "check" : "pencil-ruler")
      }
      layoutEdit.append(layoutEditIcon, layoutEditLabel)
      layoutEdit.addEventListener("click", (e) => {
        e.stopPropagation()
        syncLayoutEdit(layoutEdit.getAttribute("aria-pressed") !== "true")
      })
      syncLayoutEdit(false)
      container.appendChild(layoutEdit)

      const menuSurface = (el.closest(".cm-embed-block") as HTMLElement | null) ?? container
      menuSurface.addEventListener("contextmenu", (e: MouseEvent) => {
        const t = e.target as Element | null
        // The timeline owns all context-menu gestures inside its SVG. A
        // WebView may retarget a marker label/line to the SVG root, so checking
        // only `rect` lets the enclosing Block menu steal time-point clicks.
        if (t?.closest("button, input, textarea, a, .modular-diary-svg, .modular-diary-text-host, .modular-diary-text-header, .modular-diary-add-menu")) return
        e.preventDefault()
        // 点在组件空白上 -> 提供统一的自制「隐藏」菜单（off: 头，可从更多菜单重新显示）
        const slotEl = t?.closest(".modular-diary-slot") as HTMLElement | null
        const slotId = slotEl?.dataset.slot
        if (slotId && (slotId === "text" || /^text\d+$/.test(slotId)) && t?.closest(".modular-diary-text-pane") === null) {
          // 文本框空白处右键 -> 删除此文本框（可 Ctrl+Z 恢复）
          const idx = slotId === "text" ? 0 : Number(slotId.slice(4)) - 1
          const menu = new Menu()
          menu.addItem((mi) =>
            mi.setTitle(tr("deleteTextBox")).setIcon("trash").onClick(() => {
              void this.applyBlockTransform(el, ctx, source, (s) => {
                let out = removeTextSection(s, idx)
                // layout 头里同步摘掉该槽位
                if (doc.layout) {
                  const remaining = doc.layout.filter((g) => g.id !== slotId)
                  out = setHeaderValue(out, "layout", serializeLayoutHeader(remaining))
                }
                return out
              })
            })
          )
          menu.showAtPosition({ x: e.clientX, y: e.clientY }, dom)
          return
        }
        if (slotId && ["toolbar", "stats", "dialog", "habits", "todos", "quote", "hourlog"].includes(slotId)) {
          showActionMenuAtPoint(
            dom,
            e.clientX,
            e.clientY,
            tr("componentActions", { name: slotLabels[slotId] ?? slotId }),
            tr("hide"),
            () => {
              void this.applyBlockTransform(el, ctx, source, (s) => addOffSlot(s, slotId))
            }
          )
          return
        }
        showMoreMenu(e.clientX, e.clientY)
      })

      const dialogSlot = container.querySelector<HTMLElement>(".modular-diary-slot-dialog")
      if ((Platform.isDesktopApp || this.settings.dialogBackend === "api") && dialogSlot) {
        attachDialog(dialogSlot, doc, {
          settings: this.settings,
          openSettings: () => {
            // @ts-expect-error 内部 API
            this.app.setting?.open?.()
            // @ts-expect-error 内部 API
            this.app.setting?.openTabById?.("modular-diary")
          },
          writeActions: (actions) =>
            this.applyBlockTransform(el, ctx, source, (s) => {
              let out = this.persistLayoutOnce(s, doc, container)
              for (const a of actions) {
                if (a.kind === "create") {
                  out = insertEntryLine(out, a.entry.sourceLine, a.entry.startMin)
                  continue
                }
                // target 是请求时刻的编号；写入时按当前源码重取（时间排序、plan 除外）
                const d = this.parse(out)
                const target = d.entries.filter((e) => !e.plan).sort((x, y) => x.startMin - y.startMin)[a.targetIndex]
                if (!target) continue
                if (a.kind === "delete") {
                  out = deleteEntryLine(out, target.line)
                } else {
                  const [startMin, endMin] = normalizeSpan(
                    a.patch.startMin ?? target.startMin,
                    a.patch.endMin ?? target.endMin,
                    d.rangeStart
                  )
                  out = replaceEntryLine(out, target.line, formatEntryLine({
                    ...target,
                    startMin,
                    endMin,
                    type: a.patch.type ?? target.type,
                    note: a.patch.note !== undefined ? (a.patch.note || undefined) : target.note,
                  }))
                }
              }
              return out
            }),
        })
      }
      const sourceSession = this.sourceDrafts.get(el)
      if (sourceSession) mountCurrentSourceMode(sourceSession)
  }

  /** 无 layout 头的块在首次写入时持久化当前槽位布局（避免每次重渲染重新拟合 -> 闪缩） */
  private persistLayoutOnce(source: string, doc: { layout?: unknown }, container: HTMLElement): string {
    if (doc.layout !== undefined) return source
    const body = container.querySelector<HTMLElement>(".modular-diary-body")
    if (!body) return source
    const items = Array.from(body.querySelectorAll<HTMLElement>(".modular-diary-slot")).map((sl) => ({
      id: sl.dataset.slot as GridItem["id"],
      x: Number(sl.dataset.x), y: Number(sl.dataset.y), w: Number(sl.dataset.w), h: Number(sl.dataset.h),
    }))
    if (items.length === 0) return source
    return setHeaderValue(source, "layout", serializeLayoutHeader(items))
  }

  /** The template in effect, as source: the saved skeleton, or the one the legacy layout fields imply. */
  effectiveTemplateSource(): string {
    if (this.settings.templateSource) return this.settings.templateSource
    const legacy = timelineTemplate("2000-01-01", { layout: this.settings.templateLayout, width: this.settings.templateWidth, hasText: this.settings.templateHasText })
    const inner = legacy.split("\n").slice(1, -1).join("\n")
    return skeletonFromSource(inner)
  }

  private insertTemplate(): { source?: string; layout?: string; width?: number; hasText?: boolean } {
    return {
      source: this.settings.templateSource,
      layout: this.settings.templateLayout,
      width: this.settings.templateWidth,
      hasText: this.settings.templateHasText,
    }
  }

  private blockDate(doc: { date?: string }, path: string): string | null {
    if (doc.date) return doc.date
    const file = this.app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? inferDate(file.basename) : null
  }

  private datedEntriesForWeek(date: string, fallback: import("./core/types").Entry[]): DatedTimelineEntries[] {
    if (this.dayIndexReady()) return filterWeekEntries(this.dayIndex.datedEntries(), date)
    // Render with what this block knows now; the refresh redraws every mounted block.
    void this.refreshDayIndex().then(() => this.rerenderMountedTimelines())
    return [{ date, entries: fallback }]
  }

  private dayIndexReady(): boolean {
    return this.dayIndexSeeded && this.dayIndex.pending.length === 0
  }

  /** Read every dirty note (all of them on first use) into the day index. */
  private refreshDayIndex(): Promise<void> {
    if (this.dayIndexRefresh) return this.dayIndexRefresh
    if (!this.dayIndexSeeded) {
      this.dayIndexSeeded = true
      for (const file of this.app.vault.getMarkdownFiles()) this.dayIndex.markDirty(file.path)
    }
    const pending = this.dayIndex.pending
    if (pending.length === 0) return Promise.resolve()
    const refresh: Promise<void> = Promise.all(pending.map(async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) { this.dayIndex.remove(path); return }
      this.dayIndex.update(path, file.basename, await this.app.vault.cachedRead(file))
    })).then(() => undefined, (error: unknown) => {
      console.error("Modular Diary: failed to refresh the day index", error)
    }).finally(() => {
      this.dayIndexRefresh = null
    })
    this.dayIndexRefresh = refresh
    return refresh
  }

  private async dailyNotesConfig(): Promise<DailyNotesConfig> {
    const path = normalizePath(`${this.app.vault.configDir}/daily-notes.json`)
    try {
      if (!(await this.app.vault.adapter.exists(path))) return parseDailyNotesConfig(null)
      return parseDailyNotesConfig(JSON.parse(await this.app.vault.adapter.read(path)))
    } catch (error) {
      console.error("Modular Diary: could not read daily-notes.json", error)
      return parseDailyNotesConfig(null)
    }
  }

  /**
   * Write one change into the timeline block of another day. The note is the
   * one the day index knows for that date, else the Daily Notes path; a
   * missing note is created from the Daily Notes template, and a missing
   * block is appended. This is the primitive behind "push to tomorrow" and,
   * later, cross-day drops in a period block.
   */
  private async writeToDay(date: string, transform: (blockSource: string) => string): Promise<string> {
    await this.refreshDayIndex()
    const config = await this.dailyNotesConfig()
    const format = momentFormat
    const path = this.dayIndex.notePathForDate(date) ?? normalizePath(dailyNotePath(config, date, format))
    let file = this.app.vault.getAbstractFileByPath(path)
    if (!file) {
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder)
      let template = ""
      if (config.template) {
        const templateFile = this.app.vault.getAbstractFileByPath(normalizePath(`${config.template}.md`))
        if (templateFile instanceof TFile) {
          const noteName = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "")
          template = fillDailyTemplate(await this.app.vault.cachedRead(templateFile), date, noteName, format)
        }
      }
      file = await this.app.vault.create(path, template)
    }
    if (!(file instanceof TFile)) throw new Error(tr("fileNotFound"))
    const target = file
    await this.app.vault.process(target, (content) => {
      const ensured = ensureBlockForDate(content, date, target.basename, this.insertTemplate())
      return replaceBlockInContent(ensured.content, ensured.section, transform(ensured.section.source))
    })
    return path
  }

  private previousDate(date: string): string {
    return shiftDate(date, -1)
  }

  /**
   * On the hour, a quiet status-bar line asks what the last hour went into.
   * Clicking it opens today's note with the composer set to that hour.
   */
  private setupHourlyNudge(): void {
    const item = this.addStatusBarItem()
    item.addClass("modular-diary-nudge")
    item.hide()
    this.nudgeEl = item
    this.registerInterval(activeWindow.setInterval(() => this.refreshHourlyNudge(), 30_000))
    this.refreshHourlyNudge()
  }

  refreshHourlyNudge(): void {
    const item = this.nudgeEl
    if (!item) return
    const now = new Date()
    // At 00:xx the question is about yesterday 23:00–24:00.
    const endHour = now.getHours() === 0 ? 24 : now.getHours()
    const date = now.getHours() === 0 ? shiftDate(inferDate(null), -1) : inferDate(null)
    const askedStart = (endHour - 1) * 60, askedEnd = endHour * 60
    const inWindow = endHour - 1 >= this.settings.nudgeStartHour && endHour <= this.settings.nudgeEndHour
    // An hour already half written is not asked about again.
    const written = this.dayIndex.blocksForDate(date).flatMap((block) => hourlogItems({ entries: block.entries, spans: block.spans }))
    const covered = unionMinutes(written
      .map((piece) => [Math.max(piece.startMin, askedStart), Math.min(piece.endMin, askedEnd)] as [number, number])
      .filter(([s, e]) => e > s))
    const show = this.settings.hourlyNudge && inWindow && now.getMinutes() < 20 && endHour !== this.nudgeDismissedHour && covered < 30
    if (!show) { item.hide(); return }
    if (item.dataset.hour === String(endHour) && item.isShown()) return
    item.dataset.hour = String(endHour)
    item.empty()
    const clock = (h: number): string => `${String(h).padStart(2, "0")}:00`
    const question = tr("hourlyNudge", { start: clock(endHour - 1), end: clock(endHour) })
    const open = item.createEl("button", { cls: "modular-diary-nudge-open", attr: { type: "button" } })
    setIcon(open.createEl("span", { cls: "modular-diary-nudge-icon" }), "clock")
    open.appendText(question)
    const close = item.createEl("button", { cls: "modular-diary-nudge-close", attr: { type: "button", "aria-label": tr("dismiss") } })
    setIcon(close, "x")
    const answer = (): void => {
      const nowMin = endHour === 24 && now.getHours() === 0 ? 24 * 60 : now.getHours() * 60 + now.getMinutes()
      const range = composerDefaults(written, nowMin)
      this.pendingHourlog = { date, draft: { startMin: range.startMin, endMin: range.endMin, link: null, body: "", focus: true } }
      this.nudgeDismissedHour = endHour
      item.hide()
      void this.openDay(date).then(() => this.rerenderMountedTimelines())
    }
    open.addEventListener("click", answer)
    close.addEventListener("click", () => { this.nudgeDismissedHour = endHour; item.hide() })
    item.show()
    if (this.settings.hourlyNudgeNotify && typeof Notification !== "undefined") {
      try {
        const notification = new Notification("Modular Diary", { body: question, silent: true })
        notification.onclick = () => { activeWindow.focus(); answer() }
      } catch (error) {
        console.error("Modular Diary: could not raise the hourly notification", error)
      }
    }
  }

  /** Every tag the vault has used, settings first, for `#` completion. */
  private knownTags(): string[] {
    const seen = new Set<string>(Object.keys(this.settings.tagCategories))
    for (const block of this.dayIndex.allBlocks()) {
      for (const entry of block.entries) for (const tag of entry.tags) seen.add(tag)
      for (const span of block.spans) for (const tag of span.tags) seen.add(tag)
      for (const todo of block.todos) for (const tag of todo.tags ?? []) seen.add(tag)
    }
    if (!this.dayIndexReady()) void this.refreshDayIndex()
    return [...seen]
  }

  private tagSuggestDeps(): TagSuggestDeps {
    return { tags: () => this.knownTags(), tagStyle: (tag) => this.tagStyle(tag) }
  }

  private tagStyle(tag: string): { background: string; color: string } | null {
    const category = tagCategory(tag, this.settings.tagCategories)
    const color = category ? (this.settings.spanTypeColors[category] ?? this.settings.spanRetiredTypeColors[category]) : undefined
    if (!color) return null
    return {
      background: `color-mix(in srgb, ${color} 22%, var(--background-primary))`,
      color: `color-mix(in srgb, ${color} 70%, var(--text-normal))`,
    }
  }

  /** The todo grouping menu: primary grouping, and a second level once the first is on. */
  private showTodoGroupMenu(dom: Document, x: number, y: number, view: TimelineDoc["todoView"], setView: (patch: Partial<TimelineDoc["todoView"]>) => void): void {
    const menu = new Menu()
    const titles = { none: tr("todoGroupNone"), category: tr("todoGroupCategory"), status: tr("todoGroupStatus"), tag: tr("todoGroupTag") }
    buildTodoGroupMenuOptions(view.groupBy, titles).forEach(({ value, title, checked }) => menu.addItem((item) => item
      .setTitle(title)
      .setChecked(checked)
      .onClick(() => setView({ groupBy: value }))))
    if (view.groupBy !== "none") {
      menu.addSeparator()
      menu.addItem((item) => item.setTitle(tr("todoSubGroupRule")).setIsLabel(true))
      buildTodoSubGroupMenuOptions(view.groupBy, view.group2 ?? "none", titles).forEach(({ value, title, checked }) => menu.addItem((item) => item
        .setTitle(title)
        .setChecked(checked)
        .onClick(() => setView({ group2: value === "none" ? undefined : value }))))
    }
    menu.showAtPosition({ x, y }, dom)
  }

  /** A `days:` block: the period's goals and todos live here; each column is that day's note. */
  private renderPeriodBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext, doc: TimelineDoc): void {
    if (!doc.period) return
    const browseKey = `${ctx.sourcePath}#${this.scrollTransactionKey(el, ctx).blockOrdinal}`
    const browsed = this.periodBrowse.get(browseKey)
    const period = browsed ?? doc.period
    const dom = el.ownerDocument
    const today = inferDate(null)
    const resolved = resolvePeriod(period, today)
    const ready = this.dayIndexReady()
    if (!ready) void this.refreshDayIndex().then(() => this.rerenderMountedTimelines())
    const dayData = resolved.days.map((date) => {
      const blocks = this.dayIndex.blocksForDate(date)
      return { date, entries: blocks.flatMap((block) => block.entries), spans: blocks.flatMap((block) => block.spans), hasNote: blocks.length > 0 }
    })
    // Where each period todo landed: a plan block bound to it in a day's note wins over `day=`.
    const plannedAt = new Map<string, { date: string; startMin: number }>()
    const actual = new Map<string, number>()
    for (const day of dayData) for (const entry of day.entries) {
      if (!entry.todoId) continue
      if (entry.plan) { if (!plannedAt.has(entry.todoId)) plannedAt.set(entry.todoId, { date: day.date, startMin: entry.startMin }) }
      else actual.set(entry.todoId, (actual.get(entry.todoId) ?? 0) + entry.endMin - entry.startMin)
    }
    const todos: PeriodTodoView[] = doc.todos.map((todo) => ({
      ...todo,
      actualMinutes: actual.get(todo.id) ?? 0,
      placement: plannedAt.get(todo.id) ?? (todo.day ? { date: todo.day } : undefined),
    }))
    const days: PeriodDayView[] = dayData.map((day) => ({
      ...day,
      allDay: todos.filter((todo) => todo.placement && todo.placement.startMin === undefined && todo.placement.date === day.date),
    }))
    // The grid grows to fit the week's records, so early mornings, late nights and
    // after-midnight blocks are never counted in the totals but missing from the grid.
    let rangeStartMin = this.settings.rangeStartHour * 60
    let rangeEndMin = this.settings.rangeEndHour * 60
    for (const day of dayData) {
      for (const item of [...day.entries, ...day.spans]) {
        rangeStartMin = Math.min(rangeStartMin, Math.floor(item.startMin / 60) * 60)
        rangeEndMin = Math.max(rangeEndMin, Math.ceil(item.endMin / 60) * 60)
      }
    }
    rangeStartMin = Math.max(0, rangeStartMin)
    rangeEndMin = Math.min(30 * 60, rangeEndMin)
    const model: PeriodViewModel = {
      spec: period, browsing: Boolean(browsed), period: resolved, today,
      goals: goalProgress(doc.goals, dayData), totals: periodTotals(dayData), todos, todoView: doc.todoView, days,
      todoGroupOrder: doc.todoGroupOrder,
      rangeStartMin, rangeEndMin,
      indexReady: ready, railWidth: doc.railWidth ?? 248,
    }
    const container = el.createDiv({ cls: "modular-diary-container modular-diary-period-container" })
    const fail = (date: string, error: unknown): void => {
      console.error("Modular Diary: period block write failed", error)
      if (!(error as { modularDiaryNoticeReported?: boolean })?.modularDiaryNoticeReported) new Notice(tr("periodWriteFailed", { date }))
    }
    const rewrite = (transform: (current: string) => string): Promise<void> => this.applyBlockTransform(el, ctx, source, transform)
    /** Remove the plan block bound to a period todo from the day it was planned on. */
    const unplan = async (id: string, except?: string): Promise<void> => {
      const planned = plannedAt.get(id)
      if (!planned || planned.date === except) return
      await this.writeToDay(planned.date, (blockSource) => {
        let out = blockSource
        for (const entry of this.parse(out).entries.filter((item) => item.plan && item.todoId === id).sort((a, b) => b.line - a.line)) out = deleteEntryLine(out, entry.line)
        return out
      })
    }
    const setView = (patch: Partial<typeof doc.todoView>): void => {
      void rewrite((value) => setHeaderValue(value, "todo-view", formatTodoViewHeaderValue({ ...doc.todoView, ...patch })))
    }
    renderPeriodInto(container, model, {
      typeColors: { ...this.settings.spanRetiredTypeColors, ...this.settings.spanTypeColors },
      categories: Object.keys(this.settings.spanTypeColors),
      tagStyle: (tag) => this.tagStyle(tag),
      tagSuggest: this.tagSuggestDeps(),
      onShift: (direction) => {
        const next = shiftPeriod(period, today, direction)
        if (formatPeriodSpec(next) === formatPeriodSpec(doc.period!)) this.periodBrowse.delete(browseKey)
        else this.periodBrowse.set(browseKey, next)
        this.rerenderMountedTimelines()
      },
      onToday: () => {
        if (doc.period!.kind === "this-week") this.periodBrowse.delete(browseKey)
        else this.periodBrowse.set(browseKey, { spec: "this-week", kind: "this-week" })
        this.rerenderMountedTimelines()
      },
      onPin: () => void rewrite((current) => setHeaderValue(current, "days", formatPeriodSpec(period)))
        .then(() => { this.periodBrowse.delete(browseKey); this.rerenderMountedTimelines() }),
      onOpenDay: (date) => void this.openDay(date),
      onAssign: (id, to) => void (async () => {
        try {
          await unplan(id)
          await rewrite((current) => updateTodo(current, id, { day: to === POOL_ZONE ? undefined : to }))
        } catch (error) { fail(to, error) }
      })(),
      onPlan: (id, date, startMin) => void (async () => {
        const todo = doc.todos.find((item) => item.id === id)
        if (!todo) return
        if (!todo.type) { new Notice(tr("periodTodoNeedsCategory")); return }
        const plan = buildScheduledPlan({ source: "todo", id, title: todo.title, type: todo.type, durationMin: todo.estimateMin }, startMin).line
        try {
          await this.writeToDay(date, (blockSource) => {
            let out = blockSource
            for (const entry of this.parse(out).entries.filter((item) => item.plan && item.todoId === id).sort((a, b) => b.line - a.line)) out = deleteEntryLine(out, entry.line)
            return insertEntryLine(out, plan, startMin)
          })
          await unplan(id, date)
          if (todo.day) await rewrite((current) => updateTodo(current, id, { day: undefined }))
        } catch (error) { fail(date, error) }
      })(),
      onAdd: (input) => void rewrite((current) => insertTodo(current, {
        id: `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title: input.title, group: "", type: input.type, estimateMin: input.estimateMinutes, completed: false,
        ...(input.note ? { note: input.note } : {}),
      })),
      onEdit: (id, input) => void rewrite((current) => updateTodo(current, id, { title: input.title, type: input.type, estimateMin: input.estimateMinutes, note: input.note })),
      onToggle: (id, completed) => rewrite((current) => updateTodo(current, id, { completed })),
      onDelete: (id) => void rewrite((current) => deleteTodo(current, id)),
      onMove: (id, targetIndex) => void rewrite((current) => moveTodo(current, id, targetIndex)),
      onMoveGroup: (key, targetIndex) => void rewrite((current) =>
        setHeaderValue(current, "todo-groups", JSON.stringify(moveTodoGroupKey(groupTodoTree(todos, doc.todoView, doc.todoGroupOrder), key, targetIndex)))),
      onGroupMenu: (x, y) => this.showTodoGroupMenu(dom, x, y, doc.todoView, setView),
      onSortMenu: (x, y) => {
        const menu = new Menu()
        buildTodoSortMenuOptions(doc.todoView.sortBy, { manual: tr("todoSortManual"), estimate: tr("todoSortEstimate"), actual: tr("todoSortActual") })
          .forEach(({ value, title, checked }) => menu.addItem((item) => item.setTitle(title).setChecked(checked).onClick(() => setView({ sortBy: value }))))
        menu.showAtPosition({ x, y }, dom)
      },
      onTodoMenu: (id, x, y, edit) => {
        const todo = todos.find((item) => item.id === id)
        if (!todo) return
        const menu = new Menu()
        menu.addItem((item) => item.setTitle(tr("editTodo")).setIcon("pencil").onClick(edit))
        menu.addItem((item) => {
          item.setTitle(tr("scheduleOn")).setIcon("calendar-plus")
          const withSub = item as unknown as { setSubmenu?: () => Menu }
          const sub = withSub.setSubmenu?.()
          const target = sub ?? menu
          for (const date of resolved.days) target.addItem((dayItem) => dayItem
            .setTitle(`${weekday(date)} ${Number(date.slice(5, 7))}.${Number(date.slice(8))}`)
            .setChecked(todo.placement?.date === date && todo.placement.startMin === undefined)
            .onClick(() => void (async () => {
              try { await unplan(id); await rewrite((current) => updateTodo(current, id, { day: date })) } catch (error) { fail(date, error) }
            })()))
        })
        menu.addItem((item) => item.setTitle(todo.completed ? tr("markIncomplete") : tr("markComplete")).setIcon(todo.completed ? "circle" : "check").onClick(() =>
          void rewrite((current) => updateTodo(current, id, { completed: !todo.completed }))))
        if (todo.placement) menu.addItem((item) => item.setTitle(tr("unassignTodo")).setIcon("undo-2").onClick(() => void (async () => {
          try { await unplan(id); await rewrite((current) => updateTodo(current, id, { day: undefined })) } catch (error) { fail(todo.placement?.date ?? "", error) }
        })()))
        menu.addItem((item) => item.setTitle(tr("deleteTodo")).setIcon("trash").onClick(() => void rewrite((current) => deleteTodo(current, id))))
        menu.showAtPosition({ x, y }, dom)
      },
      onSaveGoal: (line, goal) => void rewrite((current) => line === null
        ? insertHeaderLine(current, "goal", formatGoalLine(goal))
        : replaceEntryLine(current, line, formatGoalLine(goal))),
      onDeleteGoal: (line) => void rewrite((current) => deleteEntryLine(current, line)),
      onRailWidth: (px) => void rewrite((current) => setHeaderValue(current, "rail", String(px))),
    })
  }

  private async openDay(date: string): Promise<void> {
    const path = await this.writeToDay(date, (blockSource) => blockSource)
    await this.app.workspace.openLinkText(path, "", false)
  }

  private addComponentSlot(source: string, doc: { layout?: unknown }, container: HTMLElement, id: "habits" | "todos" | "quote" | "hourlog"): string {
    let out = removeOffSlot(this.persistLayoutOnce(source, doc, container), id)
    const parsed = this.parse(out)
    const items = parsed.layout ? [...parsed.layout] : []
    if (items.some((item) => item.id === id)) return out
    const maxY = items.reduce((value, item) => Math.max(value, item.y + item.h), 0)
    // Append below everything, then let gravity pull the six-column slot into
    // the first free space of its column instead of pinning it under the
    // timeline. Rendering re-runs the same compaction, so this is what the
    // user would see anyway.
    items.push({ ...defaultComponentSlot(id, id === "habits" ? HABITS_EMPTY_ROWS : id === "quote" ? QUOTE_ROWS : id === "hourlog" ? HOURLOG_ROWS : 8, parsed.side), y: maxY })
    return setHeaderValue(out, "layout", serializeLayoutHeader(compactGrid(items)))
  }

  /** Grow slots whose content exceeds their grid height, then re-compact (display-only). */
  private fitSlotHeights(container: HTMLElement): void {
    const run = (): void => {
      const body = container.querySelector<HTMLElement>(".modular-diary-body")
      if (!body) return
      const viewportAnchor = captureViewportAnchor(container)
      const slots = Array.from(body.querySelectorAll<HTMLElement>(".modular-diary-slot"))
      let grew = false
      for (const slot of slots) {
        // 文字槽不自动撑高：保持用户拖的尺寸，内部滚动（yyt 2026-08-19）
        if (slot.dataset.slot && /^text\d*$/.test(slot.dataset.slot)) continue
        const need = Math.ceil(slot.scrollHeight / GRID_ROW_H)
        const cur = Number(slot.dataset.h)
        if (need > cur) {
          slot.dataset.h = String(need)
          grew = true
        }
      }
      if (!grew) return
      const items = compactGrid(slots.map((s) => ({
        id: s.dataset.slot as GridItem["id"],
        x: Number(s.dataset.x), y: Number(s.dataset.y), w: Number(s.dataset.w), h: Number(s.dataset.h),
      })))
      applyGridToBody(body, items)
      body.style.height = `${gridRows(items) * GRID_ROW_H}px`
      restoreViewportAnchor(viewportAnchor, container)
    }
    run()
    // 二次量高去重：渲染频繁时定时器堆积会造成重排风暴（性能审计 2026-08-19）
    if (!container.dataset.modularDiaryFitPending) {
      container.dataset.modularDiaryFitPending = "1"
      container.ownerDocument.defaultView?.setTimeout(() => {
        delete container.dataset.modularDiaryFitPending
        run()
      }, 300)
    }
  }

  /** Capture the exact visible scroller; file path alone is never an owner. */
  private captureScroll(container: HTMLElement): TimelineScrollSnapshot {
    const block = container.matches(".modular-diary-container")
      ? container
      : container.querySelector<HTMLElement>(".modular-diary-container")
    return {
      internal: captureInternalScroll(container),
      viewport: block ? captureViewportAnchor(block) : null,
    }
  }

  private restoreScroll(snapshot: TimelineScrollSnapshot | null, container: HTMLElement): void {
    if (!snapshot) return
    stabilizeInternalScroll(snapshot.internal, container, 2)

    // The actual DOM scroller is the sole outer-scroll owner in source and
    // reading modes alike. Two bounded animation frames cover CM6's deferred
    // measure without leaving a timer that can pull the user back later.
    stabilizeViewportAnchor(snapshot.viewport, container, 2)

    // 等真实的异步渲染落定（MarkdownRenderer.render 的 Promise），不盲猜时长（专家方案）
    const asyncRenders = container.querySelectorAll<HTMLElement>(".modular-diary-text-host")
    const settle = Array.from(asyncRenders).map((h) => new Promise<void>((resolve) => {
      const MutationObserverCtor = container.ownerDocument.defaultView?.MutationObserver ?? MutationObserver
      const mo = new MutationObserverCtor(() => {
        if (h.childElementCount > 0) { mo.disconnect(); resolve() }
      })
      mo.observe(h, { childList: true })
      container.ownerDocument.defaultView?.setTimeout(() => { mo.disconnect(); resolve() }, 2000) // 兜底上限
    }))
    void Promise.all(settle).then(() => {
      // Async Markdown can temporarily clamp an existing internal scroll to
      // zero while its content is empty. Restore only that reset; never pull
      // the outer page—or a pane the user has since scrolled—back again.
      if (!container.isConnected) return
      const slots = Array.from(container.querySelectorAll<HTMLElement>(".modular-diary-slot")).filter((s) => /^text\d*$/.test(s.dataset.slot ?? ""))
      slots.forEach((slot) => {
        const target = snapshot.internal.texts[slot.dataset.slot ?? ""]?.top ?? 0
        const scroller = slot.querySelector<HTMLElement>(".modular-diary-text-pane") ?? slot
        if (target > 0 && scroller.scrollTop <= 1) scroller.scrollTop = target
      })
    })
  }

  private markdownViews(path: string): MarkdownView[] {
    const views: MarkdownView[] = []
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file?.path === path) views.push(view)
    })
    return views
  }

  private owningMarkdownView(path: string, target: HTMLElement): MarkdownView | null {
    return findOwningView(path, target, this.markdownViews(path))
  }

  /**
   * Resolve the source owner once while the renderer is still mounted. Text
   * editors may flush after their original MarkdownPostProcessor DOM detached,
   * so re-deriving ownership at save time is inherently racy.
   */
  private mutationBlockKey(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): ScrollTransactionKey<object> {
    const section = ctx.getSectionInfo(el)
    const views = this.markdownViews(ctx.sourcePath)
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
    const view = chooseMutationView(ctx.sourcePath, el, views, activeView)
    return this.scrollTransactionKey(
      el,
      ctx,
      section,
      view?.leaf,
      view?.editor.getValue(),
    )
  }

  private scrollTransactionKey(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    section: { lineStart: number; lineEnd: number } | null = ctx.getSectionInfo(el),
    ownerOverride?: object,
    contentOverride?: string
  ): ScrollTransactionKey<object> {
    const viewOwner = this.owningMarkdownView(ctx.sourcePath, el)
      ?? chooseMutationView(ctx.sourcePath, el, this.markdownViews(ctx.sourcePath), null)
    let fallbackOwner = this.documentOwnerTokens.get(ctx.docId)
    if (!fallbackOwner) {
      fallbackOwner = {}
      this.documentOwnerTokens.set(ctx.docId, fallbackOwner)
    }
    // WorkspaceLeaf is the stable pane identity. MarkdownView instances may be
    // replaced during a renderer rebuild, which previously orphaned deferred
    // text drafts and made visible text disappear after restart.
    const owner = resolveTransactionOwner(viewOwner?.leaf ?? null, ownerOverride ?? null, fallbackOwner)
    const content = contentOverride
      ?? (viewOwner ? viewOwner.editor.getValue() : null)
    const capturedSource = this.blockSources.get(el)
    const location = content !== null && capturedSource !== undefined
      ? resolveTimelineSource(content, capturedSource, section)
        ?? (section && extractBlockSourceFromContent(content, section) !== null ? section : null)
      : section
    return {
      owner,
      path: ctx.sourcePath,
      docId: ctx.docId,
      lineStart: location?.lineStart ?? -1,
      blockOrdinal: location && content !== null
        ? timelineFenceOrdinal(content, location.lineStart)
        : -1,
    }
  }

  /** Delete the complete fenced block as one undoable editor transaction. */
  private async deleteTimelineBlock(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath)
    if (!(file instanceof TFile)) throw new Error(tr("fileNotFound"))
    const section = ctx.getSectionInfo(el)
    if (!section) throw new Error(tr("blockNotFound"))

    const views = this.markdownViews(ctx.sourcePath)
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
    const view = chooseMutationView(ctx.sourcePath, el, views, activeView)
    // Reading mode still exposes an Editor, but its mutations and save() do
    // not persist. Only source mode can use the editor transaction path.
    const readingOwner = view?.getMode?.() === "preview"
    if (view && !readingOwner) {
      const editor = view.editor
      const content = editor.getValue()
      if (removeTimelineBlockFromContent(content, section) === null) {
        throw new Error(tr("sourceChanged"))
      }

      // Include the following newline when possible. At EOF without a trailing
      // newline, include the preceding newline instead so no blank line remains.
      const lineCount = content.split("\n").length
      const from = section.lineEnd + 1 < lineCount
        ? { line: section.lineStart, ch: 0 }
        : section.lineStart > 0
          ? { line: section.lineStart - 1, ch: editor.getLine(section.lineStart - 1).length }
          : { line: 0, ch: 0 }
      const to = section.lineEnd + 1 < lineCount
        ? { line: section.lineEnd + 1, ch: 0 }
        : { line: section.lineEnd, ch: editor.getLine(section.lineEnd).length }

      if (this.editing?.path === ctx.sourcePath) this.editing = null
      if (this.markerEditing?.path === ctx.sourcePath) this.markerEditing = null
      const codeMirrorWrite = prepareCodeMirrorReplacement(view, "", from, to)
      const expectedContent = removeTimelineBlockFromContent(content, section)
      if (expectedContent === null) throw new Error(tr("sourceChanged"))
      await applyDurableWrite({
        apply: () => {
          if (codeMirrorWrite) codeMirrorWrite.apply()
          else editor.replaceRange("", from, to)
        },
        memoryMatches: () => editor.getValue() === expectedContent,
        save: () => view.save(),
        persistedMatches: async () => {
          const persisted = await this.app.vault.read(file)
          const currentEditorContent = editor.getValue()
          return persisted === expectedContent || persisted === currentEditorContent
        },
      })
      return
    }

    // A reading pane may write the file only while every same-file pane is
    // also reading. An open source editor may hold unsaved content.
    if (views.length > 0 && (!readingOwner || views.some((candidate) => candidate.getMode?.() !== "preview"))) {
      throw new Error(tr("sourceChanged"))
    }

    await this.app.vault.process(file, (content) => {
      const capturedSource = this.blockSources.get(el)
      const location = capturedSource ? resolveTimelineSource(content, capturedSource, section) : null
      const updated = location ? removeTimelineBlockFromContent(content, location) : null
      if (updated === null) throw new Error(tr("sourceChanged"))
      return updated
    })
  }

  /**
   * Persist an inline text draft without depending on the renderer DOM which
   * opened the editor. Markdown post-processors are disposable: blur, a
   * CodeMirror transaction, or another mounted component may replace that DOM
   * before the save Promise runs. The concrete pane plus timeline-fence
   * ordinal remain stable across that replacement and are therefore the write
   * identity.
   */
  private async applyTextBlockTransform(
    key: ScrollTransactionKey<object> & { source: string; section?: () => { lineStart: number; lineEnd: number } | null },
    transform: (source: string) => string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(key.path)
    if (!(file instanceof TFile)) throw new Error(tr("fileNotFound"))

    const views = this.markdownViews(key.path)
    // The MarkdownView object can be replaced while Obsidian rebuilds a leaf.
    // A sole same-path pane is still unambiguous; with multiple panes we must
    // keep failing closed rather than write another pane's unsaved document.
    const view = resolvePersistedOwnerView(key.owner, views, (candidate) => candidate.leaf)
    const readingOwner = view?.getMode?.() === "preview"
    if (view && !readingOwner) {
      const editor = view.editor
      const content = editor.getValue()
      const location = resolveTimelineSource(content, key.source, key.section?.() ?? null)
      if (!location) throw new Error(tr("sourceChanged"))
      key.blockOrdinal = timelineFenceOrdinal(content, location.lineStart)
      const newSource = transform(location.source)

      const host = this.timelineVisuals.findHost(key.path, key.owner, key.blockOrdinal)
      const visualContainer = host?.querySelector<HTMLElement>(".modular-diary-container") ?? null
      const snapshot = visualContainer ? this.captureScroll(visualContainer) : null
      const transactionKey: ScrollTransactionKey<object> = {
        ...key,
        lineStart: location.lineStart,
      }
      const openFence = editor.getLine(location.lineStart) ?? ""
      const prefix = /^(\s*(?:>\s*)*)/.exec(openFence)?.[1] ?? ""
      const body = newSource
        .split("\n")
        .map((line) => (line === "" ? prefix.trimEnd() : prefix + line))
        .join("\n")
      const from = { line: location.lineStart + 1, ch: 0 }
      const to = { line: location.lineEnd, ch: 0 }
      const replacement = body + "\n"
      const codeMirrorWrite = prepareCodeMirrorReplacement(view, replacement, from, to)
      // Keep the DOM viewport anchor for CodeMirror writes too: the widget
      // remount that follows makes CodeMirror re-anchor below the block (see
      // scroll-authority.ts).
      const transactionSnapshot = snapshot

      try {
        if (transactionSnapshot) {
          this.scrollTransactions.cancel(transactionKey)
          this.scrollTransactions.begin(transactionKey, newSource, transactionSnapshot)
        }
        // The inline editor already paints its submitted value. Advancing the
        // coordinator rejects a late callback carrying the old block source,
        // without cloning or replacing the visible component tree.
        if (host) this.timelineVisuals.accept(host, newSource)
        await applyDurableWrite({
          apply: () => {
            if (newSource !== location.source) {
              if (codeMirrorWrite) codeMirrorWrite.apply()
              else editor.replaceRange(replacement, from, to)
            }
            key.source = newSource
            if (host) this.blockSources.set(host, newSource)
          },
          memoryMatches: () => timelineSourceAtOrdinal(editor.getValue(), key.blockOrdinal) === newSource,
          save: () => view.save(),
          persistedMatches: async () => {
            const persistedSource = timelineSourceAtOrdinal(await this.app.vault.read(file), key.blockOrdinal)
            const currentEditorSource = timelineSourceAtOrdinal(editor.getValue(), key.blockOrdinal)
            return persistedSource === newSource
              || (currentEditorSource !== null && persistedSource === currentEditorSource)
          },
        })
      } catch (error) {
        if (transactionSnapshot) this.scrollTransactions.cancel(transactionKey)
        if (host) this.timelineVisuals.accept(host, location.source)
        throw error
      }
      return
    }

    // A detached owner or an open source pane may hold unsaved content.
    if (views.length > 0 && (!readingOwner || views.some((candidate) => candidate.getMode?.() !== "preview"))) {
      throw new Error(tr("sourceChanged"))
    }

    let savedSource = key.source
    await this.app.vault.process(file, (content) => {
      const location = resolveTimelineSource(content, key.source, key.section?.() ?? null)
      if (!location) throw new Error(tr("sourceChanged"))
      const newSource = transform(location.source)
      const updated = newSource === location.source
        ? content
        : replaceBlockInContent(content, location, newSource)
      savedSource = newSource
      return updated
    })
    key.source = savedSource
  }

  /** Sole write path into markdown (D7/D3 共用): transform block source, splice back. */
  private async applyBlockTransform(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    source: string,
    transform: (source: string) => string,
    options: BlockTransformOptions = {}
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath)
    if (!(file instanceof TFile)) throw new Error(tr("fileNotFound"))
    const hint = el.isConnected ? ctx.getSectionInfo(el) : null
    const expectedSource = this.blockSources.get(el) ?? source

    // 优先走编辑器事务（进 CM6 撤销栈，Ctrl+Z 可撤回，yyt 2026-08-17）；
    // 找不到打开的编辑器再退回 vault.process。关键点：每次都从当前编辑器/文件
    // 重新读取块正文，不能用 render 时捕获的 source 覆盖刚刚保存的文字。
    const views = this.markdownViews(ctx.sourcePath)
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
    const view = chooseMutationView(ctx.sourcePath, el, views, activeView)
    const readingOwner = view?.getMode?.() === "preview"
    if (view && !readingOwner) {
      const editor = view.editor
      const section = resolveTimelineSource(editor.getValue(), expectedSource, hint)
      if (!section) throw new Error(tr("sourceChanged"))
      const liveSource = section.source
      const newSource = transform(liveSource)
      const transactionKey = this.scrollTransactionKey(el, ctx, section, view.leaf, editor.getValue())
      const snapshot = options.scrollSnapshot
        ?? this.captureScroll(el.closest(".modular-diary-container") as HTMLElement ?? el)
      const openFence = editor.getLine(section.lineStart) ?? ""
      const prefix = /^(\s*(?:>\s*)*)/.exec(openFence)?.[1] ?? ""
      const body = newSource
        .split("\n")
        .map((l) => (l === "" ? prefix.trimEnd() : prefix + l))
        .join("\n")
      const from = { line: section.lineStart + 1, ch: 0 }
      const to = { line: section.lineEnd, ch: 0 }
      const replacement = body + "\n"
      const codeMirrorWrite = prepareCodeMirrorReplacement(view, replacement, from, to)
      // The block's DOM anchor owns the outer viewport through the remount
      // (default "dom"); see scroll-authority.ts for the CodeMirror failure.
      const transactionSnapshot = transactionScrollSnapshot(
        snapshot,
        Boolean(codeMirrorWrite),
        options.outerViewportAuthority
      )
      let rollbackVisual: (() => void) | null = null
      try {
        rollbackVisual = (options.previewVisual
          ?? ((value: string) => this.timelineVisuals.preview(el, value)))(newSource) ?? null
        this.scrollTransactions.cancel(transactionKey)
        this.scrollTransactions.begin(transactionKey, newSource, transactionSnapshot)
        const visualContainer = el.querySelector<HTMLElement>(".modular-diary-container")
          ?? el.closest<HTMLElement>(".modular-diary-container")
        if (visualContainer) beginRemountVisual(
          this.remountVisual,
          transactionKey,
          visualContainer,
          resolveRemountVisualMode(options.remountVisual, Boolean(rollbackVisual))
        )
        const applyEditorMutation = (): void => {
          if (newSource !== liveSource) {
            if (codeMirrorWrite) codeMirrorWrite.apply()
            else editor.replaceRange(replacement, from, to)
          }
          this.blockSources.set(el, newSource)
        }
        await applyDurableWrite({
          apply: applyEditorMutation,
          memoryMatches: () => timelineSourceAtOrdinal(editor.getValue(), transactionKey.blockOrdinal) === newSource,
          save: () => view.save(),
          persistedMatches: async () => {
            const persistedSource = timelineSourceAtOrdinal(await this.app.vault.read(file), transactionKey.blockOrdinal)
            const currentEditorSource = timelineSourceAtOrdinal(editor.getValue(), transactionKey.blockOrdinal)
            // A later Modular Diary action may already have advanced this same block
            // while the first save was in flight. Either this exact source or
            // the editor's newer source proves that the original mutation is
            // safely represented on disk.
            return persistedSource === newSource
              || (currentEditorSource !== null && persistedSource === currentEditorSource)
          },
        })
      } catch (error) {
        this.scrollTransactions.cancel(transactionKey)
        this.remountVisual.cancel(transactionKey)
        rollbackVisual?.()
        if (timelineSourceAtOrdinal(editor.getValue(), transactionKey.blockOrdinal) === newSource) {
          this.blockSources.set(el, newSource)
        }
        const reported = error instanceof Error ? error : new Error(tr("timelineSaveFailed"))
        ;(reported as Error & { modularDiaryNoticeReported?: boolean }).modularDiaryNoticeReported = true
        new Notice(tr("timelineSaveFailed"), 0)
        throw reported
      }
      return
    }
    // A stale renderer or an open source pane may hold unsaved content. A
    // proven reading owner with only reading peers can write the file itself.
    if (views.length > 0 && (!readingOwner || views.some((candidate) => candidate.getMode?.() !== "preview"))) {
      throw new Error(tr("sourceChanged"))
    }

    let transactionKey: ScrollTransactionKey<object> | null = null
    let committedSource = expectedSource
    const visualRollback: { current: (() => void) | null } = { current: null }
    try {
      await this.app.vault.process(file, (content) => {
        const section = resolveTimelineSource(content, expectedSource, hint)
        if (!section) throw new Error(tr("sourceChanged"))
        const liveSource = section.source
        const newSource = transform(liveSource)
        if (newSource === liveSource) return content
        visualRollback.current = (options.previewVisual
          ?? ((value: string) => this.timelineVisuals.preview(el, value)))(newSource) ?? null
        transactionKey = this.scrollTransactionKey(el, ctx, section, undefined, content)
        const snapshot = options.scrollSnapshot
          ?? this.captureScroll(el.closest(".modular-diary-container") as HTMLElement ?? el)
        this.scrollTransactions.begin(transactionKey, newSource, snapshot)
        const visualContainer = el.querySelector<HTMLElement>(".modular-diary-container")
          ?? el.closest<HTMLElement>(".modular-diary-container")
        if (visualContainer) beginRemountVisual(
          this.remountVisual,
          transactionKey,
          visualContainer,
          resolveRemountVisualMode(options.remountVisual, Boolean(visualRollback.current))
        )
        committedSource = newSource
        return replaceBlockInContent(content, section, newSource)
      })
      this.blockSources.set(el, committedSource)
    } catch (error) {
      if (transactionKey) {
        this.scrollTransactions.cancel(transactionKey)
        this.remountVisual.cancel(transactionKey)
      }
      visualRollback.current?.()
      throw error
    }
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as (Partial<ModularDiarySettings> & LegacyCategoryPaletteSettings) | null
    const hasPersistedSettings = data !== null
    const needsCategoryMigration = Boolean(data && ("typeColors" in data || "retiredTypeColors" in data))
    const palettes = migrateCategoryPalettes(data)
    // dailyQuoteDefaults: the retired card designer's appearance model (2026-09-10).
    const { typeColors: _legacyTypeColors, retiredTypeColors: _legacyRetiredTypeColors, dailyQuoteDefaults: _legacyQuoteDefaults, ...current } = (data ?? {}) as NonNullable<typeof data> & { dailyQuoteDefaults?: unknown }
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...current,
      ...palettes,
      habits: (data?.habits ?? []).map((habit, order) => normalizeHabitDefinition(habit, order)),
      weeklyTodos: (data?.weeklyTodos ?? []).map((todo, order) => ({
        ...todo,
        targetMinutes: Math.max(5, Number(todo.targetMinutes) || 5),
        order: Number.isFinite(todo.order) ? todo.order : order,
      })),
      dailyQuotes: (data?.dailyQuotes ?? []).map((quote, order) => normalizeDailyQuoteDefinition(quote, order)),
      dailyQuoteInk: typeof data?.dailyQuoteInk === "string" ? data.dailyQuoteInk : "",
      timelineOnboardingSeen: resolveTimelineOnboardingSeen(
        data?.timelineOnboardingSeen,
        hasPersistedSettings
      ),
    }
    if (needsCategoryMigration) await this.saveData(this.settings)
  }

  private openSettings(): void {
    // Obsidian 尚未公开设置页导航类型，但桌面端/移动端均提供该运行时 API。
    // @ts-expect-error setting 是 Obsidian 内部 API
    this.app.setting?.open?.()
    // @ts-expect-error openTabById 是 Obsidian 内部 API
    this.app.setting?.openTabById?.("modular-diary")
  }

  private openCategorySettings(scope: "span" | "marker" = "span"): void {
    new CategorySettingsModal(this.app, this, scope).open()
  }

  private openHabitSettings(): void {
    new HabitSettingsModal(this.app, this).open()
  }

  async saveSettings(options: { rerender?: boolean } = {}): Promise<void> {
    await this.saveData(this.settings)
    if (options.rerender) this.rerenderMountedTimelines()
  }

  /** Directly redraw mounted blocks in both Live Preview and reading mode. */
  private rerenderMountedTimelines(excludedSourcePaths: ReadonlySet<string> = new Set()): void {
    this.mountedTimelines.refreshAll(
      (error) => console.error("Modular Diary: failed to refresh a mounted timeline", error),
      excludedSourcePaths
    )
  }
}

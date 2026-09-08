import { getLanguage, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Menu, normalizePath, Notice, Platform, Plugin, setIcon, TAbstractFile, TFile } from "obsidian"
import { normalizeSpan, parseTimeline } from "./core/parser"
import { formatClockPlain, formatEntryLine, formatMarkerLine } from "./core/format"
import { FALLBACK_COLOR } from "./render/svg-builder"
import { hashTypeColor, pickVisibleType } from "./core/type-colors"
import { flushInlineTextEditors, renderTimelineInto } from "./render/timeline-view"
import { DEFAULT_SETTINGS, OnedaySettings, OnedaySettingTab } from "./settings"
import { CategorySettingsModal, DailyQuoteSettingsModal, HabitSettingsModal } from "./settings-modals"
import { attachDialog } from "./agent/dialog"
import { addHabitSkip, addHiddenType, addOffSlot, convertMarkerToEntry, deleteEntryLine, deleteTodo, extractBlockSourceFromContent, insertEntryLine, insertMarkerLine, insertTodo, moveTodo, removeHeaderValue, removeHiddenType, removeOffSlot, removeTextSection, removeTimelineBlockFromContent, replaceBlockInContent, replaceEntryLine, setEntryTodoBinding, setHeaderValue, setTextSection, updateTodo } from "./edit/source-rewriter"
import { buildLayerToggles, buildToolbar, LayerView } from "./edit/toolbar"
import { attachDrawInteraction, requestTimelineEntryDelete } from "./edit/draw-interaction"
import { attachMarkerInteraction } from "./edit/marker-interaction"
import { showBlockMenu, showMarkerMenu } from "./edit/block-menu"
import { attachHoverInfo, toggleBlockFocus } from "./edit/hover-info"
import { applyGridToBody, attachGridInteract } from "./edit/grid-interact"
import { compactGrid, defaultComponentSlot, GRID_COLS, GRID_ROW_H, gridRows, GridItem, HABITS_EMPTY_ROWS, MAX_GRID_COLS, serializeLayoutHeader } from "./core/grid-layout"
import { inferDate, insertTimelineBlock } from "./insert"
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
import { ScrollTransactionRegistry, type ScrollTransactionKey } from "./edit/scroll-transaction"
import { chooseMutationView, findOwningView, resolvePersistedOwnerView, resolveTransactionOwner } from "./edit/view-owner"
import { timelineFenceAtOrdinal, timelineFenceOrdinal, timelineSourceAtOrdinal } from "./edit/block-identity"
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
import { extractDatedTimelineEntries, filterWeekEntries, type DatedTimelineEntries } from "./core/weekly-ledger"
import { formatTodoViewHeaderValue, isWeeklyTodoDue, todoMetrics } from "./core/todos"
import { renderHabitsInto } from "./render/habits-view"
import { renderTodosInto, type NewTodoInput, type TodoEditDraft, type TodoViewItem } from "./render/todos-view"
import { renderDailyQuoteInto } from "./render/daily-quote-view"
import {
  nextDailyQuote,
  normalizeDailyQuoteAppearance,
  normalizeDailyQuoteDefinition,
  resolveDailyQuote,
  type DailyQuoteAppearance,
  type DailyQuoteDefinition,
} from "./core/daily-quotes"
import { createPointerRedrawGate } from "./edit/pointer-interaction"
import { attachTimelineScheduleDrag } from "./edit/timeline-schedule-drag"
import { buildTodoGroupMenuOptions, buildTodoSortMenuOptions } from "./edit/block-menu-model"
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
import type { Annotation, Entry } from "./core/types"

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
 * Oneday — highlighter-style daily timeline block.
 * Markdown source is the single source of truth (mermaid-style dual view).
 * M1 渲染 / M2 对话框 / M3 画板编辑（选荧光笔→拖色块→写回；右键菜单）。
 */
export default class OnedayPlugin extends Plugin {
  settings: OnedaySettings = DEFAULT_SETTINGS
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
  private weeklyLedger: DatedTimelineEntries[] | null = null
  private weeklyLedgerLoading: Promise<void> | null = null
  private ledgerRefreshTimer = 0
  private ledgerGeneration = 0

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
    container.classList.remove("oneday-view-all", "oneday-view-actual", "oneday-view-plan", "oneday-view-none")
    const cls = view.actual && view.plan ? "all" : view.actual ? "actual" : view.plan ? "plan" : "none"
    container.classList.add(`oneday-view-${cls}`)
  }

  async onload(): Promise<void> {
    configureI18n(getLanguage)
    await this.loadSettings()
    this.addSettingTab(new OnedaySettingTab(this.app, this))
    const invalidateLedger = (file: TAbstractFile): void => {
      this.ledgerGeneration += 1
      this.weeklyLedger = null
      this.ledgerModifiedPaths.add(file.path)
      if (this.ledgerRefreshTimer) activeWindow.clearTimeout(this.ledgerRefreshTimer)
      this.ledgerRefreshTimer = activeWindow.setTimeout(() => {
        this.ledgerRefreshTimer = 0
        const modifiedPaths = new Set(this.ledgerModifiedPaths)
        this.ledgerModifiedPaths.clear()
        this.rerenderMountedTimelines(modifiedPaths)
      }, 120)
    }
    this.registerEvent(this.app.vault.on("modify", invalidateLedger))
    this.registerEvent(this.app.vault.on("create", invalidateLedger))
    this.registerEvent(this.app.vault.on("delete", invalidateLedger))
    this.registerEvent(this.app.vault.on("rename", invalidateLedger))

    // 插入入口：命令面板 + 编辑器右键菜单
    this.addCommand({
      id: "insert-timeline-block",
      name: tr("insertTimelineBlock"),
      editorCallback: (editor) => {
        insertTimelineBlock(editor, this.app.workspace.getActiveFile()?.basename ?? null, this.insertTemplate())
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

    // Paste is an external CodeMirror transaction. Freeze each Oneday block's
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
        view.containerEl.querySelectorAll<HTMLElement>(".oneday-container").forEach((container: HTMLElement) => {
          container.dispatchEvent(new CustomEventCtor("oneday-before-external-edit", { bubbles: true }))
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
      })
    )

    this.registerMarkdownCodeBlockProcessor("timeline", (source, el, ctx) => {
      const mountKey = this.scrollTransactionKey(el, ctx)
      const snapshotLatch = new RemountSnapshotLatch<TimelineScrollSnapshot>()
      const pointerRedrawGate = createPointerRedrawGate()
      let redrawQueue = Promise.resolve()
      let stopTracking = (): void => undefined
      let releaseFreezeTimer = 0
      const startTracking = (): void => {
        stopTracking()
        const current = el.querySelector<HTMLElement>(".oneday-container")
        if (!current) return
        const update = (): void => {
          if (current.isConnected) snapshotLatch.update(this.captureScroll(current))
        }
        update()
        const snapshot = snapshotLatch.value
        const scrollOwners = new Set<HTMLElement>([
          ...Array.from(current.querySelectorAll<HTMLElement>(".oneday-block-scroll, .oneday-svg-holder, .oneday-text-pane")),
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
        const current = el.querySelector<HTMLElement>(".oneday-container")
        // A source write owns its original snapshot across the replacement.
        // Ordinary settings redraws keep a local snapshot, but must never
        // overwrite an in-flight write after CodeMirror has already moved.
        const key = this.scrollTransactionKey(el, ctx)
        const pending = this.scrollTransactions.claim(key, source)
        const remounted = this.remountScroll.take(key, source)
        const scrollSnapshot = pending ?? remounted ?? (current ? this.captureScroll(current) : null)
        if (scrollSnapshot) snapshotLatch.update(scrollSnapshot)
        stopTracking()
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
        const current = el.querySelector<HTMLElement>(".oneday-container")
        if (!current) {
          queueRedraw()
          return
        }
        pointerRedrawGate.run(current, () => {
          if (el.isConnected) queueRedraw()
        })
      }
      const previewMountedSource = (nextSource: string, previousSource: string): (() => void) | null => {
        const current = el.querySelector<HTMLElement>(".oneday-container")
        if (!current?.isConnected) return null
        const scrollSnapshot = this.captureScroll(current)
        const paint = (value: string): void => {
          void flushInlineTextEditors(el)
          stopTracking()
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
        const current = el.querySelector<HTMLElement>(".oneday-container")
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
      el.addEventListener("oneday-before-external-edit", freezeBeforeExternalEdit)
      ctx.addChild(new MountedTimelineChild(
        el,
        () => {
          unregister()
          unregisterVisual()
          pointerRedrawGate.clear()
          el.removeEventListener("oneday-before-external-edit", freezeBeforeExternalEdit)
          const domWindow = el.ownerDocument.defaultView
          if (releaseFreezeTimer && domWindow) domWindow.clearTimeout(releaseFreezeTimer)
          releaseFreezeTimer = 0
        },
        () => flushInlineTextEditors(el),
        () => {
          const current = el.querySelector<HTMLElement>(".oneday-container")
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
      const quoteAppearance = normalizeDailyQuoteAppearance({ ...this.settings.dailyQuoteDefaults, ...doc.dailyQuote.appearance })
      const selectedQuote = resolveDailyQuote(this.settings.dailyQuotes, dateStr ?? "", doc.dailyQuote)
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
      if (layoutHas("quote")) extraSlots.push(defaultComponentSlot("quote", 8, doc.side))
      const textBlockKey = this.mutationBlockKey(el, ctx)
      const blockIdentity: BlockIdentity<object> = {
        owner: textBlockKey.owner,
        path: textBlockKey.path,
        blockOrdinal: textBlockKey.blockOrdinal,
      }
      const textDraftKey = (index: number): TextDraftKey<object> => ({
        owner: textBlockKey.owner,
        path: textBlockKey.path,
        blockOrdinal: textBlockKey.blockOrdinal,
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
          getDraft: (index) => this.textDrafts.get(textDraftKey(index)),
          onDraftChange: (index, draft) => {
            const key = textDraftKey(index)
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
        // 添加文本框（常驻，可多个；落在点击的格子附近）
        menu.addItem((item) =>
          item.setTitle(tr("addTextBox")).setIcon("file-plus-2").setSection("components").onClick(() => {
            void this.applyBlockTransform(el, ctx, source, (s) => {
              const newId = doc.texts.length === 0 ? "text" : `text${doc.texts.length + 1}`
              let out = setTextSection(s, "", doc.texts.length) // 追加空文本区
              if (body) {
                const bodyRect = body.getBoundingClientRect()
                if (bodyRect.width > 100) {
                  const columns = Number(body.dataset.gridCols) || GRID_COLS
                  const cellW = bodyRect.width / columns
                  const gx = Math.min(MAX_GRID_COLS - 6, Math.max(0, Math.floor((x - bodyRect.left) / cellW)))
                  const gy = Math.max(0, Math.floor((y - bodyRect.top) / GRID_ROW_H))
                  const items = Array.from(body.querySelectorAll<HTMLElement>(".oneday-slot")).map((sl) => ({
                    id: sl.dataset.slot as GridItem["id"],
                    x: Number(sl.dataset.x), y: Number(sl.dataset.y), w: Number(sl.dataset.w), h: Number(sl.dataset.h),
                  }))
                  items.push({ id: newId, x: gx, y: gy, w: 6, h: 4 })
                  out = setHeaderValue(out, "layout", serializeLayoutHeader(compactGrid(items, newId)))
                }
              }
              return out
            })
          })
        )
        for (const [slotId, label, icon] of [
          ["habits", tr("addHabitComponent"), "list-checks"],
          ["todos", tr("addTodoComponent"), "list-todo"],
          ["quote", tr("addDailyQuoteComponent"), "quote"],
        ] as const) {
          if (container.querySelector(`.oneday-slot-${slotId}`) || doc.hiddenSlots.includes(slotId)) continue
          menu.addItem((item) => item.setTitle(label).setIcon(icon).setSection("components").onClick(() => {
            void this.applyBlockTransform(el, ctx, source, (value) => {
              let out = this.addComponentSlot(value, doc, container, slotId)
              if (slotId === "quote") {
                const initial = resolveDailyQuote(this.settings.dailyQuotes, dateStr ?? "", { appearance: {} })
                out = this.setDailyQuoteHeaders(out, initial, this.settings.dailyQuoteDefaults)
              }
              return out
            })
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
            if (body) {
              const items = Array.from(body.querySelectorAll<HTMLElement>(".oneday-slot")).map((sl) => ({
                id: sl.dataset.slot as GridItem["id"],
                x: Number(sl.dataset.x), y: Number(sl.dataset.y), w: Number(sl.dataset.w), h: Number(sl.dataset.h),
              }))
              this.settings.templateLayout = serializeLayoutHeader(items)
            }
            this.settings.templateWidth = doc.width
            this.settings.templateHasText = doc.texts.length > 0
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
            .setTitle(tr("deleteOnedayBlock"))
            .setIcon("trash-2")
            .setWarning(true)
            .setSection("danger")
            .onClick(() => {
              void this.deleteTimelineBlock(el, ctx).catch((error: unknown) => {
                console.error("Oneday: failed to delete timeline block", error)
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
          ?.querySelector<HTMLElement>(".oneday-container") ?? null
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

      const editNote = (ln: number): void => {
        const target = targetForEntryLine(ln)
        // 写回触发的重渲染可能已替换 container；只允许回到同一个块，
        // 绝不能用 document.querySelector 命中同页/同文件的另一个块。
        const live = liveContainer()
        if (!live) return
        const rect = live.querySelector(`rect.oneday-block[data-line="${ln}"]`)
        const e0 = doc.entries.find((it) => it.line === ln)
        if (!rect || !e0 || !target) return
        openNotePopover(live, rect, rect.getBoundingClientRect(), e0.note ?? "", async (note) => {
          try {
            await this.applyBlockTransform(el, ctx, source, (s) => rewriteEntryTarget(
              s,
              target,
              (entry) => formatEntryLine({ ...entry, note: note || undefined }),
            ), { previewVisual: previewTimeline })
          } catch (error) {
            new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 8000)
            throw error
          }
        })
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
        domDocument: dom,
      })
      // 填槽：工具栏/状态行/对话框各就各位（插槽位置由 layout 决定）
      const toolbarSlot = container.querySelector<HTMLElement>(".oneday-slot-toolbar")
      if (toolbarSlot) {
        // Geometry controls are still real content when the selected tool has
        // no categories.  Only the second row is empty; preserving the normal
        // slot shell keeps both tools on the same top/content inset.
        toolbarSlot.classList.remove("is-empty-state")
        toolbarSlot.appendChild(toolbar.el)
      }
      const timelineSlot = container.querySelector<HTMLElement>(".oneday-slot-timeline")
      if (timelineSlot) {
        timelineSlot.appendChild(toolbar.statusEl)
        // 顶栏：日期+星期（跨期统计锚点）在左，记录/计划开关在右
        const topbar = dom.createElement("div")
        topbar.className = "oneday-timeline-topbar" // 宽度跟随元素块（槽位），非时间轴矩形
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

      const habitsSlot = container.querySelector<HTMLElement>(".oneday-slot-habits")
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

      const todosSlot = container.querySelector<HTMLElement>(".oneday-slot-todos")
      const todoViewItems: TodoViewItem[] = [
        ...doc.todos.map((todo) => {
          const metrics = todoMetrics(todo, doc.entries)
          return { ...todo, weekly: false, estimateMinutes: metrics.estimateMinutes, actualMinutes: metrics.actualMinutes }
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
          onGroupMenu: (x, y) => {
            const menu = new Menu()
            const setView = (patch: Partial<typeof doc.todoView>): void => {
              const next = { ...doc.todoView, ...patch }
              void this.applyBlockTransform(el, ctx, source, (value) =>
                setHeaderValue(value, "todo-view", formatTodoViewHeaderValue(next)))
            }
            buildTodoGroupMenuOptions(doc.todoView.groupBy, {
              none: tr("todoGroupNone"),
              category: tr("todoGroupCategory"),
              status: tr("todoGroupStatus"),
            }).forEach(({ value, title, checked }) => menu.addItem((item) => item
              .setTitle(title)
              .setChecked(checked)
              .onClick(() => setView({ groupBy: value }))))
            menu.showAtPosition({ x, y }, dom)
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
              void this.saveSettings({ rerender: true })
              return
            }
            void this.applyBlockTransform(el, ctx, source, (value) => updateTodo(value, id, {
              title: input.title,
              type: input.type,
              estimateMin: input.estimateMinutes,
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
            if (todo.weekly && dateStr) {
              menu.addItem((item) => item.setTitle(tr("endFutureTodo")).setIcon("calendar-off").onClick(() => {
                const stored = this.settings.weeklyTodos.find((item) => item.id === todo.id)
                if (!stored) return
                stored.endDate = this.previousDate(dateStr)
                void this.saveSettings({ rerender: true })
              }))
            } else menu.addItem((item) => item.setTitle(tr("deleteTodo")).setIcon("trash").onClick(() => {
              void this.applyBlockTransform(el, ctx, source, (value) => deleteTodo(value, todo.id))
            }))
            menu.showAtPosition({ x, y }, dom)
          },
        })
      }

      const quoteSlot = container.querySelector<HTMLElement>(".oneday-slot-quote")
      if (quoteSlot) {
        let currentQuote = selectedQuote
        let currentAppearance = quoteAppearance

        const commitQuote = async (
          nextQuote: typeof currentQuote,
          nextAppearance: typeof currentAppearance
        ): Promise<void> => {
          const previousQuote = currentQuote
          const previousAppearance = currentAppearance
          await this.applyBlockTransform(
            el,
            ctx,
            source,
            (value) => this.setDailyQuoteHeaders(value, nextQuote, nextAppearance),
            {
              // The quote widget is repainted in place before the Markdown
              // processor remounts it. Preserve that visible DOM anchor;
              // CodeMirror's document snapshot alone can otherwise reveal
              // the top of a large rendered block after the remount.
              outerViewportAuthority: "dom",
              // Switching a sentence changes one self-contained slot. Avoid an
              // eager full-Block teardown; the matching post-processor render
              // remains authoritative once the Markdown transaction lands.
              previewVisual: (newSource) => {
                const rollbackSource = this.timelineVisuals.advance(el, newSource)
                currentQuote = nextQuote
                currentAppearance = nextAppearance
                paintQuote()
                return () => {
                  rollbackSource?.()
                  currentQuote = previousQuote
                  currentAppearance = previousAppearance
                  paintQuote()
                }
              },
            }
          )
        }

        const openEditor = (): void => new DailyQuoteSettingsModal(
          this.app,
          this,
          currentAppearance,
          currentQuote,
          async (appearance) => commitQuote(currentQuote, appearance)
        ).open()

        const paintQuote = (): void => renderDailyQuoteInto(quoteSlot, currentQuote, currentAppearance, {
          onNext: () => {
            const next = nextDailyQuote(this.settings.dailyQuotes, currentQuote?.id)
            if (!next) return openEditor()
            void commitQuote(next, currentAppearance)
          },
          onEdit: openEditor,
          resolveBackgroundImage: (value) => this.resolveDailyQuoteBackgroundImage(value),
        })

        paintQuote()
      }
      const col = container.querySelector(".oneday-timeline-col")
      const body = container.querySelector<HTMLElement>(".oneday-body")
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
            const svgEl = container.querySelector<SVGSVGElement>("svg.oneday-svg")
            if (svgEl) {
              const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
              svgEl.dispatchEvent(new CustomEventCtor("oneday-exit-edit"))
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
            new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 8000)
            throw error
          }
        }
        const requestDeleteTimelineEntry = (line: number): void => {
          const svgEl = container.querySelector<SVGSVGElement>("svg.oneday-svg")
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
            && Boolean((error as Error & { onedayNoticeReported?: boolean }).onedayNoticeReported)
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
            editTimes: (ln) => {
              const live = liveContainer()
              if (!live) return
              const rect = live.querySelector(`rect.oneday-block[data-line="${ln}"]`)
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
              const svgEl = container.querySelector("svg.oneday-svg")
              const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
              svgEl?.dispatchEvent(new CustomEventCtor("oneday-sync-edit"))
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
          return live?.querySelector<SVGGElement>(`g.oneday-marker[data-line="${line}"]`) ?? null
        }
        const editMarkerNote = (line: number): void => {
          const target = targetForMarkerLine(line)
          const anchor = markerAnchor(line)
          const marker = doc.annotations.find((item) => item.line === line && item.type)
          const live = anchor?.closest<HTMLElement>(".oneday-container")
          if (!anchor || !marker || !live || !target) return
          openNotePopover(live, anchor, anchor.getBoundingClientRect(), marker.text, async (text) => {
            try {
              await this.applyBlockTransform(el, ctx, source, (value) => rewriteMarkerTarget(
                value,
                target,
                (current) => formatMarkerLine({ ...current, type: current.type!, text }),
              ))
            } catch (error) {
              new Notice(error instanceof Error ? error.message : tr("sourceChanged"), 8000)
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
                container.querySelector("svg.oneday-svg")?.dispatchEvent(new CustomEventCtor("oneday-marker-sync-edit"))
              },
              editTime: (targetLine) => {
                const anchor = markerAnchor(targetLine)
                const current = doc.annotations.find((item) => item.line === targetLine && item.type)
                const live = anchor?.closest<HTMLElement>(".oneday-container")
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
        const slotEl = container.querySelector<HTMLElement>(".oneday-slot-timeline")
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
      settingsButton.className = "oneday-open-settings"
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
      more.className = "oneday-more-actions"
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
      layoutEdit.className = "oneday-layout-edit-toggle"
      layoutEdit.setAttribute("aria-pressed", "false")
      const layoutEditIcon = dom.createElement("span")
      layoutEditIcon.className = "oneday-layout-edit-icon"
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
        if (t?.closest("button, input, textarea, a, .oneday-svg, .oneday-text-host, .oneday-add-menu")) return
        e.preventDefault()
        // 点在组件空白上 -> 提供统一的自制「隐藏」菜单（off: 头，可从更多菜单重新显示）
        const slotEl = t?.closest(".oneday-slot") as HTMLElement | null
        const slotId = slotEl?.dataset.slot
        if (slotId && (slotId === "text" || /^text\d+$/.test(slotId)) && t?.closest(".oneday-text-pane") === null) {
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
        if (slotId && ["toolbar", "stats", "dialog", "habits", "todos", "quote"].includes(slotId)) {
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

      const dialogSlot = container.querySelector<HTMLElement>(".oneday-slot-dialog")
      if ((Platform.isDesktopApp || this.settings.dialogBackend === "api") && dialogSlot) {
        attachDialog(dialogSlot, doc, {
          settings: this.settings,
          openSettings: () => {
            // @ts-expect-error 内部 API
            this.app.setting?.open?.()
            // @ts-expect-error 内部 API
            this.app.setting?.openTabById?.("oneday")
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
    const body = container.querySelector<HTMLElement>(".oneday-body")
    if (!body) return source
    const items = Array.from(body.querySelectorAll<HTMLElement>(".oneday-slot")).map((sl) => ({
      id: sl.dataset.slot as GridItem["id"],
      x: Number(sl.dataset.x), y: Number(sl.dataset.y), w: Number(sl.dataset.w), h: Number(sl.dataset.h),
    }))
    if (items.length === 0) return source
    return setHeaderValue(source, "layout", serializeLayoutHeader(items))
  }

  private insertTemplate(): { layout?: string; width?: number; hasText?: boolean } {
    return {
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
    if (this.weeklyLedger) return filterWeekEntries(this.weeklyLedger, date)
    if (!this.weeklyLedgerLoading) {
      const generation = this.ledgerGeneration
      this.weeklyLedgerLoading = Promise.all(this.app.vault.getMarkdownFiles().map(async (file) =>
        extractDatedTimelineEntries(await this.app.vault.cachedRead(file), file.basename)
      )).then((groups) => {
        if (generation === this.ledgerGeneration) this.weeklyLedger = groups.flat()
      }).catch((error: unknown) => {
        console.error("Oneday: failed to build weekly ledger", error)
        if (generation === this.ledgerGeneration) this.weeklyLedger = []
      }).finally(() => {
        this.weeklyLedgerLoading = null
        this.rerenderMountedTimelines()
      })
    }
    return [{ date, entries: fallback }]
  }

  private previousDate(date: string): string {
    const [year, month, day] = date.split("-").map(Number)
    const value = new Date(year, month - 1, day - 1)
    const part = (input: number): string => String(input).padStart(2, "0")
    return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`
  }

  private addComponentSlot(source: string, doc: { layout?: unknown }, container: HTMLElement, id: "habits" | "todos" | "quote"): string {
    let out = removeOffSlot(this.persistLayoutOnce(source, doc, container), id)
    const parsed = this.parse(out)
    const items = parsed.layout ? [...parsed.layout] : []
    if (items.some((item) => item.id === id)) return out
    const maxY = items.reduce((value, item) => Math.max(value, item.y + item.h), 0)
    // Append below everything, then let gravity pull the six-column slot into
    // the first free space of its column instead of pinning it under the
    // timeline. Rendering re-runs the same compaction, so this is what the
    // user would see anyway.
    items.push({ ...defaultComponentSlot(id, id === "habits" ? HABITS_EMPTY_ROWS : 8, parsed.side), y: maxY })
    return setHeaderValue(out, "layout", serializeLayoutHeader(compactGrid(items)))
  }

  private setDailyQuoteHeaders(source: string, quote: DailyQuoteDefinition | null, appearance: DailyQuoteAppearance): string {
    let out = source
    if (quote) {
      out = setHeaderValue(out, "quote", quote.id)
      out = setHeaderValue(out, "quote-text", quote.text.replace(/\s+/g, " ").trim())
      out = setHeaderValue(out, "quote-author", quote.author.replace(/\s+/g, " ").trim())
    }
    const normalized = normalizeDailyQuoteAppearance(appearance)
    for (const [key, value] of [
      ["quote-theme", normalized.theme], ["quote-layout", normalized.layout], ["quote-font", normalized.font],
      ["quote-size", String(normalized.fontSize)], ["quote-bg", normalized.backgroundColor],
      ["quote-text-color", normalized.textColor], ["quote-accent", normalized.accentColor],
      ["quote-image", normalized.backgroundImage], ["quote-overlay", String(normalized.overlay)],
      ["quote-image-x", String(normalized.imageFocalX)], ["quote-image-y", String(normalized.imageFocalY)],
      ["quote-image-zoom", String(normalized.imageZoom)],
    ] as const) out = value ? setHeaderValue(out, key, value) : removeHeaderValue(out, key)
    return out
  }

  resolveDailyQuoteBackgroundImage(value: string): string {
    if (/^https?:\/\//i.test(value)) return value
    const file = this.app.vault.getAbstractFileByPath(value.replace(/^\/+/, ""))
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : ""
  }

  async importDailyQuoteBackgroundImage(file: File): Promise<string> {
    if (!file.type.startsWith("image/")) throw new Error("not-image")
    if (file.size > 15 * 1024 * 1024) throw new Error("image-too-large")
    const directory = normalizePath(".oneday/assets/daily-quotes")
    const parts = directory.split("/")
    let current = ""
    for (const part of parts) {
      current = normalizePath(current ? `${current}/${part}` : part)
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current)
    }
    const fallbackExtension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png"
    const original = file.name.trim() || `image.${fallbackExtension}`
    const extension = original.includes(".") ? original.split(".").pop()!.toLowerCase() : fallbackExtension
    const stem = original.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "image"
    let target = normalizePath(`${directory}/${Date.now().toString(36)}-${stem}.${extension}`)
    let suffix = 2
    while (this.app.vault.getAbstractFileByPath(target)) target = normalizePath(`${directory}/${Date.now().toString(36)}-${stem}-${suffix++}.${extension}`)
    await this.app.vault.createBinary(target, await file.arrayBuffer())
    return target
  }

  listDailyQuoteBackgroundImages(): { path: string; name: string }[] {
    const supported = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"])
    return this.app.vault.getFiles()
      .filter((file) => supported.has(file.extension.toLowerCase()))
      .map((file) => ({ path: file.path, name: file.basename }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Grow slots whose content exceeds their grid height, then re-compact (display-only). */
  private fitSlotHeights(container: HTMLElement): void {
    const run = (): void => {
      const body = container.querySelector<HTMLElement>(".oneday-body")
      if (!body) return
      const viewportAnchor = captureViewportAnchor(container)
      const slots = Array.from(body.querySelectorAll<HTMLElement>(".oneday-slot"))
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
    if (!container.dataset.onedayFitPending) {
      container.dataset.onedayFitPending = "1"
      container.ownerDocument.defaultView?.setTimeout(() => {
        delete container.dataset.onedayFitPending
        run()
      }, 300)
    }
  }

  /** Capture the exact visible scroller; file path alone is never an owner. */
  private captureScroll(container: HTMLElement): TimelineScrollSnapshot {
    const block = container.matches(".oneday-container")
      ? container
      : container.querySelector<HTMLElement>(".oneday-container")
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
    const asyncRenders = container.querySelectorAll<HTMLElement>(".oneday-text-host")
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
      const slots = Array.from(container.querySelectorAll<HTMLElement>(".oneday-slot")).filter((s) => /^text\d*$/.test(s.dataset.slot ?? ""))
      slots.forEach((slot) => {
        const target = snapshot.internal.texts[slot.dataset.slot ?? ""]?.top ?? 0
        const scroller = slot.querySelector<HTMLElement>(".oneday-text-pane") ?? slot
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
    section = ctx.getSectionInfo(el),
    ownerOverride?: object,
    contentOverride?: string
  ): ScrollTransactionKey<object> {
    const viewOwner = this.owningMarkdownView(ctx.sourcePath, el)
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
    return {
      owner,
      path: ctx.sourcePath,
      docId: ctx.docId,
      lineStart: section?.lineStart ?? -1,
      blockOrdinal: section && content !== null
        ? timelineFenceOrdinal(content, section.lineStart)
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
    if (view) {
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

    // Multiple open panes without a provable DOM owner are ambiguous. Never
    // fall back to vault.process in that case because it could overwrite an
    // unrelated pane's unsaved source.
    if (views.length > 0) throw new Error(tr("sourceChanged"))

    await this.app.vault.process(file, (content) => {
      const updated = removeTimelineBlockFromContent(content, section)
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
    key: ScrollTransactionKey<object>,
    transform: (source: string) => string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(key.path)
    if (!(file instanceof TFile)) throw new Error(tr("fileNotFound"))
    if (key.blockOrdinal < 0) throw new Error(tr("blockNotFound"))

    const views = this.markdownViews(key.path)
    // The MarkdownView object can be replaced while Obsidian rebuilds a leaf.
    // A sole same-path pane is still unambiguous; with multiple panes we must
    // keep failing closed rather than write another pane's unsaved document.
    const view = resolvePersistedOwnerView(key.owner, views, (candidate) => candidate.leaf)
    if (view) {
      const editor = view.editor
      const content = editor.getValue()
      const location = timelineFenceAtOrdinal(content, key.blockOrdinal)
      if (!location) throw new Error(tr("sourceChanged"))
      const newSource = transform(location.source)
      if (newSource === location.source) return

      const host = this.timelineVisuals.findHost(key.path, key.owner, key.blockOrdinal)
      const visualContainer = host?.querySelector<HTMLElement>(".oneday-container") ?? null
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
      const transactionSnapshot = snapshot
        ? (codeMirrorWrite ? { ...snapshot, viewport: null } : snapshot)
        : null

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
            if (codeMirrorWrite) codeMirrorWrite.apply()
            else editor.replaceRange(replacement, from, to)
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

    // A matching file is open, but the pane which owned this draft no longer
    // exists. Choosing another pane could overwrite unsaved source there.
    if (views.length > 0) throw new Error(tr("sourceChanged"))

    await this.app.vault.process(file, (content) => {
      const location = timelineFenceAtOrdinal(content, key.blockOrdinal)
      if (!location) throw new Error(tr("sourceChanged"))
      const newSource = transform(location.source)
      return newSource === location.source
        ? content
        : replaceBlockInContent(content, location, newSource)
    })
  }

  /** Sole write path into markdown (D7/D3 共用): transform block source, splice back. */
  private async applyBlockTransform(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    _source: string,
    transform: (source: string) => string,
    options: BlockTransformOptions = {}
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath)
    if (!(file instanceof TFile)) throw new Error(tr("fileNotFound"))
    const section = ctx.getSectionInfo(el)
    if (!section) throw new Error(tr("blockNotFound"))

    // 优先走编辑器事务（进 CM6 撤销栈，Ctrl+Z 可撤回，yyt 2026-08-17）；
    // 找不到打开的编辑器再退回 vault.process。关键点：每次都从当前编辑器/文件
    // 重新读取块正文，不能用 render 时捕获的 source 覆盖刚刚保存的文字。
    const views = this.markdownViews(ctx.sourcePath)
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
    const view = chooseMutationView(ctx.sourcePath, el, views, activeView)
    if (view) {
      const editor = view.editor
      const liveSource = extractBlockSourceFromContent(editor.getValue(), section)
      if (liveSource === null) throw new Error(tr("sourceChanged"))
      const newSource = transform(liveSource)
      if (newSource === liveSource) return
      const transactionKey = this.scrollTransactionKey(el, ctx, section, view.leaf, editor.getValue())
      const snapshot = options.scrollSnapshot
        ?? this.captureScroll(el.closest(".oneday-container") as HTMLElement ?? el)
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
      // When the source pane owns this write, CodeMirror's scrollSnapshot
      // effect is the sole outer-viewport authority. Keep nested Oneday
      // scrollers, but do not run a competing DOM viewport correction.
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
        const visualContainer = el.querySelector<HTMLElement>(".oneday-container")
          ?? el.closest<HTMLElement>(".oneday-container")
        if (visualContainer) beginRemountVisual(
          this.remountVisual,
          transactionKey,
          visualContainer,
          resolveRemountVisualMode(options.remountVisual, Boolean(rollbackVisual))
        )
        const applyEditorMutation = (): void => {
          if (codeMirrorWrite) codeMirrorWrite.apply()
          else editor.replaceRange(replacement, from, to)
        }
        await applyDurableWrite({
          apply: applyEditorMutation,
          memoryMatches: () => timelineSourceAtOrdinal(editor.getValue(), transactionKey.blockOrdinal) === newSource,
          save: () => view.save(),
          persistedMatches: async () => {
            const persistedSource = timelineSourceAtOrdinal(await this.app.vault.read(file), transactionKey.blockOrdinal)
            const currentEditorSource = timelineSourceAtOrdinal(editor.getValue(), transactionKey.blockOrdinal)
            // A later Oneday action may already have advanced this same block
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
        const reported = error instanceof Error ? error : new Error(tr("timelineSaveFailed"))
        ;(reported as Error & { onedayNoticeReported?: boolean }).onedayNoticeReported = true
        new Notice(tr("timelineSaveFailed"), 0)
        throw reported
      }
      return
    }
    // If this file is open but the initiating DOM belongs to none of its
    // panes, the renderer is stale. Fail closed rather than write a different
    // pane or overwrite unsaved editor state through vault.process.
    if (views.length > 0) throw new Error(tr("sourceChanged"))

    let transactionKey: ScrollTransactionKey<object> | null = null
    const visualRollback: { current: (() => void) | null } = { current: null }
    try {
      await this.app.vault.process(file, (content) => {
        const liveSource = extractBlockSourceFromContent(content, section)
        if (liveSource === null) throw new Error(tr("sourceChanged"))
        const newSource = transform(liveSource)
        if (newSource === liveSource) return content
        visualRollback.current = (options.previewVisual
          ?? ((value: string) => this.timelineVisuals.preview(el, value)))(newSource) ?? null
        transactionKey = this.scrollTransactionKey(el, ctx, section, undefined, content)
        const snapshot = options.scrollSnapshot
          ?? this.captureScroll(el.closest(".oneday-container") as HTMLElement ?? el)
        this.scrollTransactions.begin(transactionKey, newSource, snapshot)
        const visualContainer = el.querySelector<HTMLElement>(".oneday-container")
          ?? el.closest<HTMLElement>(".oneday-container")
        if (visualContainer) beginRemountVisual(
          this.remountVisual,
          transactionKey,
          visualContainer,
          resolveRemountVisualMode(options.remountVisual, Boolean(visualRollback.current))
        )
        return replaceBlockInContent(content, section, newSource)
      })
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
    const data = (await this.loadData()) as (Partial<OnedaySettings> & LegacyCategoryPaletteSettings) | null
    const hasPersistedSettings = data !== null
    const needsCategoryMigration = Boolean(data && ("typeColors" in data || "retiredTypeColors" in data))
    const palettes = migrateCategoryPalettes(data)
    const { typeColors: _legacyTypeColors, retiredTypeColors: _legacyRetiredTypeColors, ...current } = data ?? {}
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
      dailyQuoteDefaults: normalizeDailyQuoteAppearance(data?.dailyQuoteDefaults),
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
    this.app.setting?.openTabById?.("oneday")
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
      (error) => console.error("Oneday: failed to refresh a mounted timeline", error),
      excludedSourcePaths
    )
  }
}

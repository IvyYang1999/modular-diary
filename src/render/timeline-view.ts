/** Optional text-pane wiring (块内图文混排): render markdown + edit affordance. */
export interface TextPaneDeps {
  /** Render doc.text markdown into the pane (Obsidian MarkdownRenderer). */
  renderMarkdown: (host: HTMLElement, text: string) => void
  /** Persist edited text（第 index 个文本区） */
  onSave: (index: number, text: string) => void | Promise<void>
  /** Drafts live above the disposable MarkdownPostProcessor DOM tree. */
  getDraft?: (index: number) => TextDraftState | null
  onDraftChange?: (index: number, draft: TextDraftState | null) => void
}

/** DOM mount: svg string + stats row + error list, into a code-block container. */
import { TimelineDoc } from "../core/types"
import { statsByType } from "../core/stats"
import { formatHours } from "../core/duration"
import { fitSideLaneWidth, renderTimelineSvg, RenderOptions, SIDE_LANE_W } from "./svg-builder"
import type { TextMeasurer } from "../core/text-wrap"
import { hashTypeColor } from "../core/type-colors"
import { t } from "../i18n"
import { relatedTextColor } from "../core/contrast"
import { GRID_ROW_H, GridItem, gridRows, isTextSlot, resolveGrid } from "../core/grid-layout"
import { applyGridToBody } from "../edit/grid-interact"
import type { TextDraftState } from "../edit/text-draft"
import { captureViewportAnchor, stabilizeViewportAnchor } from "../edit/viewport-anchor"

interface InlineEditorDeps {
  renderMarkdown: (host: HTMLElement, text: string) => void
  onSave: (text: string) => void | Promise<void>
  initialDraft?: TextDraftState | null
  onDraftChange?: (draft: TextDraftState | null) => void
}

export interface TimelineViewOptions extends RenderOptions {
  /** 仅给真正的新用户展示一次的时间轴拖拽引导。 */
  showTimelineOnboarding?: boolean
  /**
   * No span or point category exists yet. An empty track then carries one
   * centred prompt that opens the same category editor as the toolbar's
   * "Add first category"; it disappears with the first category or entry.
   */
  onAddFirstCategory?: () => void
  /** Optional product components requested for this date/block. */
  extraSlots?: GridItem[]
}

const TEXT_EDITOR_FLUSH_EVENT = "oneday:text-editor-flush"

/**
 * Fixed chrome the plugin mounts around the SVG inside the timeline slot. The
 * default slot height must reserve it, otherwise the last hours of the range
 * are only reachable through the holder's internal scroll. Mirrors styles.css:
 *   slot border 1 + 1 and --oneday-slot-padding-block 8 + 8       = 18
 *   .oneday-timeline-topbar: 26px compact control + 2px padding
 *     + 1px border on both sides (32) + 2px margin-bottom          = 34
 *   .oneday-draw-status: 14px + 2px margin top/bottom              = 18
 * The mount-smoke contract measures the real DOM against this value.
 */
export const TIMELINE_SLOT_CHROME_H = 70

interface TextEditorFlushEvent extends Event {
  waitUntil?: (promise: Promise<void>) => void
}

/** Commit every dirty inline text editor below root before its DOM is replaced. */
export function flushInlineTextEditors(root: ParentNode): Promise<void> {
  const pending: Promise<void>[] = []
  root.querySelectorAll<HTMLElement>(".oneday-text-pane").forEach((pane) => {
    const event = pane.ownerDocument.createEvent("Event") as TextEditorFlushEvent
    event.initEvent(TEXT_EDITOR_FLUSH_EVENT, false, false)
    event.waitUntil = (promise) => pending.push(promise.catch(() => undefined))
    pane.dispatchEvent(event)
  })
  return Promise.all(pending).then(() => undefined)
}

/** 文字区原地编辑：点击渲染区 -> textarea；失焦/⌘Enter 保存，Esc 取消（yyt：不要弹窗）。 */
export function attachInlineTextEditor(pane: HTMLElement, initialText: string, deps: InlineEditorDeps): void {
  const dom = pane.ownerDocument
  const domWindow = dom.defaultView
  let text = initialText
  let detachFocusout: (() => void) | null = null
  let detachResizeGuard: (() => void) | null = null
  let detachLifecycle: (() => void) | null = null
  const show = (): void => {
    detachFocusout?.()
    detachFocusout = null
    detachResizeGuard?.()
    detachResizeGuard = null
    detachLifecycle?.()
    detachLifecycle = null
    pane.closest(".oneday-slot")?.classList.remove("is-editing")
    pane.empty()
    if (text.trim() === "") {
      pane.createDiv({ cls: "oneday-text-placeholder", text: t("clickToWrite") })
    } else {
      // MarkdownRenderer only supplies the rendered children. Obsidian's own
      // typography (notably <hr>) is scoped by the markdown-rendered host
      // class, so keep that semantic wrapper instead of restyling individual
      // Markdown nodes with a parallel Oneday theme.
      const host = pane.createDiv({ cls: "oneday-text-host markdown-rendered" })
      deps.renderMarkdown(host, text)
    }
  }
  const edit = (draft: TextDraftState | null = null, focus = true, caretAtEnd = false): void => {
    // Entering edit mode replaces the rendered Markdown tree. Capture the
    // actual visible owner before that replacement; otherwise CodeMirror or
    // the browser may reveal the newly focused textarea at scrollTop=0.
    const viewportAnchor = captureViewportAnchor(pane)
    const paneScrollTop = pane.scrollTop
    const paneScrollLeft = pane.scrollLeft
    pane.empty()
    pane.closest(".oneday-slot")?.classList.add("is-editing")
    const ta = pane.createEl("textarea", { cls: "oneday-text-inline" })
    ta.value = draft?.value ?? text
    const paneStyle = domWindow?.getComputedStyle(pane)
    const paneVerticalPadding = Number.parseFloat(paneStyle?.paddingTop ?? "0")
      + Number.parseFloat(paneStyle?.paddingBottom ?? "0")
    const editorFloor = Math.max(0, pane.clientHeight - paneVerticalPadding)
    ta.style.minHeight = `${editorFloor}px`
    const publishDraft = (shouldFocus = dom.activeElement === ta): void => {
      deps.onDraftChange?.({ value: ta.value, editing: true, shouldFocus })
    }
    const slot = pane.closest<HTMLElement>(".oneday-slot")
    let resizing = false
    const onResizeStart = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (target?.closest(".oneday-handle")) resizing = true
    }
    const onResizeEnd = (): void => {
      if (!resizing) return
      resizing = false
      if (ta.isConnected) ta.focus({ preventScroll: true })
    }
    slot?.addEventListener("pointerdown", onResizeStart, true)
    dom.addEventListener("pointerup", onResizeEnd, true)
    dom.addEventListener("pointercancel", onResizeEnd, true)
    detachResizeGuard = () => {
      slot?.removeEventListener("pointerdown", onResizeStart, true)
      dom.removeEventListener("pointerup", onResizeEnd, true)
      dom.removeEventListener("pointercancel", onResizeEnd, true)
    }
    const fit = (): void => {
      const scroller = pane
      const scrollTop = scroller.scrollTop
      const oldMax = scroller.scrollHeight - scroller.clientHeight
      const wasAtBottom = scrollTop >= oldMax - 2
      ta.style.height = "0px"
      ta.style.height = `${Math.max(editorFloor, ta.scrollHeight)}px`
      // Measuring via 0px briefly collapses the overflow content and the browser
      // clamps its parent scrollTop to 0. Restore the user's viewport immediately;
      // when editing at the end, follow the newly grown bottom instead.
      scroller.scrollTop = wasAtBottom
        ? scroller.scrollHeight - scroller.clientHeight
        : scrollTop
    }
    ta.addEventListener("input", () => {
      fit()
      publishDraft()
    })
    fit() // 同步定高：setTimeout 会先画一帧默认高度，产生闪烁（yyt 2026-08-19）
    publishDraft(focus)
    let finished = false
    let committing = false
    let commitPromise: Promise<void> | null = null
    const commit = (): Promise<void> => {
      if (finished) return Promise.resolve()
      if (commitPromise) return commitPromise
      if (ta.value === text) {
        finished = true
        deps.onDraftChange?.(null)
        show() // 没变就不写回，避免无谓重渲染
        return Promise.resolve()
      }
      committing = true
      const submitted = ta.value
      const running = Promise.resolve().then(() => deps.onSave(submitted)).then(() => {
        text = submitted
        // 输入极快时，保存进行中可能又出现新字符；继续提交最新值，不能
        // 因为前一笔已经成功就把后来的字符视为已保存。
        if (ta.value !== submitted) {
          committing = false
          commitPromise = null
          publishDraft()
          return commit()
        }
        finished = true
        deps.onDraftChange?.(null)
        detachFocusout?.()
        detachFocusout = null
        detachResizeGuard?.()
        detachResizeGuard = null
        detachLifecycle?.()
        detachLifecycle = null
        if (pane.isConnected) show()
      }).catch((error: unknown) => {
        committing = false
        commitPromise = null
        publishDraft(dom.hasFocus())
        // The plugin-owned draft survives even if this renderer is replaced.
        console.error("Oneday: failed to save inline text; draft kept in editor", error)
        if (ta.isConnected && dom.hasFocus()) ta.focus({ preventScroll: true })
      })
      commitPromise = running
      return running
    }
    // 容器级 focusout（专家方案）：焦点离开整个文字区才提交
    const onFocusout = (): void => {
      publishDraft(false)
      domWindow?.setTimeout(() => {
        if (!resizing && pane.querySelector("textarea") && !pane.contains(dom.activeElement)) {
          void commit()
        }
      }, 0)
    }
    pane.addEventListener("focusout", onFocusout)
    detachFocusout = () => pane.removeEventListener("focusout", onFocusout)
    // macOS 切到另一应用时，textarea 可能仍是 document.activeElement，因而
    // 不产生 focusout。窗口隐藏、页面卸载和组件重绘也都必须先提交草稿。
    const onWindowBlur = (): void => {
      publishDraft(false)
      void commit()
    }
    const onVisibilityChange = (): void => {
      if (dom.visibilityState === "hidden") {
        publishDraft(false)
        void commit()
      }
    }
    const onPageHide = (): void => { void commit() }
    const onForcedFlush = (event: Event): void => {
      const promise = commit()
      ;(event as TextEditorFlushEvent).waitUntil?.(promise)
    }
    domWindow?.addEventListener("blur", onWindowBlur)
    domWindow?.addEventListener("pagehide", onPageHide)
    dom.addEventListener("visibilitychange", onVisibilityChange)
    pane.addEventListener(TEXT_EDITOR_FLUSH_EVENT, onForcedFlush)
    detachLifecycle = () => {
      domWindow?.removeEventListener("blur", onWindowBlur)
      domWindow?.removeEventListener("pagehide", onPageHide)
      dom.removeEventListener("visibilitychange", onVisibilityChange)
      pane.removeEventListener(TEXT_EDITOR_FLUSH_EVENT, onForcedFlush)
    }
    ta.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void commit()
      } else if (e.key === "Escape") {
        finished = true
        deps.onDraftChange?.(null)
        show()
      }
    })
    // Restore the text pane before focus, then keep the owning page viewport
    // visually fixed through the next two layout frames. A click in the blank
    // area below rendered text means "continue writing", so place the caret at
    // the end rather than letting the browser reveal offset zero.
    pane.scrollTop = paneScrollTop
    pane.scrollLeft = paneScrollLeft
    if (caretAtEnd) ta.setSelectionRange(ta.value.length, ta.value.length)
    if (focus) ta.focus({ preventScroll: true })
    stabilizeViewportAnchor(viewportAnchor, pane, 2)
  }
  // 文字内容通常比槽位矮；编辑入口必须覆盖整个文字面板，而不只是字形本身。
  // 编辑态和链接/控件点击保持原行为，避免 textarea 被点击时重新创建。
  pane.addEventListener("click", (e: MouseEvent) => {
    if (pane.querySelector("textarea")) return
    const target = e.target as Element | null
    if (target?.closest("a, button, input, textarea")) return
    const host = pane.querySelector<HTMLElement>(".oneday-text-host")
    const caretAtEnd = host === null || e.clientY > host.getBoundingClientRect().bottom
    edit(null, true, caretAtEnd)
  })
  show()
  if (deps.initialDraft?.editing) edit(deps.initialDraft, deps.initialDraft.shouldFocus)
}

/**
 * Keep the SVG's annotation lane inside the scroll pane's content width. The
 * track keeps its authored width; only the `.oneday-side-lane` group and the
 * SVG frame are swapped, so interaction-owned nodes (range buttons, edit
 * edges, ghosts) and the track node survive a slot resize. Runs once the pane
 * has a measurable box and again whenever it resizes.
 */
function attachSideLaneFit(
  svgHolder: HTMLElement,
  doc: TimelineDoc,
  opts: RenderOptions,
  baseWidth: number,
): void {
  const dom = svgHolder.ownerDocument
  const domWindow = dom.defaultView
  const fit = (): void => {
    const live = svgHolder.querySelector<SVGSVGElement>("svg.oneday-svg")
    if (!live) return
    const available = svgHolder.clientWidth
    if (available <= 0) return
    const lane = fitSideLaneWidth(available, baseWidth)
    if (live.getAttribute("data-side-lane") === String(lane)) return
    const staging = dom.createElement("div")
    staging.innerHTML = renderTimelineSvg(doc, { ...opts, width: baseWidth, sideLaneWidth: lane })
    const next = staging.querySelector<SVGSVGElement>("svg.oneday-svg")
    const nextLane = next?.querySelector("g.oneday-side-lane")
    const liveLane = live.querySelector("g.oneday-side-lane")
    if (!next || !nextLane || !liveLane) return
    for (const name of ["width", "height", "viewBox", "data-side-lane"]) {
      const value = next.getAttribute(name)
      if (value === null) live.removeAttribute(name)
      else live.setAttribute(name, value)
    }
    liveLane.replaceWith(nextLane.cloneNode(true))
    // Edit/focus visuals classify lane nodes by data-line; let the owning
    // interaction rebuild that state on the fresh group.
    live.dispatchEvent(new (domWindow?.CustomEvent ?? CustomEvent)("oneday-sync-edit-visual"))
  }
  fit()
  const ResizeObserverCtor = domWindow?.ResizeObserver
  if (!ResizeObserverCtor) return
  const observer = new ResizeObserverCtor(() => {
    if (!svgHolder.isConnected) {
      observer.disconnect()
      return
    }
    fit()
  })
  observer.observe(svgHolder)
}

/**
 * Measure note copy with the host's real font so wrapping matches what the
 * SVG paints. The probe resolves the theme's `--oneday-font-svg-label`
 * (custom properties are not resolved by getComputedStyle) and the inherited
 * family; without a canvas or a laid-out probe the builder's estimate wins.
 */
function createNoteMeasurer(container: HTMLElement): TextMeasurer | undefined {
  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  if (!domWindow) return undefined
  const canvas = dom.createElement("canvas")
  const context = canvas.getContext?.("2d")
  if (!context) return undefined
  const probe = container.createEl("span", { cls: "oneday-note-measure-probe" })
  const style = domWindow.getComputedStyle(probe)
  const fontPx = Number.parseFloat(style.fontSize)
  const family = style.fontFamily
  probe.remove()
  if (!Number.isFinite(fontPx) || fontPx <= 0 || !family) return undefined
  context.font = `${fontPx}px ${family}`
  return (text) => context.measureText(text).width
}

export function renderTimelineInto(
  el: HTMLElement,
  doc: TimelineDoc,
  opts: TimelineViewOptions,
  textPane?: TextPaneDeps
): HTMLElement {
  const container = el.createDiv({ cls: "oneday-container" })
  const domWindow = container.ownerDocument.defaultView
  const measureNote = opts.measureNote ?? createNoteMeasurer(container)
  if (measureNote) opts = { ...opts, measureNote }

  const baseWidth = doc.width ?? opts.width ?? 200
  const texts = doc.texts ?? []
  const hasText = textPane !== undefined && texts.length > 0
  const blockScroll = container.createDiv({ cls: "oneday-block-scroll" })
  const body = blockScroll.createDiv({ cls: "oneday-body is-settling" })
  if (doc.canvasWidth !== undefined) body.dataset.gridBaseWidth = String(doc.canvasWidth)

  // 网格布局（yyt 2026-08-17：组件手柄拖拽移动+缩放、自动吸附+重力压实）：
  // 12 列 x 20px 行，组件几何存 dataset，交互由 main 接 attachGridInteract
  // 时间轴默认行数取 SVG 实际高度（含标注车道撑高）加上顶栏/状态行等固定
  // 外壳，避免底部最后一两个小时被 .oneday-svg-holder 的内部滚动吞掉
  const timelineSvg = renderTimelineSvg(doc, { ...opts, width: baseWidth })
  const svgHeight = Number(/<svg[^>]*height="([\d.]+)"/.exec(timelineSvg)?.[1] ?? 800)
  const timelineRows = Math.ceil((svgHeight + TIMELINE_SLOT_CHROME_H) / GRID_ROW_H)
  const stats = statsByType(doc.entries)
  const emptyStatsRows = stats.length === 0 && doc.errors.length === 0 ? 2 : 1
  const pristine = texts.length === 0 && doc.entries.length === 0 && doc.annotations.length === 0 && doc.errors.length === 0
  const items = resolveGrid(
    doc.layout ?? null,
    texts.length,
    doc.side,
    timelineRows,
    doc.hiddenSlots,
    emptyStatsRows,
    pristine,
    opts.extraSlots ?? []
  )
  body.style.height = `${gridRows(items) * GRID_ROW_H}px`
  for (const it of items) {
    const slot = body.createDiv({ cls: `oneday-slot oneday-slot-${it.id}` })
    slot.dataset.slot = it.id
    slot.dataset.x = String(it.x)
    slot.dataset.y = String(it.y)
    slot.dataset.w = String(it.w)
    slot.dataset.h = String(it.h)
    if (it.id === "timeline") {
      const svgHolder = slot.createDiv({ cls: "oneday-svg-holder" })
      svgHolder.innerHTML = timelineSvg
      attachSideLaneFit(svgHolder, doc, opts, baseWidth)
      const noCategories = Object.keys(opts.typeColors).length === 0
        && Object.keys(opts.markerTypeColors ?? {}).length === 0
      if (noCategories && doc.entries.length === 0 && doc.annotations.length === 0 && doc.errors.length === 0) {
        // Same visual family as the Stats empty state (dashed, faint copy),
        // sized to the real track so it reads as "this track is waiting".
        const empty = svgHolder.createEl("button", { cls: "oneday-timeline-empty", attr: { type: "button" } })
        empty.setAttribute("aria-label", t("addFirstCategory"))
        empty.createEl("span", { cls: "oneday-timeline-empty-title", text: t("addFirstCategory") })
        empty.createEl("span", { cls: "oneday-timeline-empty-copy", text: t("timelineNeedsCategory") })
        const track = svgHolder.querySelector<SVGRectElement>("rect.oneday-track")
        const trackX = Number(track?.getAttribute("x"))
        const trackY = Number(track?.getAttribute("y"))
        const trackW = Number(track?.getAttribute("width"))
        const trackH = Number(track?.getAttribute("height"))
        if ([trackX, trackY, trackW, trackH].every(Number.isFinite)) {
          const inset = 8
          const height = Math.min(64, Math.max(40, trackH - inset * 2))
          empty.style.left = `${trackX + inset}px`
          empty.style.top = `${trackY + Math.max(inset, (trackH - height) / 2)}px`
          empty.style.width = `${Math.max(1, trackW - inset * 2)}px`
          empty.style.height = `${height}px`
        }
        empty.addEventListener("click", (event) => {
          event.stopPropagation()
          opts.onAddFirstCategory?.()
        })
      }
      if (
        opts.showTimelineOnboarding
        && (Object.keys(opts.typeColors).length > 0 || Object.keys(opts.markerTypeColors ?? {}).length > 0)
        && doc.entries.length === 0
        && doc.annotations.length === 0
        && doc.errors.length === 0
      ) {
        const guide = svgHolder.createDiv({ cls: "oneday-timeline-onboarding" })
        guide.setAttribute("role", "note")
        // 引导严格收在真实轨道内；它演示“从一点拖到另一点”的手势，
        // 不伪装成已经创建好的色块，也不成为常驻空状态。
        const track = svgHolder.querySelector<SVGRectElement>("rect.oneday-track")
        const trackX = Number(track?.getAttribute("x"))
        const trackY = Number(track?.getAttribute("y"))
        const trackW = Number(track?.getAttribute("width"))
        const trackH = Number(track?.getAttribute("height"))
        const hourHeight = opts.hourHeight ?? 48
        if ([trackX, trackY, trackW, trackH].every(Number.isFinite)) {
          const inset = 8
          const guideH = Math.min(Math.max(72, hourHeight * 2), Math.max(56, trackH - inset * 2))
          const preferredTop = trackY + hourHeight
          const guideTop = Math.min(preferredTop, trackY + trackH - guideH - inset)
          guide.style.left = `${trackX + inset}px`
          guide.style.top = `${Math.max(trackY + inset, guideTop)}px`
          guide.style.width = `${Math.max(1, trackW - inset * 2)}px`
          guide.style.height = `${guideH}px`
        }
        const gesture = guide.createDiv({ cls: "oneday-timeline-onboarding-gesture" })
        gesture.setAttribute("aria-hidden", "true")
        gesture.createEl("span", { cls: "oneday-timeline-onboarding-dot is-start" })
        gesture.createEl("span", { cls: "oneday-timeline-onboarding-line" })
        gesture.createEl("span", { cls: "oneday-timeline-onboarding-dot is-end" })
        gesture.createEl("span", { cls: "oneday-timeline-onboarding-label is-start", text: t("start") })
        gesture.createEl("span", { cls: "oneday-timeline-onboarding-label is-end", text: t("end") })
        guide.createEl("span", { cls: "oneday-timeline-onboarding-copy", text: t("dragStartToEnd") })
      }
    } else if (isTextSlot(it.id) && textPane) {
      const idx = it.id === "text" ? 0 : Number(it.id.slice(4)) - 1
      const pane = slot.createDiv({ cls: "oneday-text-pane" })
      attachInlineTextEditor(pane, texts[idx] ?? "", {
        renderMarkdown: (host, text) => textPane.renderMarkdown(host, text),
        onSave: (text) => textPane.onSave(idx, text),
        initialDraft: textPane.getDraft?.(idx) ?? null,
        onDraftChange: (draft) => textPane.onDraftChange?.(idx, draft),
      })
    }
  }
  applyGridToBody(body, items)
  // 宽度/浮动必须设在宿主 el 上：Obsidian 的代码块宿主默认通栏，
  // 子元素浮动不会让出左侧空间（yyt 2026-08-17 反馈）。
  // 在 callout（> [!x|right]）内时浮动由 callout 主导（Live Preview 唯一可行路径），
  // 我们只提供内容宽度，callout shrink-to-fit。
  const inCallout = el.closest(".callout") !== null
  // Live Preview（CM6）里 float 无法环绕文字，只会把块推右留空洞——禁用
  const inLivePreview = el.closest(".cm-editor") !== null
  // 宿主恒 100%：时间轴 SVG 随槽位响应式重渲染，宽度由网格手柄调（yyt 2026-08-17）
  const useFloat = Boolean(doc.floatRight) && !inCallout && !inLivePreview
  el.style.width = useFloat ? `${baseWidth + SIDE_LANE_W}px` : "100%"
  el.classList.add("oneday-host")
  el.classList.toggle("oneday-host-float", useFloat)

  const statsSlot = container.querySelector<HTMLElement>(".oneday-slot-stats") // 被 off: 隐藏时不兜底渲染
  statsSlot?.classList.toggle("is-empty-state", stats.length === 0 && doc.errors.length === 0)
  if (stats.length > 0 && statsSlot) {
    // 每行一个类型 + 荧光笔色点（yyt 2026-08-17）
    const box = (statsSlot as HTMLElement).createDiv({ cls: "oneday-stats" })
    const maxMin = Math.max(...stats.map((st) => st.minutes), 1)
    for (const st of stats) {
      const row = box.createDiv({ cls: "oneday-stat-row" })
      row.createEl("span", { cls: "oneday-stat-type", text: st.type })
      const barWrap = row.createDiv({ cls: "oneday-stat-bar-wrap" })
      const color = opts.typeColors[st.type] ?? hashTypeColor(st.type)
      const pct = Math.max(3, (st.minutes / maxMin) * 100)
      const bar = barWrap.createDiv({ cls: "oneday-stat-bar" })
      bar.style.background = color
      bar.style.width = `${pct}%`
      // 先放柱内，挂载后实测：装不下就挪柱外（百分比阈值对不上像素，yyt 2026-08-19）
      const label = bar.createEl("span", { cls: "oneday-stat-hours", text: formatHours(st.minutes) })
      const insideColor = relatedTextColor(color)
      label.style.color = insideColor
      // 实测要在最终布局上做，而且要能双向迁移：字体回退、槽位缩放都会改变
      // 柱宽（Linux 上字体度量与 macOS 不同，一次 rAF 不够）。
      const placeLabel = (): void => {
        const isOut = label.classList.contains("oneday-stat-hours-out")
        // 外置后柱子会为标签让位而变窄；判断“能否回柱内”要用柱子在轨道里的
        // 名义宽度（百分比 × 轨道宽），而不是让位后的实际宽度。
        const insideWidth = isOut ? (barWrap.clientWidth * pct) / 100 : bar.clientWidth
        const fits = label.offsetWidth + 10 <= insideWidth
        if (!isOut && !fits) {
          label.classList.add("oneday-stat-hours-out")
          label.style.color = ""
          barWrap.classList.add("is-label-out")
          barWrap.appendChild(label)
        } else if (isOut && fits) {
          label.classList.remove("oneday-stat-hours-out")
          label.style.color = insideColor
          barWrap.classList.remove("is-label-out")
          bar.appendChild(label)
        }
      }
      domWindow?.requestAnimationFrame(placeLabel)
      const ResizeObserverCtor = domWindow?.ResizeObserver
      if (ResizeObserverCtor) {
        const observer = new ResizeObserverCtor(() => {
          if (!barWrap.isConnected) {
            observer.disconnect()
            return
          }
          placeLabel()
        })
        observer.observe(barWrap)
      }
    }
  } else if (statsSlot && doc.errors.length === 0) {
    const empty = statsSlot.createDiv({ cls: "oneday-stats-empty" })
    empty.setAttribute("role", "note")
    empty.createEl("span", {
      cls: "oneday-stats-empty-label",
      text: t("statsEmpty"),
    })
  }

  if (doc.errors.length > 0 && statsSlot) {
    const box = (statsSlot as HTMLElement).createDiv({ cls: "oneday-errors" })
    for (const err of doc.errors) {
      box.createDiv({
        text: t("lineError", {
          line: err.line + 1,
          reason: err.reason,
          detail: err.text ? t("errorDetail", { text: err.text.trim() }) : "",
        }),
      })
    }
  }

  return container
}

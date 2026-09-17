/**
 * Highlighter toolbar (荧光笔) + plan/record mode toggle + per-block
 * hide/show management (yyt 2026-08-17: 全局色号，块内可隐藏/显示).
 * Pure DOM so it runs in Obsidian and Playwright smoke.
 */

import { labelCustomMenu, showCustomMenu } from "./custom-menu"
import { t } from "../i18n"
import { attachRowCompaction, CREATION_ROW_COMPACTION } from "./row-compaction"
import type { TimelineDrawTool } from "../core/types"

export type DrawMode = "actual" | "plan"

export interface ToolbarDeps {
  /** Global palette (all configured types -> color). */
  typeColors: Record<string, string>
  /** Independent point-category palette. Defaults to the span palette for old callers. */
  markerTypeColors?: Record<string, string>
  /** Types hidden in this block (hide: header). */
  hiddenTypes: string[]
  markerHiddenTypes?: string[]
  activeType: string
  activeMarkerType?: string
  /** 荧光笔模式（画记录/画计划） */
  brushMode: DrawMode
  /** Duration block or point-in-time marker. Defaults to span for old callers. */
  drawTool?: TimelineDrawTool
  onDrawToolChange?: (tool: TimelineDrawTool) => void
  onBrushModeChange: (mode: DrawMode) => void
  onSelect: (type: string) => void
  /** Menu item: hide this swatch for this block. */
  onHide: (type: string) => void
  /** Tail management menu picks a hidden type to show again. */
  onShow: (type: string) => void
  /** Open the global palette settings to create another highlighter. */
  onAddNew: () => void
  /**
   * Folding is opt-in (yyt 2026-09-09): every category shows by default; the
   * user may collapse the list to MAX_CATEGORY_ROWS rows and the choice is
   * remembered globally by the host.
   */
  categoriesCollapsed?: boolean
  onCategoriesCollapsedChange?: (collapsed: boolean) => void
  /** DOM realm that owns this toolbar (Obsidian pop-out safe). */
  domDocument?: Document
}

export interface ToolbarHandle {
  el: HTMLElement
  statusEl: HTMLElement
  /** 外部同步荧光笔模式视觉（视图联动时调用，专家：状态所有权必须一致） */
  setBrushMode: (mode: DrawMode) => void
  setDrawTool: (tool: TimelineDrawTool) => void
  /**
   * Re-run width-dependent layout (row compaction, category folding) now.
   * Hosts that size slots synchronously after mounting call this first so
   * the slot is measured against the folded toolbar, not the unfolded one.
   */
  layout: () => void
}

/** Categories beyond this many rows fold into a "More" menu (P2-18). */
export const MAX_CATEGORY_ROWS = 2

const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
const CHEVRON_UP_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
const PLUS_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'

/** Right-click menu on a swatch, anchored to the swatch itself. */
function showSwatchMenu(anchor: HTMLElement, type: string, deps: ToolbarDeps): void {
  const dom = anchor.ownerDocument
  const menu = dom.createElement("div")
  menu.className = "modular-diary-ctx-menu"
  menu.setAttribute("role", "menu")
  // Obsidian turns aria-label on hovered surfaces into a visual tooltip.
  // aria-labelledby keeps the accessible name without duplicating the menu as a black bubble.
  labelCustomMenu(menu, t("categoryActions", { name: type }), dom)
  const hide = dom.createElement("button")
  hide.type = "button"
  hide.className = "modular-diary-add-item"
  hide.setAttribute("role", "menuitem")
  hide.textContent = t("hide")
  let close = (): void => {}
  hide.addEventListener("click", () => {
    close()
    deps.onHide(type)
  })
  menu.appendChild(hide)
  close = showCustomMenu(menu, { anchor })
}

export function buildToolbar(deps: ToolbarDeps): ToolbarHandle {
  const dom = deps.domDocument ?? document
  const el = dom.createElement("div")
  el.className = "modular-diary-toolbar"
  el.setAttribute("role", "toolbar")
  el.setAttribute("aria-label", t("categoryToolbar"))

  const statusEl = dom.createElement("div")
  statusEl.className = "modular-diary-draw-status"
  statusEl.setAttribute("role", "status")
  statusEl.setAttribute("aria-live", "polite")

  let currentBrushMode: DrawMode = deps.brushMode
  let currentDrawTool: TimelineDrawTool = deps.drawTool ?? "span"
  const colorsByTool = { span: deps.typeColors, marker: deps.markerTypeColors ?? deps.typeColors }
  const hiddenByTool = { span: deps.hiddenTypes, marker: deps.markerHiddenTypes ?? deps.hiddenTypes }
  const activeByTool = { span: deps.activeType, marker: deps.activeMarkerType ?? deps.activeType }

  const syncCategoryMark = (mark: HTMLElement): void => {
    const marker = currentDrawTool === "marker"
    const plan = currentBrushMode === "plan"
    mark.classList.toggle("is-marker", marker)
    mark.classList.toggle("is-plan", plan)
    mark.dataset.tool = currentDrawTool
    mark.dataset.mode = currentBrushMode
  }

  const createCategoryMark = (type: string): HTMLElement => {
    const mark = dom.createElement("span")
    mark.setAttribute("aria-hidden", "true")
    mark.className = "modular-diary-swatch-dot"
    mark.style.setProperty("--c", colorsByTool[currentDrawTool][type])
    syncCategoryMark(mark)
    return mark
  }

  const syncCategoryMarks = (): void => {
    el.querySelectorAll<HTMLElement>(".modular-diary-swatch-dot").forEach(syncCategoryMark)
  }

  const syncToolbarSemanticState = (): void => {
    el.classList.toggle("is-plan", currentBrushMode === "plan")
    el.classList.toggle("is-marker-tool", currentDrawTool === "marker")
    el.dataset.mode = currentBrushMode
    el.dataset.tool = currentDrawTool
  }
  syncToolbarSemanticState()

  // 创建工具优先：先选几何（时间段/时间点），计划只是一个次级修饰模式。
  el.classList.add("has-category-rows")
  const creationControls = dom.createElement("div")
  creationControls.className = "modular-diary-creation-controls"
  const categoryList = dom.createElement("div")
  categoryList.className = "modular-diary-category-list"
  el.append(creationControls, categoryList)

  const brushLabel = dom.createElement("span")
  brushLabel.className = "modular-diary-component-title modular-diary-creation-title"
  brushLabel.textContent = t("addToTimeline")
  creationControls.appendChild(brushLabel)

  const toolWrap = dom.createElement("span")
  toolWrap.className = "modular-diary-mode modular-diary-tool-toggle"
  toolWrap.setAttribute("role", "group")
  toolWrap.setAttribute("aria-label", t("drawTool"))
  const initialTool = currentDrawTool
  for (const [tool, label] of [["span", t("spanTool")], ["marker", t("markerTool")]] as Array<[TimelineDrawTool, string]>) {
    const btn = dom.createElement("button")
    btn.type = "button"
    btn.className = "modular-diary-mode-btn" + (tool === initialTool ? " is-active" : "")
    btn.dataset.tool = tool
    const symbol = dom.createElement("span")
    symbol.className = `modular-diary-tool-symbol is-${tool}`
    symbol.setAttribute("aria-hidden", "true")
    const copy = dom.createElement("span")
    copy.className = "modular-diary-tool-copy"
    copy.textContent = label
    btn.append(symbol, copy)
    btn.setAttribute("aria-label", t("selectDrawTool", { name: label }))
    btn.setAttribute("aria-pressed", String(tool === initialTool))
    btn.addEventListener("click", () => {
      toolWrap.querySelectorAll<HTMLButtonElement>(".modular-diary-mode-btn").forEach((candidate) => {
        const active = candidate === btn
        candidate.classList.toggle("is-active", active)
        candidate.setAttribute("aria-pressed", String(active))
      })
      currentDrawTool = tool
      syncToolbarSemanticState()
      syncCategoryMarks()
      renderCategoryList()
      deps.onDrawToolChange?.(tool)
    })
    toolWrap.appendChild(btn)
  }
  creationControls.appendChild(toolWrap)

  const planGroup = dom.createElement("span")
  planGroup.className = "modular-diary-plan-mode-group"
  creationControls.appendChild(planGroup)

  const planToggle = dom.createElement("button")
  planToggle.type = "button"
  planToggle.className = "modular-diary-plan-mode-toggle modular-diary-brush-toggle"
  planToggle.setAttribute("role", "switch")
  planToggle.setAttribute("aria-label", t("planMode"))
  const planTrack = dom.createElement("span")
  planTrack.className = "modular-diary-plan-mode-track"
  planTrack.setAttribute("aria-hidden", "true")
  const planThumb = dom.createElement("span")
  planThumb.className = "modular-diary-plan-mode-thumb"
  planTrack.appendChild(planThumb)
  const planLabel = dom.createElement("span")
  planLabel.className = "modular-diary-plan-mode-label"
  planLabel.textContent = t("planMode")
  planToggle.append(planTrack, planLabel)

  const syncPlanModeControl = (): void => {
    const plan = currentBrushMode === "plan"
    planToggle.classList.toggle("is-plan", plan)
    planToggle.setAttribute("aria-checked", String(plan))
  }
  syncPlanModeControl()
  planToggle.addEventListener("click", () => {
    currentBrushMode = currentBrushMode === "plan" ? "actual" : "plan"
    syncPlanModeControl()
    syncToolbarSemanticState()
    syncCategoryMarks()
    deps.onBrushModeChange(currentBrushMode)
  })
  planGroup.appendChild(planToggle)
  // The first row never wraps and categories never rise into it; when the
  // pane is too narrow for the copy, tools and then Plan mode go icon-only.
  const creationCompaction = attachRowCompaction(creationControls, CREATION_ROW_COMPACTION)

  const renderCategoryList = (): void => {
    categoryList.replaceChildren()
    const colors = colorsByTool[currentDrawTool]
    const hiddenTypes = hiddenByTool[currentDrawTool]
    const activeType = activeByTool[currentDrawTool]
    const configured = Object.keys(colors)
    el.classList.toggle("is-empty", configured.length === 0)
    if (configured.length === 0) {
      const emptyButton = dom.createElement("button")
      emptyButton.type = "button"
      emptyButton.className = "modular-diary-toolbar-empty"
      emptyButton.setAttribute("aria-label", t("addFirstCategory"))
      const icon = dom.createElement("span")
      icon.className = "modular-diary-toolbar-empty-icon"
      icon.setAttribute("aria-hidden", "true")
      icon.innerHTML = PLUS_SVG
      const copy = dom.createElement("span")
      copy.className = "modular-diary-toolbar-empty-label"
      copy.textContent = t("addFirstCategory")
      emptyButton.append(icon, copy)
      emptyButton.addEventListener("click", (event) => { event.stopPropagation(); deps.onAddNew() })
      categoryList.appendChild(emptyButton)
      return
    }

    const visible = configured.filter((type) => !hiddenTypes.includes(type))
    const selectCategory = (type: string): void => {
      el.querySelectorAll<HTMLButtonElement>(".modular-diary-swatch[data-type]").forEach((b) => {
        const active = b.dataset.type === type
        b.classList.toggle("is-active", active)
        b.setAttribute("aria-pressed", String(active))
      })
      activeByTool[currentDrawTool] = type
      deps.onSelect(type)
      // The active category is always visible: picking one from the More
      // menu swaps it into the visible rows.
      applyCategoryOverflow()
    }
    for (const type of visible) {
    const btn = dom.createElement("button")
    btn.type = "button"
    btn.className = "modular-diary-swatch" + (type === activeType ? " is-active" : "")
    btn.dataset.type = type
    btn.setAttribute("aria-label", t("selectCategory", { name: type }))
    btn.setAttribute("aria-pressed", String(type === activeType))
    const dot = createCategoryMark(type)
    btn.appendChild(dot)
    btn.appendChild(dom.createTextNode(type))
    btn.addEventListener("click", () => selectCategory(type))
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault()
      e.stopPropagation()
      showSwatchMenu(btn, type, deps)
    })
    categoryList.appendChild(btn)
    }

  // Categories beyond MAX_CATEGORY_ROWS fold behind a "More (n)" button that
  // opens the same custom menu the tail "+" uses; every folded category stays
  // reachable by keyboard through that menu.
  const moreBtn = dom.createElement("button")
  moreBtn.type = "button"
  moreBtn.className = "modular-diary-swatch modular-diary-category-more"
  moreBtn.hidden = true
  moreBtn.setAttribute("aria-haspopup", "menu")
  moreBtn.setAttribute("aria-expanded", "false")
  moreBtn.setAttribute("aria-label", t("moreCategoriesMenu"))
  const moreLabel = dom.createElement("span")
  moreLabel.className = "modular-diary-category-more-label"
  const moreIcon = dom.createElement("span")
  moreIcon.className = "modular-diary-category-more-icon"
  moreIcon.setAttribute("aria-hidden", "true")
  moreIcon.innerHTML = CHEVRON_SVG
  moreBtn.append(moreLabel, moreIcon)
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    const folded = visible.filter((type) => categoryList.querySelector(`.modular-diary-swatch[data-type="${CSS.escape(type)}"]`)?.classList.contains("is-overflowed"))
    if (folded.length === 0) return
    const menu = dom.createElement("div")
    menu.className = "modular-diary-add-menu"
    menu.setAttribute("role", "menu")
    labelCustomMenu(menu, t("moreCategoriesMenu"), dom)
    let close = (): void => {}
    for (const type of folded) {
      const item = dom.createElement("button")
      item.type = "button"
      item.className = "modular-diary-add-item"
      item.setAttribute("role", "menuitem")
      item.setAttribute("aria-label", t("selectCategory", { name: type }))
      item.appendChild(createCategoryMark(type))
      item.appendChild(dom.createTextNode(type))
      item.addEventListener("click", () => {
        close()
        selectCategory(type)
      })
      menu.appendChild(item)
    }
    // Same edge-to-edge separator treatment as the manage menu's "add new" row.
    const expandItem = dom.createElement("button")
    expandItem.type = "button"
    expandItem.className = "modular-diary-add-item modular-diary-add-new modular-diary-category-expand"
    expandItem.setAttribute("role", "menuitem")
    expandItem.innerHTML = CHEVRON_SVG
    expandItem.appendChild(dom.createTextNode(t("expandAllCategories")))
    expandItem.addEventListener("click", () => {
      close()
      setCategoriesCollapsed(false)
    })
    menu.appendChild(expandItem)
    moreBtn.setAttribute("aria-expanded", "true")
    close = showCustomMenu(menu, { anchor: moreBtn }, () => moreBtn.setAttribute("aria-expanded", "false"))
    menu.querySelector<HTMLButtonElement>(".modular-diary-add-item")?.focus()
  })
  categoryList.appendChild(moreBtn)

  // Tail "+" is always present: restore hidden swatches or open global palette settings.
  const hidden = hiddenTypes.filter((type) => type in colors)
  const addBtn = dom.createElement("button")
  addBtn.type = "button"
  addBtn.className = "modular-diary-swatch modular-diary-add"
  addBtn.innerHTML = PLUS_SVG
  addBtn.setAttribute("aria-label", hidden.length > 0 ? t("manageCategories") : t("addCategory"))
  if (hidden.length > 0) {
    addBtn.setAttribute("aria-haspopup", "menu")
    addBtn.setAttribute("aria-expanded", "false")
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      const menu = dom.createElement("div")
      menu.className = "modular-diary-add-menu"
      menu.setAttribute("role", "menu")
      labelCustomMenu(menu, t("manageCategories"), dom)
      let close = (): void => {}
      for (const type of hidden) {
        const item = dom.createElement("button")
        item.type = "button"
        item.className = "modular-diary-add-item"
        item.setAttribute("role", "menuitem")
        const dot = createCategoryMark(type)
        item.appendChild(dot)
        item.appendChild(dom.createTextNode(type))
        item.addEventListener("click", () => {
          close()
          deps.onShow(type)
        })
        menu.appendChild(item)
      }
      const addNew = dom.createElement("button")
      addNew.type = "button"
      addNew.className = "modular-diary-add-item modular-diary-add-new"
      addNew.setAttribute("role", "menuitem")
      const icon = dom.createElement("span")
      icon.className = "modular-diary-menu-icon"
      icon.setAttribute("aria-hidden", "true")
      icon.innerHTML = PLUS_SVG
      addNew.append(icon, dom.createTextNode(`${t("addCategory")}…`))
      addNew.addEventListener("click", () => {
        close()
        deps.onAddNew()
      })
      menu.appendChild(addNew)
      addBtn.setAttribute("aria-expanded", "true")
      close = showCustomMenu(menu, { anchor: addBtn }, () => addBtn.setAttribute("aria-expanded", "false"))
    })
  } else {
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      deps.onAddNew()
    })
  }
    categoryList.appendChild(addBtn)

  // Opt-in fold: shown only while the expanded list runs past MAX_CATEGORY_ROWS.
  const foldBtn = dom.createElement("button")
  foldBtn.type = "button"
  foldBtn.className = "modular-diary-swatch modular-diary-category-fold"
  foldBtn.hidden = true
  foldBtn.innerHTML = CHEVRON_UP_SVG
  foldBtn.setAttribute("aria-label", t("collapseCategories"))
  foldBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    setCategoriesCollapsed(true)
  })
  categoryList.appendChild(foldBtn)
    applyCategoryOverflow()
  }

  /**
   * Fold trailing categories until the list fits MAX_CATEGORY_ROWS rows.
   * The active category is never folded, so the visible set is the leading
   * categories plus the active one; "More (n)" reports what is folded.
   */
  let categoriesCollapsed = deps.categoriesCollapsed ?? false
  const setCategoriesCollapsed = (collapsed: boolean): void => {
    if (categoriesCollapsed === collapsed) return
    categoriesCollapsed = collapsed
    deps.onCategoriesCollapsedChange?.(collapsed)
    applyCategoryOverflow()
  }
  const applyCategoryOverflow = (): void => {
    const swatches = Array.from(categoryList.querySelectorAll<HTMLButtonElement>(".modular-diary-swatch[data-type]"))
    const moreBtn = categoryList.querySelector<HTMLButtonElement>(".modular-diary-category-more")
    const foldBtn = categoryList.querySelector<HTMLButtonElement>(".modular-diary-category-fold")
    for (const swatch of swatches) swatch.classList.remove("is-overflowed")
    if (moreBtn) moreBtn.hidden = true
    if (foldBtn) foldBtn.hidden = true
    categoryList.dataset.foldedCategories = "0"
    categoryList.dataset.categoriesCollapsed = categoriesCollapsed ? "1" : "0"
    if (!moreBtn || swatches.length === 0 || categoryList.clientWidth === 0) return
    const rowCount = (): number => {
      const tops = new Set<number>()
      for (const child of Array.from(categoryList.children) as HTMLElement[]) {
        if (child.hidden || child.classList.contains("is-overflowed")) continue
        tops.add(child.offsetTop)
      }
      return tops.size
    }
    if (rowCount() <= MAX_CATEGORY_ROWS) return
    if (!categoriesCollapsed) {
      // Expanded by default: only offer the fold, never force it.
      if (foldBtn) foldBtn.hidden = false
      return
    }
    moreBtn.hidden = false
    let folded = 0
    for (let index = swatches.length - 1; index >= 0 && rowCount() > MAX_CATEGORY_ROWS; index -= 1) {
      const swatch = swatches[index]
      if (swatch.classList.contains("is-active")) continue
      swatch.classList.add("is-overflowed")
      folded += 1
    }
    categoryList.dataset.foldedCategories = String(folded)
    const label = moreBtn.querySelector<HTMLElement>(".modular-diary-category-more-label")
    if (label) label.textContent = t("moreCategories", { count: folded })
    moreBtn.setAttribute("aria-label", t("showMoreCategories", { count: folded }))
  }
  renderCategoryList()
  const ResizeObserverCtor = dom.defaultView?.ResizeObserver
  if (ResizeObserverCtor) {
    const observer = new ResizeObserverCtor(() => {
      if (!categoryList.isConnected) {
        observer.disconnect()
        return
      }
      applyCategoryOverflow()
    })
    observer.observe(categoryList)
  }

  const setBrushMode = (mode: DrawMode): void => {
    currentBrushMode = mode
    syncPlanModeControl()
    syncToolbarSemanticState()
    syncCategoryMarks()
  }

  const setDrawTool = (tool: TimelineDrawTool): void => {
    toolWrap.querySelectorAll<HTMLButtonElement>(".modular-diary-mode-btn").forEach((button) => {
      const active = button.dataset.tool === tool
      button.classList.toggle("is-active", active)
      button.setAttribute("aria-pressed", String(active))
    })
    currentDrawTool = tool
    syncToolbarSemanticState()
    syncCategoryMarks()
    renderCategoryList()
  }

  const layout = (): void => {
    creationCompaction.update()
    applyCategoryOverflow()
  }

  return { el, statusEl, setBrushMode, setDrawTool, layout }
}

const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.6A9.5 9.5 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.44 9.44 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/></svg>'

export interface LayerView {
  actual: boolean
  plan: boolean
}

/** 图层开关：记录/计划各自独立点亮，都亮=全部；允许全灭。 */
export function buildLayerToggles(view: LayerView, onChange: (view: LayerView) => void, dom: Document = document): HTMLElement {
  const wrap = dom.createElement("div")
  wrap.className = "modular-diary-mode modular-diary-view-toggle"
  wrap.setAttribute("role", "group")
  wrap.setAttribute("aria-label", t("layerVisibility"))
  const state = { ...view }
  for (const [key, label] of [["actual", t("record")], ["plan", t("plan")]] as Array<["actual" | "plan", string]>) {
    const btn = dom.createElement("button")
    btn.type = "button"
    btn.className = "modular-diary-mode-btn modular-diary-layer-btn" + (state[key] ? " is-active" : "")
    btn.dataset.layer = key
    // 文字 + Lucide eye/eye-off 图标（yyt 2026-08-19：不要 emoji）
    const text = dom.createElement("span")
    text.textContent = label
    const eye = dom.createElement("span")
    eye.setAttribute("aria-hidden", "true")
    eye.className = "modular-diary-eye"
    btn.append(text, eye)
    const syncAria = (on: boolean): void => {
      btn.setAttribute("aria-pressed", String(on))
      btn.setAttribute("aria-label", on ? t("hideLayer", { name: label }) : t("showLayer", { name: label }))
      eye.innerHTML = on ? EYE_OPEN_SVG : EYE_OFF_SVG
    }
    syncAria(state[key])
    btn.addEventListener("click", () => {
      const next = !state[key]
      state[key] = next // 允许全灭（yyt：什么都不显示也是合法状态）
      btn.classList.toggle("is-active", next)
      syncAria(next)
      onChange({ ...state })
    })
    wrap.appendChild(btn)
  }
  return wrap
}

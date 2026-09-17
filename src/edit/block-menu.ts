/**
 * Right-click menu on a block (M3): 改备注 / 改类型 / 删除 / 转规划(实际).
 * Obsidian glue (Menu + Modal); pure logic stays in source-rewriter/format.
 */
import { App, Menu } from "obsidian"
import { Annotation, Entry } from "../core/types"
import { buildTodoMenuOptions, buildTypeMenuOptions } from "./block-menu-model"
import { attachCascadeMenu, CascadeMenuController } from "./cascade-menu"
import { t } from "../i18n"

export interface BlockMenuActions {
  /** 打开备注小浮窗（色块右侧临时编辑框） */
  editNote: (line: number) => void
  setNote: (line: number, note: string) => void
  setType: (line: number, type: string) => void
  remove: (line: number) => void
  togglePlan: (line: number) => void
  /** 进入交互式编辑态（边缘拖拽改起止、中部拖动移动） */
  editSpan: (line: number) => void
  /** 精确起止时间（HH:MM 输入） */
  editTimes: (line: number) => void
  setTodo: (line: number, todoId: string | null) => void
}

export function showBlockMenu(
  app: App,
  entry: Entry,
  types: string[],
  todos: Array<{ id: string; title: string }>,
  x: number,
  y: number,
  actions: BlockMenuActions,
  domDocument: Document = document
): void {
  const menu = new Menu().setUseNativeMenu(false)
  const cascades: CascadeMenuController[] = []

  menu.addItem((item) =>
    item.setTitle(entry.plan ? t("convertToActual") : t("convertToPlan"))
      .setIcon(entry.plan ? "highlighter" : "pencil")
      .onClick(() => actions.togglePlan(entry.line))
  )

  menu.addItem((item) =>
    item.setTitle(t("editSpan"))
      .setIcon("move")
      .onClick(() => actions.editSpan(entry.line))
  )

  menu.addItem((item) =>
    item.setTitle(t("exactTimes"))
      .setIcon("clock")
      .onClick(() => actions.editTimes(entry.line))
  )

  menu.addItem((item) =>
    item.setTitle(entry.note ? t("editNote") : t("addNote"))
      .setIcon("notebook-pen")
      .onClick(() => actions.editNote(entry.line))
  )

  menu.addSeparator()
  if (todos.length > 0 || entry.todoId) {
    menu.addItem((item) => {
      const title = domDocument.createDocumentFragment()
      const content = domDocument.createElement("span")
      content.className = "modular-diary-todo-trigger-content"
      const label = domDocument.createElement("span")
      label.textContent = t("bindTodo")
      const caret = domDocument.createElement("span")
      caret.className = "modular-diary-submenu-caret"
      caret.setAttribute("aria-hidden", "true")
      caret.textContent = "›"
      content.append(label, caret)
      title.appendChild(content)
      item.setTitle(title).setIcon("list-todo")
    })
  }
  menu.addItem((item) => {
    const title = domDocument.createDocumentFragment()
    const content = domDocument.createElement("span")
    content.className = "modular-diary-type-trigger-content"
    const label = domDocument.createElement("span")
    label.textContent = t("changeCategory")
    const caret = domDocument.createElement("span")
    caret.className = "modular-diary-submenu-caret"
    caret.setAttribute("aria-hidden", "true")
    caret.textContent = "›"
    content.append(label, caret)
    title.appendChild(content)
    item.setTitle(title).setIcon("tags")
  })

  menu.addSeparator()
  menu.addItem((item) =>
    item.setTitle(t("deleteBlock")).setIcon("trash").onClick(() => actions.remove(entry.line))
  )

  const existingMenus = new Set(Array.from(domDocument.querySelectorAll(".menu")))
  menu.onHide(() => {
    cascades.forEach((cascade) => cascade.destroy())
    cascades.length = 0
  })
  menu.showAtPosition({ x, y }, domDocument)

  const primaryMenu = Array.from(domDocument.querySelectorAll<HTMLElement>(".menu"))
    .find((candidate) => !existingMenus.has(candidate) && candidate.querySelector(".modular-diary-type-trigger-content"))
  if (!primaryMenu) return
  const typeTrigger = primaryMenu.querySelector<HTMLElement>(".modular-diary-type-trigger-content")?.closest<HTMLElement>(".menu-item")
  if (typeTrigger) {
    const options = buildTypeMenuOptions(types, entry.type)
    cascades.push(attachCascadeMenu(primaryMenu, typeTrigger, options, t("chooseCategory"), (index) => {
      const option = options[index]
      if (!option || option.checked) return
      menu.hide(); actions.setType(entry.line, option.type)
    }))
  }
  const todoTrigger = primaryMenu.querySelector<HTMLElement>(".modular-diary-todo-trigger-content")?.closest<HTMLElement>(".menu-item")
  if (todoTrigger) {
    const options = buildTodoMenuOptions(todos, entry.todoId, t("unbindTodo"))
    cascades.push(attachCascadeMenu(primaryMenu, todoTrigger, options, t("chooseTodo"), (index) => {
      const option = options[index]
      if (!option || option.checked) return
      menu.hide(); actions.setTodo(entry.line, option.todoId)
    }))
  }
}

export interface MarkerMenuActions {
  editNote: (line: number) => void
  setType: (line: number, type: string) => void
  remove: (line: number) => void
  togglePlan: (line: number) => void
  editMove: (line: number) => void
  editTime: (line: number) => void
  convertToSpan: (line: number) => void
}

export function showMarkerMenu(
  marker: Annotation,
  types: string[],
  x: number,
  y: number,
  actions: MarkerMenuActions,
  domDocument: Document = document
): void {
  if (!marker.type) return
  const menu = new Menu().setUseNativeMenu(false)
  let cascade: CascadeMenuController | null = null
  menu.addItem((item) => item.setTitle(marker.plan ? t("convertToActual") : t("convertToPlan"))
    .setIcon(marker.plan ? "highlighter" : "pencil").onClick(() => actions.togglePlan(marker.line)))
  menu.addItem((item) => item.setTitle(t("convertMarkerToSpan")).setIcon("rectangle-horizontal")
    .onClick(() => actions.convertToSpan(marker.line)))
  menu.addItem((item) => item.setTitle(t("moveMarker")).setIcon("move-vertical").onClick(() => actions.editMove(marker.line)))
  menu.addItem((item) => item.setTitle(t("exactMarkerTime")).setIcon("clock").onClick(() => actions.editTime(marker.line)))
  menu.addItem((item) => item.setTitle(marker.text ? t("editNote") : t("addNote")).setIcon("notebook-pen").onClick(() => actions.editNote(marker.line)))
  menu.addSeparator()
  menu.addItem((item) => {
    const title = domDocument.createDocumentFragment()
    const content = domDocument.createElement("span")
    content.className = "modular-diary-type-trigger-content"
    content.append(domDocument.createTextNode(t("changeCategory")))
    const caret = domDocument.createElement("span")
    caret.className = "modular-diary-submenu-caret"
    caret.textContent = "›"
    content.appendChild(caret)
    title.appendChild(content)
    item.setTitle(title).setIcon("tags")
  })
  menu.addSeparator()
  menu.addItem((item) => item.setTitle(t("deleteMarker")).setIcon("trash").onClick(() => actions.remove(marker.line)))
  const existing = new Set(Array.from(domDocument.querySelectorAll(".menu")))
  menu.onHide(() => cascade?.destroy())
  menu.showAtPosition({ x, y }, domDocument)
  const primary = Array.from(domDocument.querySelectorAll<HTMLElement>(".menu"))
    .find((candidate) => !existing.has(candidate) && candidate.querySelector(".modular-diary-type-trigger-content"))
  const trigger = primary?.querySelector<HTMLElement>(".modular-diary-type-trigger-content")?.closest<HTMLElement>(".menu-item")
  if (!primary || !trigger) return
  const options = buildTypeMenuOptions(types, marker.type)
  cascade = attachCascadeMenu(primary, trigger, options, t("chooseCategory"), (index) => {
    const option = options[index]
    if (!option || option.checked) return
    menu.hide()
    actions.setType(marker.line, option.type)
  })
}

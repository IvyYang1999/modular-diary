export interface CascadeMenuOption {
  title: string
  checked: boolean
}

export interface CascadeMenuController {
  open: (focusFirst?: boolean) => void
  close: (restoreFocus?: boolean) => void
  destroy: () => void
}

let cascadeSequence = 0
const activeCascadeByMenu = new WeakMap<HTMLElement, () => void>()

/**
 * Attach a real cascading submenu to an existing menu item. The submenu is a
 * child of the primary menu, so Obsidian's outside-click lifecycle treats both
 * surfaces as one menu and the parent stays open while the pointer crosses.
 */
export function attachCascadeMenu(
  primaryMenu: HTMLElement,
  trigger: HTMLElement,
  options: CascadeMenuOption[],
  accessibleLabel: string,
  onSelect: (index: number) => void
): CascadeMenuController {
  const dom = primaryMenu.ownerDocument
  let submenu: HTMLElement | null = null

  trigger.classList.add("modular-diary-cascade-trigger")
  trigger.setAttribute("aria-haspopup", "menu")
  trigger.setAttribute("aria-expanded", "false")

  const close = (restoreFocus = false): void => {
    if (submenu) {
      submenu.remove()
      submenu = null
    }
    if (activeCascadeByMenu.get(primaryMenu) === close) activeCascadeByMenu.delete(primaryMenu)
    trigger.setAttribute("aria-expanded", "false")
    trigger.removeAttribute("aria-controls")
    if (restoreFocus) trigger.focus()
  }

  const open = (focusFirst = false): void => {
    if (submenu) {
      if (focusFirst) submenu.querySelector<HTMLElement>('[role="menuitemradio"]:not([aria-disabled="true"])')?.focus()
      return
    }
    const activeClose = activeCascadeByMenu.get(primaryMenu)
    if (activeClose && activeClose !== close) activeClose()
    activeCascadeByMenu.set(primaryMenu, close)
    const menu = dom.createElement("div")
    menu.id = `modular-diary-cascade-menu-${++cascadeSequence}`
    menu.className = "menu modular-diary-cascade-menu"
    menu.setAttribute("role", "menu")
    menu.setAttribute("aria-label", accessibleLabel)

    options.forEach((option, index) => {
      const item = dom.createElement("button")
      item.type = "button"
      item.className = "menu-item tappable modular-diary-cascade-item"
      item.setAttribute("role", "menuitemradio")
      item.setAttribute("aria-checked", String(option.checked))
      if (option.checked) {
        item.classList.add("is-checked", "is-disabled")
        item.setAttribute("aria-disabled", "true")
      }
      const check = dom.createElement("span")
      check.className = "modular-diary-cascade-check"
      check.setAttribute("aria-hidden", "true")
      check.textContent = option.checked ? "✓" : ""
      const title = dom.createElement("span")
      title.className = "menu-item-title"
      title.textContent = option.title
      item.append(check, title)
      item.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (option.checked) return
        onSelect(index)
      })
      menu.appendChild(item)
    })

    menu.addEventListener("keydown", (event: KeyboardEvent) => {
      const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not([aria-disabled="true"])'))
      const current = items.indexOf(dom.activeElement as HTMLButtonElement)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        const step = event.key === "ArrowDown" ? 1 : -1
        items[(current + step + items.length) % items.length]?.focus()
      } else if (event.key === "ArrowLeft" || event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }
    })

    primaryMenu.appendChild(menu)
    submenu = menu
    trigger.setAttribute("aria-expanded", "true")
    trigger.setAttribute("aria-controls", menu.id)

    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const view = dom.defaultView
    const viewportW = view?.innerWidth ?? dom.documentElement.clientWidth
    const viewportH = view?.innerHeight ?? dom.documentElement.clientHeight
    const edge = 8
    const gap = 2
    const opensRight = triggerRect.right + gap + menuRect.width <= viewportW - edge
    const left = opensRight
      ? triggerRect.right + gap
      : Math.max(edge, triggerRect.left - menuRect.width - gap)
    const top = Math.min(Math.max(edge, triggerRect.top), Math.max(edge, viewportH - menuRect.height - edge))
    menu.classList.toggle("opens-left", !opensRight)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    if (focusFirst) menu.querySelector<HTMLElement>('[role="menuitemradio"]:not([aria-disabled="true"])')?.focus()
  }

  const onMouseEnter = (): void => open(false)
  const onClick = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    open(true)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowRight" && event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    event.stopPropagation()
    open(true)
  }
  trigger.addEventListener("mouseenter", onMouseEnter)
  trigger.addEventListener("click", onClick, true)
  trigger.addEventListener("keydown", onKeyDown)

  // Obsidian may wrap menu items in a scrolling container, so `:scope >
  // .menu-item` is not a stable boundary. Delegate pointer movement from the
  // primary menu and let the shared coordinator replace the active cascade.
  const onPointerOver = (event: PointerEvent): void => {
    const target = event.target
    if (!(target instanceof dom.defaultView!.Node)) return
    if (submenu?.contains(target)) return
    if (trigger.contains(target)) {
      open(false)
      return
    }
    if (target instanceof dom.defaultView!.Element && target.closest(".menu-item")) close(false)
  }
  primaryMenu.addEventListener("pointerover", onPointerOver, true)

  const destroy = (): void => {
    close(false)
    trigger.removeEventListener("mouseenter", onMouseEnter)
    trigger.removeEventListener("click", onClick, true)
    trigger.removeEventListener("keydown", onKeyDown)
    primaryMenu.removeEventListener("pointerover", onPointerOver, true)
  }

  return { open, close, destroy }
}

/**
 * `#` autocomplete for plain inputs, in the spirit of an @-mention: typing
 * `#` (or `#` + letters) before the caret opens a list of known tags, each
 * drawn as the badge it will become; ↑↓ move, Enter/Tab pick, Esc closes.
 * Pure DOM; the caller supplies the tag list and badge colours.
 */
export interface TagSuggestDeps {
  tags: () => string[]
  tagStyle?: (tag: string) => { background: string; color: string } | null
}

const TOKEN_RE = /(?:^|[\s(（])#([^\s#，。,.;；、！!？?：:（）()\[\]{}"'<>`]*)$/
const MAX_ITEMS = 8

export function attachTagSuggest(input: HTMLInputElement | HTMLTextAreaElement, deps: TagSuggestDeps): () => void {
  const dom = input.ownerDocument
  let pop: HTMLElement | null = null
  let items: string[] = []
  let active = 0
  let token: { start: number; end: number } | null = null
  let closeTimer = 0

  const close = (): void => { pop?.remove(); pop = null; token = null; items = [] }
  const currentToken = (): { start: number; end: number; text: string } | null => {
    const caret = input.selectionStart ?? input.value.length
    const match = TOKEN_RE.exec(input.value.slice(0, caret))
    if (!match) return null
    return { start: caret - match[1].length - 1, end: caret, text: match[1] }
  }
  const pick = (tag: string): void => {
    if (!token) return
    const value = input.value
    input.value = `${value.slice(0, token.start)}#${tag} ${value.slice(token.end)}`
    const caret = token.start + tag.length + 2
    input.setSelectionRange(caret, caret)
    close()
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.focus({ preventScroll: true })
  }
  const paint = (): void => {
    if (!pop) return
    pop.querySelectorAll<HTMLElement>(".modular-diary-tag-suggest-item").forEach((el, index) => el.classList.toggle("is-active", index === active))
  }
  const render = (): void => {
    if (!pop) {
      pop = dom.createElement("div")
      pop.className = "modular-diary-tag-suggest"
      pop.setAttribute("role", "listbox")
      // Keep the input focused while the pointer picks an item.
      pop.addEventListener("mousedown", (event) => event.preventDefault())
      dom.body.appendChild(pop)
    }
    pop.replaceChildren()
    items.forEach((tag, index) => {
      const item = dom.createElement("button")
      item.type = "button"
      item.className = "modular-diary-tag-suggest-item"
      item.setAttribute("role", "option")
      const badge = dom.createElement("span")
      badge.className = "modular-diary-tag"
      badge.textContent = `#${tag}`
      const style = deps.tagStyle?.(tag) ?? null
      if (style) {
        badge.classList.add("has-category")
        badge.style.setProperty("--modular-diary-tag-bg", style.background)
        badge.style.setProperty("--modular-diary-tag-fg", style.color)
      }
      item.appendChild(badge)
      item.addEventListener("click", () => pick(tag))
      item.addEventListener("mousemove", () => { active = index; paint() })
      pop!.appendChild(item)
    })
    const rect = input.getBoundingClientRect()
    const domWindow = dom.defaultView
    const viewportH = domWindow?.innerHeight ?? 800
    pop.style.left = `${Math.round(rect.left)}px`
    const below = rect.bottom + 4
    pop.style.top = `${Math.round(below + 240 > viewportH ? Math.max(4, rect.top - 4 - Math.min(240, items.length * 30 + 8)) : below)}px`
    paint()
  }
  const update = (): void => {
    const query = currentToken()
    if (!query) { close(); return }
    const needle = query.text.toLowerCase()
    const all = [...new Set(deps.tags())]
    const starts = all.filter((tag) => tag.toLowerCase().startsWith(needle))
    const contains = all.filter((tag) => !starts.includes(tag) && tag.toLowerCase().includes(needle))
    items = [...starts, ...contains].slice(0, MAX_ITEMS)
    if (items.length === 0 || (items.length === 1 && items[0] === query.text)) { close(); return }
    token = { start: query.start, end: query.end }
    active = 0
    render()
  }
  const onKey = (event: KeyboardEvent): void => {
    if (!pop) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      active = (active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length
      paint()
    } else if (event.key === "Enter" || event.key === "Tab") {
      pick(items[active])
    } else if (event.key === "Escape") {
      close()
    } else return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onBlur = (): void => { closeTimer = dom.defaultView?.setTimeout(close, 120) ?? 0 }
  const onFocus = (): void => { if (closeTimer) { dom.defaultView?.clearTimeout(closeTimer); closeTimer = 0 } }
  input.addEventListener("input", update)
  input.addEventListener("click", update)
  input.addEventListener("keydown", onKey, { capture: true })
  input.addEventListener("blur", onBlur)
  input.addEventListener("focus", onFocus)
  return () => {
    close()
    input.removeEventListener("input", update)
    input.removeEventListener("click", update)
    input.removeEventListener("keydown", onKey, { capture: true })
    input.removeEventListener("blur", onBlur)
    input.removeEventListener("focus", onFocus)
  }
}

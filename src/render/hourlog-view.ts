/**
 * Hour diary component (小时日记): one card per piece of diary, written
 * against a time span, plus a composer that becomes a new piece. Pieces are
 * the bodies of colour blocks or categoryless `@` spans; see core/hourlog.
 *
 * Revised after the 2026-09-29 review: pieces are addressed by identity,
 * never by line; a linked block is remembered by what it is; save state is
 * shown where the length sits; IME composition never triggers Esc/⌘↵.
 */
import { setIcon } from "obsidian"
import { FENCE_LINE_RE } from "../core/body-extent"
import { formatHours } from "../core/duration"
import type { HourlogItem, HourlogLink } from "../core/hourlog"
import { parseClock } from "../core/hourlog"
import { TAG_RE } from "../core/tags"
import type { Entry } from "../core/types"
import { attachTagSuggest, type TagSuggestDeps } from "../edit/tag-suggest"
import { t } from "../i18n"
import { renderTitleWithTags } from "./todos-view"

export interface HourlogComposerDraft {
  startMin: number
  endMin: number
  /** The colour block to hang the piece on, by identity; null writes a free `@` span. */
  link: HourlogLink | null
  body: string
  /** Open focused (from a nudge, a bracket click or a block menu). */
  focus?: boolean
}

export interface HourlogViewDeps {
  typeColors: Record<string, string>
  tagStyle?: (tag: string) => { background: string; color: string } | null
  tagSuggest?: TagSuggestDeps
  /** Blocks a new piece may hang on. */
  linkable: Entry[]
  /** The block's visible range; a span before it would land on the next day. */
  range: { startMin: number; endMin: number }
  composer: HourlogComposerDraft
  onComposerChange: (draft: HourlogComposerDraft | null) => void
  onCreate: (draft: HourlogComposerDraft) => void | Promise<void>
  onSaveBody: (item: HourlogItem, body: string) => void | Promise<void>
  onMenu: (item: HourlogItem, x: number, y: number) => void
  onLocate: (item: HourlogItem) => void
  onExtendRange: (startMin: number) => void
}

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const sameLink = (a: HourlogLink | null, entry: Entry): boolean => Boolean(a) && a!.startMin === entry.startMin && a!.endMin === entry.endMin && a!.type === entry.type && (a!.note ?? "") === (entry.note ?? "")

function autosize(area: HTMLTextAreaElement): void {
  area.style.height = "auto"
  area.style.height = `${area.scrollHeight}px`
}

/** Keys pressed while an input method is composing belong to the IME, not to us. */
function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

function isModEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !composing(event)
}

function tagsIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(TAG_RE), (match) => match[1]))]
}

function renderItem(list: HTMLElement, item: HourlogItem, deps: HourlogViewDeps): void {
  const card = list.createDiv({ cls: `modular-diary-hourlog-item is-${item.kind}` })
  card.dataset.line = String(item.line)
  const color = item.type ? deps.typeColors[item.type] : undefined
  if (color) card.style.setProperty("--modular-diary-hourlog-color", color)
  const openMenu = (x: number, y: number): void => deps.onMenu(item, x, y)
  card.addEventListener("contextmenu", (event) => {
    if ((event.target as HTMLElement).closest("textarea")) return
    event.preventDefault()
    event.stopPropagation()
    openMenu(event.clientX, event.clientY)
  })

  const headRow = card.createDiv({ cls: "modular-diary-hourlog-head-row" })
  const head = headRow.createEl("button", { cls: "modular-diary-hourlog-head", attr: { type: "button", "aria-label": t("locateOnTimeline", { time: `${clock(item.startMin)}–${clock(item.endMin)}` }) } })
  const nextDay = item.startMin >= 24 * 60 ? `${t("nextDayShort")} ` : ""
  head.createEl("span", { cls: "modular-diary-hourlog-time", text: `${nextDay}${clock(item.startMin)}–${clock(item.endMin)}` })
  if (item.kind === "entry" && item.type) {
    const cat = head.createEl("span", { cls: "modular-diary-hourlog-cat" })
    cat.createEl("i", { attr: { "aria-hidden": "true" } })
    cat.appendChild(cat.ownerDocument.createTextNode(item.type))
  }
  // Tags from the note and the body sit together on the head line: "what this piece belongs to".
  const noteEl = head.createEl("span", { cls: "modular-diary-hourlog-note" })
  const paintNote = (bodyText: string): void => {
    noteEl.replaceChildren()
    if (item.note) renderTitleWithTags(noteEl, item.note, deps.tagStyle)
    const extra = tagsIn(bodyText).filter((tag) => !(item.note ?? "").includes(`#${tag}`))
    if (extra.length) renderTitleWithTags(noteEl, `${item.note ? " " : ""}${extra.map((tag) => `#${tag}`).join(" ")}`, deps.tagStyle)
  }
  paintNote(item.body)
  head.addEventListener("click", () => deps.onLocate(item))
  // The length slot doubles as the save status.
  const status = headRow.createEl("span", { cls: "modular-diary-hourlog-status", attr: { "aria-live": "polite" } })
  const length = formatHours(item.endMin - item.startMin)
  const more = headRow.createEl("button", { cls: "modular-diary-item-more modular-diary-hourlog-more", attr: { type: "button", "aria-label": t("moreActions") } })
  setIcon(more, "more-horizontal")
  more.addEventListener("click", () => { const rect = more.getBoundingClientRect(); openMenu(rect.left, rect.bottom) })

  const area = card.createEl("textarea", { cls: "modular-diary-hourlog-body", attr: { rows: "1", placeholder: t("hourlogBodyPlaceholder"), "aria-label": t("hourlogBody", { time: clock(item.startMin) }) } })
  area.value = item.body
  if (deps.tagSuggest) attachTagSuggest(area, deps.tagSuggest)
  let saved = item.body
  let cancelled = false
  let state: "idle" | "dirty" | "saving" | "failed" | "blocked" = "idle"
  const paintStatus = (): void => {
    card.dataset.state = state
    status.replaceChildren()
    if (state === "saving") status.textContent = t("saving")
    else if (state === "failed") {
      status.appendChild(status.ownerDocument.createTextNode(`${t("notSaved")} · `))
      const retry = status.createEl("button", { cls: "modular-diary-save-retry", text: t("retry"), attr: { type: "button" } })
      retry.addEventListener("click", () => { state = "dirty"; save(true) })
    } else if (state === "blocked") status.textContent = t("bodyFenceBlocked")
    else {
      status.textContent = length
      if (state === "dirty") status.createEl("i", { cls: "modular-diary-hourlog-dirty", attr: { "aria-label": t("unsaved") } })
    }
  }
  const save = (force = false): void => {
    const value = area.value.replace(/\s+$/, "")
    if (!force && value === saved) { state = "idle"; paintStatus(); return }
    if (FENCE_LINE_RE.test(value)) { state = "blocked"; paintStatus(); return }
    state = "saving"
    paintStatus()
    void Promise.resolve(deps.onSaveBody(item, value)).then(() => { saved = value }, () => { state = "failed"; paintStatus() })
  }
  area.addEventListener("input", () => {
    autosize(area)
    paintNote(area.value)
    state = area.value.replace(/\s+$/, "") === saved ? "idle" : "dirty"
    paintStatus()
  })
  area.addEventListener("keydown", (event) => {
    if (isModEnter(event)) { event.preventDefault(); area.blur() }
    else if (event.key === "Escape" && !composing(event)) {
      event.preventDefault()
      cancelled = true
      area.value = saved
      autosize(area)
      paintNote(saved)
      state = "idle"
      paintStatus()
      area.blur()
    }
  })
  area.addEventListener("blur", () => { if (cancelled) { cancelled = false; return } save() })
  paintStatus()
  queueMicrotask(() => autosize(area))
}

function renderComposer(root: HTMLElement, deps: HourlogViewDeps): HTMLTextAreaElement {
  const draft: HourlogComposerDraft = { ...deps.composer }
  const box = root.createEl("form", { cls: "modular-diary-hourlog-composer" })
  box.noValidate = true
  const meta = box.createDiv({ cls: "modular-diary-hourlog-composer-meta" })
  const start = meta.createEl("input", { cls: "modular-diary-hourlog-clock", attr: { type: "text", inputmode: "numeric", "aria-label": t("hourlogStart"), placeholder: "09:00" } })
  meta.createEl("span", { cls: "modular-diary-hourlog-dash", text: "–" })
  const end = meta.createEl("input", { cls: "modular-diary-hourlog-clock", attr: { type: "text", inputmode: "numeric", "aria-label": t("hourlogEnd"), placeholder: "10:00" } })
  const nextDay = meta.createEl("span", { cls: "modular-diary-hourlog-nextday", text: t("nextDayShort") })
  const link = meta.createEl("select", { cls: "modular-diary-hourlog-link", attr: { "aria-label": t("hourlogLink") } })
  link.createEl("option", { text: t("hourlogFreeSpan"), attr: { value: "" } })
  deps.linkable.forEach((entry, index) => {
    const label = `${clock(entry.startMin)}–${clock(entry.endMin)} ${entry.type}${entry.note ? " · " + entry.note.replace(/#[^\s#]+/g, "").trim() : ""}`
    link.createEl("option", { text: label, attr: { value: String(index) } })
  })
  const notice = box.createDiv({ cls: "modular-diary-hourlog-notice", attr: { "aria-live": "polite" } })
  const area = box.createEl("textarea", { cls: "modular-diary-hourlog-body is-composer", attr: { rows: "1", "aria-label": t("hourlogComposer") } })
  if (deps.tagSuggest) attachTagSuggest(area, deps.tagSuggest)
  const foot = box.createDiv({ cls: "modular-diary-hourlog-composer-foot" })
  foot.createEl("span", { cls: "modular-diary-hourlog-hint", text: t("hourlogHint", { keys: isMac() ? "⌘↵" : "Ctrl+↵" }) })
  const submit = foot.createEl("button", { cls: "modular-diary-hourlog-submit", text: t("hourlogSubmit"), attr: { type: "submit" } })

  let lostLink = false
  const linked = (): Entry | undefined => draft.link ? deps.linkable.find((entry) => sameLink(draft.link, entry)) : undefined
  const paint = (): void => {
    const target = linked()
    if (draft.link && !target) { draft.link = null; lostLink = true }
    start.value = clock(draft.startMin)
    end.value = clock(draft.endMin)
    nextDay.hidden = draft.endMin <= 24 * 60 || draft.startMin >= 24 * 60
    link.value = target ? String(deps.linkable.indexOf(target)) : ""
    area.placeholder = t("hourlogPromptRange", { start: clock(draft.startMin), end: clock(draft.endMin) })
    // What will actually be written, said plainly under the times.
    notice.replaceChildren()
    const partial = target && (draft.startMin !== target.startMin || draft.endMin !== target.endMin)
    if (lostLink) notice.textContent = t("hourlogLinkLost")
    else if (partial) notice.textContent = t("hourlogPartialLink", { type: target!.type })
    else if (draft.startMin < deps.range.startMin) {
      notice.appendChild(notice.ownerDocument.createTextNode(t("hourlogOutOfRange", { start: clock(deps.range.startMin), end: clock(deps.range.endMin) })))
      const extend = notice.createEl("button", { cls: "modular-diary-hourlog-inline-button", text: t("hourlogExtendRange"), attr: { type: "button" } })
      extend.addEventListener("click", () => deps.onExtendRange(draft.startMin))
    }
    notice.hidden = notice.childNodes.length === 0
    box.classList.toggle("has-content", draft.body.trim().length > 0 || Boolean(target))
    submit.disabled = draft.body.trim().length === 0
  }
  area.value = draft.body
  paint()
  const changed = (): void => deps.onComposerChange(draft.body || draft.link ? { ...draft, focus: false } : null)
  const readClock = (input: HTMLInputElement, key: "startMin" | "endMin"): boolean => {
    const value = parseClock(input.value)
    input.toggleAttribute("aria-invalid", value === null)
    if (value === null) return false
    draft[key] = value
    // An end at or before the start runs past midnight.
    if (draft.endMin <= draft.startMin && draft.endMin < 24 * 60) draft.endMin += 24 * 60
    else if (draft.endMin - draft.startMin > 24 * 60) draft.endMin -= 24 * 60
    return true
  }
  start.addEventListener("change", () => { if (readClock(start, "startMin")) { lostLink = false; paint(); changed() } })
  end.addEventListener("change", () => { if (readClock(end, "endMin")) { lostLink = false; paint(); changed() } })
  link.addEventListener("change", () => {
    const entry = link.value === "" ? undefined : deps.linkable[Number(link.value)]
    draft.link = entry ? { startMin: entry.startMin, endMin: entry.endMin, type: entry.type, ...(entry.note ? { note: entry.note } : {}) } : null
    if (entry) { draft.startMin = entry.startMin; draft.endMin = entry.endMin }
    lostLink = false
    paint()
    changed()
  })
  area.addEventListener("input", () => { draft.body = area.value; autosize(area); paint(); changed() })
  area.addEventListener("keydown", (event) => {
    if (isModEnter(event)) { event.preventDefault(); box.requestSubmit() }
  })
  box.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!readClock(start, "startMin") || !readClock(end, "endMin")) return
    if (!draft.body.trim()) { area.focus(); return }
    if (FENCE_LINE_RE.test(draft.body)) { notice.textContent = t("bodyFenceBlocked"); notice.hidden = false; area.focus(); return }
    // A link only holds when the times match the block exactly; otherwise it is a span of its own.
    const target = linked()
    const next: HourlogComposerDraft = { ...draft, link: target && draft.startMin === target.startMin && draft.endMin === target.endMin ? draft.link : null, body: draft.body.replace(/\s+$/, "") }
    submit.disabled = true
    void Promise.resolve(deps.onCreate(next)).catch(() => { submit.disabled = false; notice.textContent = t("notSaved"); notice.hidden = false })
  })
  queueMicrotask(() => {
    autosize(area)
    if (deps.composer.focus) {
      area.focus({ preventScroll: false })
      area.setSelectionRange(area.value.length, area.value.length)
      box.scrollIntoView({ block: "nearest" })
    }
  })
  return area
}

export function renderHourlogInto(slot: HTMLElement, items: HourlogItem[], deps: HourlogViewDeps): void {
  const root = slot.createDiv({ cls: "modular-diary-hourlog" })
  const header = root.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t("hourlog") })
  if (items.length > 0) header.createEl("span", { cls: "modular-diary-component-count", text: t("hourlogCount", { count: String(items.length) }) })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("hourlogComposer") } })
  setIcon(add, "plus")
  const list = root.createDiv({ cls: "modular-diary-hourlog-list" })
  for (const item of items) renderItem(list, item, deps)
  const composer = renderComposer(root, deps)
  add.addEventListener("click", () => { composer.focus(); composer.scrollIntoView({ block: "nearest" }) })
}

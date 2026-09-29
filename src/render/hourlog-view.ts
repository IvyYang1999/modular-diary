/**
 * Hour diary component (小时日记): one card per piece of diary, written
 * against a time span, plus a composer that becomes a new piece. Pieces are
 * the bodies of colour blocks or categoryless `@` spans; see core/hourlog.
 *
 * Editing is plain text in place. A card saves when it loses focus or on
 * Mod+Enter; Esc puts back what was there. The composer keeps its draft
 * through a remount via deps.onComposerChange.
 */
import { setIcon } from "obsidian"
import type { HourlogItem } from "../core/hourlog"
import { parseClock } from "../core/hourlog"
import type { Entry } from "../core/types"
import { attachTagSuggest, type TagSuggestDeps } from "../edit/tag-suggest"
import { t } from "../i18n"
import { renderTitleWithTags } from "./todos-view"

export interface HourlogComposerDraft {
  startMin: number
  endMin: number
  /** Line of the colour block to hang the piece on; null writes a free `@` span. */
  link: number | null
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
  composer: HourlogComposerDraft
  onComposerChange: (draft: HourlogComposerDraft | null) => void
  onCreate: (draft: HourlogComposerDraft) => void | Promise<void>
  onSaveBody: (item: HourlogItem, body: string) => void | Promise<void>
  onMenu: (item: HourlogItem, x: number, y: number) => void
  onLocate: (item: HourlogItem) => void
}

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
export function formatSpanLength(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h${rest}m`
}

function autosize(area: HTMLTextAreaElement): void {
  area.style.height = "auto"
  area.style.height = `${area.scrollHeight}px`
}

function isModEnter(event: KeyboardEvent): boolean {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey)
}

function renderItem(list: HTMLElement, item: HourlogItem, deps: HourlogViewDeps): void {
  const card = list.createDiv({ cls: `modular-diary-hourlog-item is-${item.kind}` })
  card.dataset.line = String(item.line)
  card.dataset.start = String(item.startMin)
  const color = item.type ? deps.typeColors[item.type] : undefined
  if (color) card.style.setProperty("--modular-diary-hourlog-color", color)
  card.addEventListener("contextmenu", (event) => {
    if ((event.target as HTMLElement).closest("textarea")) return
    event.preventDefault()
    event.stopPropagation()
    deps.onMenu(item, event.clientX, event.clientY)
  })

  const head = card.createEl("button", { cls: "modular-diary-hourlog-head", attr: { type: "button", "aria-label": t("locateOnTimeline", { time: `${clock(item.startMin)}–${clock(item.endMin)}` }) } })
  head.createEl("span", { cls: "modular-diary-hourlog-time", text: `${clock(item.startMin)}–${clock(item.endMin)}` })
  if (item.kind === "entry" && item.type) {
    const cat = head.createEl("span", { cls: "modular-diary-hourlog-cat" })
    cat.createEl("i", { attr: { "aria-hidden": "true" } })
    cat.appendChild(cat.ownerDocument.createTextNode(item.type))
  }
  if (item.note) renderTitleWithTags(head.createEl("span", { cls: "modular-diary-hourlog-note" }), item.note, deps.tagStyle)
  head.createEl("span", { cls: "modular-diary-hourlog-length", text: formatSpanLength(item.endMin - item.startMin) })
  head.addEventListener("click", () => deps.onLocate(item))

  const area = card.createEl("textarea", { cls: "modular-diary-hourlog-body", attr: { rows: "1", placeholder: t("hourlogBodyPlaceholder"), "aria-label": t("hourlogBody", { time: clock(item.startMin) }) } })
  area.value = item.body
  if (deps.tagSuggest) attachTagSuggest(area, deps.tagSuggest)
  // Body tags beyond those already on the head line, as quiet badges.
  const bodyTags = card.createDiv({ cls: "modular-diary-hourlog-tags" })
  const paintTags = (): void => {
    bodyTags.replaceChildren()
    const seen = new Set((item.note ?? "").match(/#[^\s#，。,.;；、！!？?：:（）()\[\]{}"'<>`]+/g) ?? [])
    const found = [...new Set(area.value.match(/#[^\s#，。,.;；、！!？?：:（）()\[\]{}"'<>`]+/g) ?? [])].filter((tag) => !seen.has(tag))
    if (found.length) renderTitleWithTags(bodyTags, found.join(" "), deps.tagStyle)
    bodyTags.hidden = found.length === 0
  }
  paintTags()
  let saved = item.body
  let cancelled = false
  const save = (): void => {
    const value = area.value.replace(/\s+$/, "")
    if (value === saved) return
    saved = value
    card.classList.add("is-saving")
    void Promise.resolve(deps.onSaveBody(item, value)).catch(() => {
      saved = item.body
      card.classList.remove("is-saving")
      card.classList.add("is-failed")
    })
  }
  area.addEventListener("input", () => { autosize(area); paintTags(); card.classList.toggle("is-dirty", area.value !== saved) })
  area.addEventListener("keydown", (event) => {
    if (isModEnter(event)) { event.preventDefault(); area.blur() }
    else if (event.key === "Escape") { event.preventDefault(); cancelled = true; area.value = saved; autosize(area); paintTags(); area.blur() }
  })
  area.addEventListener("blur", () => { if (cancelled) { cancelled = false; card.classList.remove("is-dirty"); return } save() })
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
  const link = meta.createEl("select", { cls: "modular-diary-hourlog-link", attr: { "aria-label": t("hourlogLink") } })
  link.createEl("option", { text: t("hourlogFreeSpan"), attr: { value: "" } })
  for (const entry of deps.linkable) {
    link.createEl("option", { text: `${clock(entry.startMin)}–${clock(entry.endMin)} ${entry.type}${entry.note ? " · " + entry.note.replace(/#[^\s#]+/g, "").trim() : ""}`, attr: { value: String(entry.line) } })
  }
  const area = box.createEl("textarea", { cls: "modular-diary-hourlog-body is-composer", attr: { rows: "1", placeholder: t("hourlogComposerPlaceholder"), "aria-label": t("hourlogComposer") } })
  if (deps.tagSuggest) attachTagSuggest(area, deps.tagSuggest)
  const foot = box.createDiv({ cls: "modular-diary-hourlog-composer-foot" })
  foot.createEl("span", { cls: "modular-diary-hourlog-hint", text: t("hourlogHint") })
  const submit = foot.createEl("button", { cls: "modular-diary-hourlog-submit", text: t("hourlogSubmit"), attr: { type: "submit" } })

  const paint = (): void => {
    const linked = deps.linkable.find((entry) => entry.line === draft.link)
    if (linked) { draft.startMin = linked.startMin; draft.endMin = linked.endMin }
    start.value = clock(draft.startMin)
    end.value = clock(draft.endMin)
    start.disabled = end.disabled = Boolean(linked)
    link.value = linked ? String(linked.line) : ""
    box.classList.toggle("has-content", draft.body.trim().length > 0 || Boolean(linked))
    submit.disabled = draft.body.trim().length === 0
  }
  area.value = draft.body
  paint()
  const changed = (): void => deps.onComposerChange(draft.body || draft.link !== null ? { ...draft, focus: false } : null)
  const readClock = (input: HTMLInputElement, key: "startMin" | "endMin"): void => {
    const value = parseClock(input.value)
    input.toggleAttribute("aria-invalid", value === null)
    if (value !== null) { draft[key] = value; changed() }
  }
  start.addEventListener("change", () => readClock(start, "startMin"))
  end.addEventListener("change", () => readClock(end, "endMin"))
  link.addEventListener("change", () => { draft.link = link.value === "" ? null : Number(link.value); paint(); changed() })
  area.addEventListener("input", () => { draft.body = area.value; autosize(area); paint(); changed() })
  area.addEventListener("keydown", (event) => { if (isModEnter(event)) { event.preventDefault(); box.requestSubmit() } })
  box.addEventListener("submit", (event) => {
    event.preventDefault()
    readClock(start, "startMin"); readClock(end, "endMin")
    if (!draft.body.trim()) { area.focus(); return }
    if (draft.endMin <= draft.startMin) { end.setAttribute("aria-invalid", "true"); end.focus(); return }
    submit.disabled = true
    void Promise.resolve(deps.onCreate({ ...draft, body: draft.body.replace(/\s+$/, "") })).catch(() => { submit.disabled = false })
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
  if (items.length > 0) {
    const total = items.reduce((sum, item) => sum + item.endMin - item.startMin, 0)
    header.createEl("span", { cls: "modular-diary-component-count", text: `${items.length} · ${formatSpanLength(total)}` })
  }
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("hourlogComposer") } })
  setIcon(add, "plus")
  const list = root.createDiv({ cls: "modular-diary-hourlog-list" })
  for (const item of items) renderItem(list, item, deps)
  const composer = renderComposer(root, deps)
  add.addEventListener("click", () => { composer.focus(); composer.scrollIntoView({ block: "nearest" }) })
}

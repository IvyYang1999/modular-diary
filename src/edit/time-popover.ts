import { trackAnchor } from "./popover-anchor"
import { MessageKey, t } from "../i18n"

const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/

/** Parse "H:MM"/"HH:MM" into minutes; null when the copy is not a clock. */
export function parseClockInput(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 29 || minute > 59) return null
  return hour * 60 + minute
}

/**
 * Why a start/end pair cannot be saved, as an i18n key, or null when valid.
 * Equal times cannot describe a span; the parser would otherwise wrap the
 * end to the next day and silently produce a 24-hour block.
 */
export function spanInputProblem(start: string, end: string): { key: MessageKey; field: "start" | "end" } | null {
  const startMin = parseClockInput(start)
  const endMin = parseClockInput(end)
  if (startMin === null) return { key: "invalidStart", field: "start" }
  if (endMin === null) return { key: "invalidEnd", field: "end" }
  if (startMin === endMin) return { key: "durationTooShort", field: "end" }
  return null
}

/**
 * Invalid input must not fail silently: mark the field, shake it (unless the
 * user prefers reduced motion; CSS handles that) and say why in the popover.
 */
function flagInvalid(pop: HTMLElement, input: HTMLInputElement, message: string): void {
  const dom = pop.ownerDocument
  input.setAttribute("aria-invalid", "true")
  input.classList.remove("is-invalid")
  // Restart the shake even when the same field was already flagged.
  void input.offsetWidth
  input.classList.add("is-invalid")
  let error = pop.querySelector<HTMLElement>(".oneday-time-popover-error")
  if (!error) {
    error = dom.createElement("div")
    error.className = "oneday-time-popover-error"
    error.setAttribute("role", "alert")
    pop.appendChild(error)
  }
  error.textContent = message
  pop.classList.add("has-error")
  input.focus()
  input.select()
}

function clearInvalid(pop: HTMLElement, input: HTMLInputElement): void {
  input.removeAttribute("aria-invalid")
  input.classList.remove("is-invalid")
  if (!pop.querySelector('[aria-invalid="true"]')) {
    pop.querySelector(".oneday-time-popover-error")?.remove()
    pop.classList.remove("has-error")
  }
}
/**
 * Precise time editor: small popover with start/end inputs (HH:MM free
 * typing) docked at the block's right edge — the typing-precision
 * counterpart to ⌥-drag (yyt 2026-08-19).
 */
export function openTimePopover(
  container: HTMLElement,
  anchorEl: Element,
  anchorRect: { x: number; y: number; width: number; height: number },
  initial: { start: string; end: string },
  onSave: (start: string, end: string) => void
): void {
  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  if (!domWindow) return
  dom.querySelectorAll(".oneday-time-popover").forEach((el) => el.remove())

  const pop = dom.createElement("div")
  pop.className = "oneday-time-popover"
  pop.setAttribute("role", "dialog")
  pop.setAttribute("aria-label", t("editBlockTimes"))
  const start = dom.createElement("input")
  start.type = "text"
  start.setAttribute("aria-label", t("startTime"))
  start.value = initial.start
  start.placeholder = "HH:MM"
  const dash = dom.createElement("span")
  dash.setAttribute("aria-hidden", "true")
  dash.textContent = "–"
  const end = dom.createElement("input")
  end.type = "text"
  end.setAttribute("aria-label", t("endTime"))
  end.value = initial.end
  end.placeholder = "HH:MM"
  const row = dom.createElement("div")
  row.className = "oneday-time-popover-row"
  row.append(start, dash, end)
  pop.appendChild(row)

  // fixed + body 挂载：脱离槽位裁剪；跟随锚点滚动（yyt 2026-08-19）
  const place = (r: { x: number; width: number; y: number; height: number }): void => {
    pop.style.left = `${r.x + r.width + 6}px`
    pop.style.top = `${r.y + r.height / 2 - 14}px`
    const vw = domWindow.innerWidth
    const pw = pop.offsetWidth
    if (pop.offsetLeft + pw > vw - 8) pop.style.left = `${Math.max(8, r.x - pw - 6)}px`
  }
  place(anchorRect)
  dom.body.appendChild(pop)
  const stopTracking = trackAnchor(pop, anchorEl, place)

  let done = false
  const finish = (save: boolean): void => {
    if (done) return
    if (save) {
      const problem = spanInputProblem(start.value, end.value)
      if (problem) {
        flagInvalid(pop, problem.field === "start" ? start : end, t(problem.key))
        return
      }
      done = true
      stopTracking()
      pop.remove()
      onSave(start.value.trim(), end.value.trim())
    } else {
      done = true
      stopTracking()
      pop.remove()
    }
  }
  // 气泡内点击不夺焦（yyt：点到浮窗就消失——blur 用预填值"成功保存"把自己关了）
  // 气泡内点击不夺焦——但输入框本身要能点（preventDefault 会连焦点一起吞，yyt 2026-08-19）
  pop.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement
    if (t !== start && t !== end) e.preventDefault()
  })
  for (const input of [start, end]) {
    input.addEventListener("input", () => clearInvalid(pop, input))
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        finish(true)
      } else if (e.key === "Escape") {
        e.preventDefault()
        finish(false)
      }
      e.stopPropagation()
    })
  }
  // 两个输入框属于同一个编辑会话：左框 blur 到右框时不能提交。
  // 只有焦点真正离开整个浮窗时才保存；延后一帧读取 activeElement，
  // 兼容 relatedTarget 为空的 Electron/鼠标点击路径。
  pop.addEventListener("focusout", (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null
    if (next && pop.contains(next)) return
    domWindow.setTimeout(() => {
      if (!pop.contains(dom.activeElement)) finish(true)
    }, 0)
  })
  domWindow.setTimeout(() => start.focus(), 0)
}

/** Single-clock counterpart used by point-in-time markers. */
export function openPointTimePopover(
  container: HTMLElement,
  anchorEl: Element,
  anchorRect: { x: number; y: number; width: number; height: number },
  initial: string,
  onSave: (time: string) => void
): void {
  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  if (!domWindow) return
  dom.querySelectorAll(".oneday-time-popover").forEach((el) => el.remove())
  const pop = dom.createElement("div")
  pop.className = "oneday-time-popover oneday-point-time-popover"
  pop.setAttribute("role", "dialog")
  pop.setAttribute("aria-label", t("editMarkerTime"))
  const input = dom.createElement("input")
  input.type = "text"
  input.value = initial
  input.placeholder = "HH:MM"
  input.setAttribute("aria-label", t("markerTime"))
  const row = dom.createElement("div")
  row.className = "oneday-time-popover-row"
  row.appendChild(input)
  pop.appendChild(row)
  const place = (rect: { x: number; width: number; y: number; height: number }): void => {
    pop.style.left = `${rect.x + rect.width + 6}px`
    pop.style.top = `${rect.y + rect.height / 2 - 14}px`
    if (pop.offsetLeft + pop.offsetWidth > domWindow.innerWidth - 8) {
      pop.style.left = `${Math.max(8, rect.x - pop.offsetWidth - 6)}px`
    }
  }
  place(anchorRect)
  dom.body.appendChild(pop)
  const stopTracking = trackAnchor(pop, anchorEl, place)
  let done = false
  const finish = (save: boolean): void => {
    if (done) return
    if (save) {
      const minutes = parseClockInput(input.value)
      if (minutes === null || minutes >= 24 * 60) {
        flagInvalid(pop, input, t("invalidTime"))
        return
      }
    }
    done = true
    stopTracking()
    pop.remove()
    if (save) onSave(input.value.trim())
  }
  input.addEventListener("input", () => clearInvalid(pop, input))
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      finish(true)
    } else if (event.key === "Escape") {
      event.preventDefault()
      finish(false)
    }
    event.stopPropagation()
  })
  pop.addEventListener("focusout", () => domWindow.setTimeout(() => {
    if (!pop.contains(dom.activeElement)) finish(true)
  }, 0))
  domWindow.setTimeout(() => input.focus(), 0)
}

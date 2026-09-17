export interface ClosestCapableTarget {
  closest(selector: string): Element | null
}

export interface MarkdownUndoEditor {
  undo(): void
  redo(): void
}

export interface MarkdownUndoKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  target: EventTarget | ClosestCapableTarget | null
  preventDefault(): void
  stopPropagation(): void
}

const NATIVE_EDITING_SURFACE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
].join(", ")

/** Native controls own Delete/Backspace and their local undo history. */
export function isNativeEditingSurfaceTarget(target: ClosestCapableTarget | null): boolean {
  return Boolean(target?.closest(NATIVE_EDITING_SURFACE_SELECTOR))
}

/** True when a keyboard event belongs to a native/app text editing surface. */
export function isEditingSurfaceTarget(target: ClosestCapableTarget | null): boolean {
  if (!target) return false
  if (isNativeEditingSurfaceTarget(target)) return true

  // Live Preview embeds rendered code-block widgets inside `.cm-content`.
  // The CodeMirror ancestor alone therefore does not prove that the key event
  // came from its text-editing surface. Modular Diary chrome must route Ctrl/Cmd+Z
  // back to the owning Markdown editor, while actual CM text outside the
  // widget keeps CodeMirror's native keyboard handling.
  return Boolean(target.closest(".cm-content") && !target.closest(".modular-diary-container"))
}

/**
 * Whether a native control should keep Delete/Backspace while a rendered
 * timeline object is selected. CodeMirror's root remains focused after users
 * click an embedded SVG, but that retained focus does not mean they resumed
 * editing Markdown. Real nested controls still own their editing keys.
 */
export function nativeControlOwnsTimelineDelete(target: ClosestCapableTarget | null): boolean {
  if (!target || !isNativeEditingSurfaceTarget(target)) return false
  const codeMirrorRoot = target.closest(".cm-content[contenteditable]")
  if (!codeMirrorRoot) return true
  return Boolean(target.closest([
    "input",
    "textarea",
    "select",
    '[contenteditable="true"]:not(.cm-content)',
    '[contenteditable="plaintext-only"]:not(.cm-content)',
  ].join(", ")))
}

/**
 * Inputs and actual text-editing surfaces own their native undo history.
 * Rendered controls inside a CodeMirror editor (SVG, buttons, component
 * chrome) do not: their key event must be routed back to the Markdown editor.
 */
export function shouldLeaveUndoToFocusedEditor(target: ClosestCapableTarget | null): boolean {
  return isEditingSurfaceTarget(target)
}

/** Route Ctrl/Cmd+Z from rendered Modular Diary chrome to its Markdown owner. */
export function routeMarkdownUndo(
  event: MarkdownUndoKeyEvent,
  resolveEditor: () => MarkdownUndoEditor | null
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return false
  const target = event.target && typeof (event.target as ClosestCapableTarget).closest === "function"
    ? event.target as ClosestCapableTarget
    : null
  if (shouldLeaveUndoToFocusedEditor(target)) return false
  const editor = resolveEditor()
  if (!editor) return false
  event.preventDefault()
  event.stopPropagation()
  if (event.shiftKey) editor.redo()
  else editor.undo()
  return true
}

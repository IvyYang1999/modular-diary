import type { EditorPosition, MarkdownView } from "obsidian"
import type { EditorView } from "@codemirror/view"
import { Transaction } from "@codemirror/state"

interface CodeMirrorBackedEditor {
  cm?: EditorView
}

export interface PreparedCodeMirrorReplacement {
  apply: () => void
}

/**
 * Prepare one CodeMirror transaction that owns both the Markdown replacement
 * and its scroll snapshot. Restoring scroll from DOM callbacks after the
 * write races CodeMirror's later measure pass; the snapshot effect is the
 * supported way to let that final pass preserve the user's viewport itself.
 */
export function prepareCodeMirrorReplacement(
  view: MarkdownView,
  insert: string,
  from: EditorPosition,
  to: EditorPosition
): PreparedCodeMirrorReplacement | null {
  const editor = view.editor
  const cm = (editor as typeof editor & CodeMirrorBackedEditor).cm
  if (!cm || cm.state.doc.toString() !== editor.getValue()) return null

  const fromOffset = editor.posToOffset(from)
  const toOffset = editor.posToOffset(to)
  const effect = cm.scrollSnapshot()
  return {
    apply: () => cm.dispatch({
      changes: { from: fromOffset, to: toOffset, insert },
      effects: effect,
      // Make the product contract explicit instead of relying on CodeMirror's
      // default history heuristic: every Modular Diary source mutation is one
      // immediately undoable transaction.
      annotations: Transaction.addToHistory.of(true),
    }),
  }
}

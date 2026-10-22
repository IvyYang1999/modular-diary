/**
 * Todo attachments live in the todo line as `attach="…"`, one item per line:
 * a vault link `[[path]]` (an image when the extension says so) or an http(s)
 * URL. Plain text, so an Agent can read and write them like any other field.
 */
export interface TodoAttachment {
  kind: "image" | "file" | "link"
  /** Exactly as written in the source. */
  raw: string
  /** Vault link path, or the URL. */
  target: string
  /** Short text for the chip. */
  label: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i

export function parseTodoAttachment(raw: string): TodoAttachment | null {
  const text = raw.trim()
  const wiki = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(text)
  if (wiki) {
    const target = wiki[1].trim()
    const name = target.split("/").pop() ?? target
    return { kind: IMAGE_EXT.test(target) ? "image" : "file", raw: text, target, label: wiki[2]?.trim() || name }
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      const url = new URL(text)
      const path = url.pathname === "/" ? "" : url.pathname
      return { kind: "link", raw: text, target: text, label: (url.hostname.replace(/^www\./, "") + path).slice(0, 40) }
    } catch {
      return null
    }
  }
  return null
}

/** Turn what was typed or pasted into source items; anything unrecognised is dropped. */
export function attachmentsFromText(text: string): string[] {
  return [...text.matchAll(/!?\[\[[^\]\n]+\]\]|https?:\/\/\S+/gi)]
    .map((match) => parseTodoAttachment(match[0])?.raw)
    .filter((raw): raw is string => Boolean(raw))
}

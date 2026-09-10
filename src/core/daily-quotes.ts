/**
 * Daily quote: one global sentence library, one sentence per date, shown as a
 * plain line on a slot tinted with a highlighter ink from the user's palette.
 *
 * 2026-09-10 (yyt): the earlier "editorial card" — five themes, fonts, sizes,
 * background photos with crop/zoom/overlay, per-block appearance snapshots in
 * the Markdown header — is gone. The library is edited as text, one sentence
 * per line: `句子 —— 出处 #分类`. Nothing about quotes is written into the
 * block source any more; the slot's presence in `layout:` is all it needs.
 */
export interface DailyQuoteDefinition {
  id: string
  text: string
  author: string
  order: number
  /** Span category whose colour tints the slot; falls back to the global ink. */
  ink?: string
}

const ID_RE = /[^a-z0-9_-]/gi
const INK_RE = /\s+#(\S+)\s*$/
/** `——` anywhere, or a spaced em dash / double hyphen, separates text from source. */
const AUTHOR_RE = /^(.*?)(?:\s*——\s*|\s+—\s+|\s+--\s+)(.*)$/

export function normalizeDailyQuoteDefinition(value: Partial<DailyQuoteDefinition>, order: number): DailyQuoteDefinition {
  const ink = String(value.ink ?? "").trim().replace(/\s+/g, "")
  return {
    id: String(value.id || `quote-${order + 1}`).replace(ID_RE, "-").slice(0, 80),
    text: String(value.text ?? ""),
    author: String(value.author ?? ""),
    order: Number.isFinite(value.order) ? Number(value.order) : order,
    ...(ink ? { ink } : {}),
  }
}

export function orderedDailyQuotes(values: DailyQuoteDefinition[]): DailyQuoteDefinition[] {
  return values.filter((item) => item.text.trim()).sort((a, b) => a.order - b.order)
}

/** Same date, same sentence — the library order decides the rotation. */
export function dailyQuoteForDate(values: DailyQuoteDefinition[], date: string): DailyQuoteDefinition | null {
  const quotes = orderedDailyQuotes(values)
  if (quotes.length === 0) return null
  let hash = 0
  for (const char of date) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return quotes[hash % quotes.length]
}

function textHash(text: string): string {
  let hash = 0
  for (const char of text) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return hash.toString(36)
}

/**
 * Parse the library text. Ids are stable: a sentence keeps the id it had in
 * `previous` (matched by text), and a new sentence gets a hash-derived id so
 * re-parsing the same text yields the same ids.
 */
export function parseQuoteLibrary(text: string, previous: DailyQuoteDefinition[] = []): DailyQuoteDefinition[] {
  const byText = new Map(previous.map((quote) => [quote.text.trim(), quote]))
  const used = new Set<string>()
  const out: DailyQuoteDefinition[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    let ink = ""
    const inkMatch = INK_RE.exec(line)
    if (inkMatch) {
      ink = inkMatch[1]
      line = line.slice(0, inkMatch.index).trim()
    }
    let body = line
    let author = ""
    const authorMatch = AUTHOR_RE.exec(line)
    if (authorMatch && authorMatch[1].trim()) {
      body = authorMatch[1].trim()
      author = authorMatch[2].trim()
    }
    if (!body) continue
    const kept = byText.get(body)
    let id = kept && !used.has(kept.id) ? kept.id : `q-${textHash(body)}`
    while (used.has(id)) id = `${id}-`
    used.add(id)
    out.push({ id, text: body, author, order: out.length, ...(ink ? { ink } : {}) })
  }
  return out
}

export function serializeQuoteLibrary(values: DailyQuoteDefinition[]): string {
  return orderedDailyQuotes(values)
    .map((quote) => quote.text.trim() + (quote.author.trim() ? ` —— ${quote.author.trim()}` : "") + (quote.ink ? ` #${quote.ink}` : ""))
    .join("\n")
}

/** The slot colour: the sentence's own ink, else the global one; null = untinted. */
export function resolveQuoteInk(
  quote: Pick<DailyQuoteDefinition, "ink"> | null,
  defaultInk: string,
  colors: Record<string, string>
): string | null {
  const name = quote?.ink || defaultInk
  return name && colors[name] ? colors[name] : null
}

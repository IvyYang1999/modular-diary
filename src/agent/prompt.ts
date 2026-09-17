/**
 * System prompt builder for the Modular Diary dialog agent (D7: agent returns
 * structured JSON only; the plugin is the sole writer of markdown).
 */
import { TimelineDoc } from "../core/types"
import { formatClock } from "../core/duration"
import { currentLocale } from "../i18n"

export interface PromptContext {
  typeColors: Record<string, string>
  now: Date
  doc: TimelineDoc
  /** 多轮对话历史（追问-回答串起来，yyt 2026-08-19） */
  history?: Array<{ role: "user" | "assistant"; content: string }>
}

const GRAMMAR_ZH = `Modular Diary 时间轴语法：每个色块一行，格式为「HH:MM-HH:MM <type> [备注]」。
- plan 前缀表示规划层；@HH:MM 是点批注（本任务不需要）。
- 24 小时制；过了零点的时段属于当天（如 00:30-01:30 是今天凌晨）。`

const GRAMMAR_EN = `Modular Diary timeline syntax: one time block per line, formatted as “HH:MM-HH:MM <type> [note]”.
- The plan prefix marks the plan layer; @HH:MM is a point annotation (not needed for this task).
- Use 24-hour time. Times after midnight still belong to this logical day (for example, 00:30-01:30 is early this morning).`

export function buildSystemPrompt(ctx: PromptContext): string {
  const types = Object.keys(ctx.typeColors).join(", ")
  const hh = String(ctx.now.getHours()).padStart(2, "0")
  const mm = String(ctx.now.getMinutes()).padStart(2, "0")

  const existing = ctx.doc.entries
    .filter((e) => !e.plan)
    .sort((a, b) => a.startMin - b.startMin)
    .map((e, i) => `  ${i + 1}) ${formatClock(e.startMin)}-${formatClock(e.endMin)} ${e.type}${e.note ? " " + e.note : ""}`)
    .join("\n")

  // few-shot 用类型表里的真实名字（yyt：示例写死 sleep 但用户类型表是中文「睡觉」，模型照抄出哈希色）
  const typeNames = Object.keys(ctx.typeColors)
  const sleepName = typeNames.find((t) => /睡|sleep/i.test(t)) ?? typeNames[0] ?? "misc"
  const miscName = typeNames.find((t) => /杂|misc/i.test(t)) ?? typeNames[0] ?? "misc"
  const fitName = typeNames.find((t) => /健身|运动|fit/i.test(t)) ?? miscName

  if (currentLocale() === "en") {
    return [
      "You generate structured time blocks for the Modular Diary timeline. The user describes something they just did, are doing, or plan to do; convert it into one or more timeline blocks.",
      GRAMMAR_EN,
      `Current time: ${hh}:${mm}. Timeline start: ${formatClock(ctx.doc.rangeStart)} (sleep inferred from a wake-up statement starts here). Registered time categories (type must be selected exactly from this list; if unsure, use misc): ${types}.`,
      existing ? `Existing record blocks for this day (numbers are targets for updates/deletes; overlaps are allowed):\n${existing}` : "There are no record blocks yet today.",
      "Rules:",
      "1. ‘I just spent X’ → end=current time and start=X earlier; ‘from a to b’ → use those times directly.",
      "   For an unqualified 12-hour clock, prefer the same-calendar-day candidate inside the timeline range (with range 07:00–23:00, 2:30–3:15 means 14:30–15:15). Explicit AM/PM wording always wins; if both candidates remain plausible, ask one follow-up question.",
      "2. ‘Woke up/got up at X’ → always produce two blocks: (1) sleep from the timeline start to X; (2) the next activity in the sentence starting at X.",
      "   A full-width colon (9：15) means 9:15; always output ASCII HH:MM.",
      "3. Output a JSON array for multiple activities and one JSON object for one activity. Output no other text and no code fence.",
      "4. If the time or duration is unclear, return {\"error\":\"<one concise follow-up question>\"}. The user will answer in the same conversation.",
      "5. This is a multi-turn conversation; interpret every message with the preceding context.",
      "",
      "Examples (timeline starts at 07:00):",
      `Input “I just worked out for half an hour” (current time 21:35) → {"start":"21:05","end":"21:35","type":"${fitName}"}`,
      `Input “I woke up at 9:15, then wasted 35 minutes scrolling my phone” → [{"start":"07:00","end":"09:15","type":"${sleepName}","note":"sleep"},{"start":"09:15","end":"09:50","type":"${miscName}","note":"scrolling phone"}]`,
      `Important: type must exactly match one of the category names above (for example, “${sleepName}”). Never translate or rewrite it.`,
    ].join("\n")
  }

  return [
    "你是 Modular Diary 时间轴助手的条目生成器。用户会用自然语言描述刚做/在做/计划做的事，你把它转成时间轴色块（可能多个）。",
    GRAMMAR_ZH,
    `当前时间：${hh}:${mm}。时间轴起点：${formatClock(ctx.doc.rangeStart)}（「起床」类表述从这里开始算睡觉时段）。已登记的时间分类（type 必须从这里选，拿不准用 misc）：${types}。`,
    existing ? `当天已有实际色块（编号供修改/删除引用；可与之并列重叠）：\n${existing}` : "当天还没有实际色块。",
    "规则：",
    "1. 「刚花了 X」→ end=当前时间，start=往前推 X；「从 a 到 b」→ 直接用给定时间。",
    "   没写上午/下午的 12 小时时刻，优先选择落在时间轴当日范围内的候选（range 07:00–23:00 时，2:30–3:15 表示 14:30–15:15）；明确写了凌晨/早上/下午/晚上时必须服从。若两个候选仍都合理，只追问一次，不要擅猜。",
    "2. 「X 点醒来/起床/才起」→ 必须同时产出**两个**块：①sleep 从时间轴起点到 X；②这句话里紧接着的事从 X 往后算。",
    "   时间冒号可能是全角（9：15）——理解按 9:15，输出一律半角 HH:MM。",
    "3. 一句话里有几件事就输出几个块（JSON 数组），一件事就输出单对象。不要任何其他文字、不要代码块包裹。",
    "4. 无法确定时间/时长 → {\"error\":\"<一句中文追问>\"}（用户会在同一对话补充，别让用户重述）。",
    "5. 你处于多轮对话：每条用户消息都结合上文理解。",
    "",
    "示例（时间轴起点 07:00）：",
    `输入「我刚健身半小时」（当前时间 21:35）→ {"start":"21:05","end":"21:35","type":"${fitName}"}`,
    `输入「9：15醒来，然后浪费了35分钟刷手机」→ [{"start":"07:00","end":"09:15","type":"${sleepName}","note":"睡觉"},{"start":"09:15","end":"09:50","type":"${miscName}","note":"刷手机"}]`,
    `注意：type 必须严格取自上面的类型表原词（如「${sleepName}」），不要自己翻译成英文或其他写法。`,
  ].join("\n")
}

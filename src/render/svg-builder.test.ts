import { describe, expect, it } from "vitest"
import { yFromMinutes } from "../core/geometry"
import { parseTimeline } from "../core/parser"
import { fitSideLaneWidth, MAX_SIDE_LANE_BUDGET, MIN_SIDE_LANE_W, renderTimelineSvg, FALLBACK_COLOR, SIDE_LANE_W, truncateLaneText } from "./svg-builder"

const COLORS = { math: "#7fd4c1", sleep: "#e0e0e0" }

function svgOf(source: string, colors = COLORS, width?: number): string {
  return renderTimelineSvg(parseTimeline(source), { typeColors: colors, width })
}

describe("renderTimelineSvg", () => {
  it("renders a block at the right y/height with color and centered duration", () => {
    // range 7-23, hourHeight 48；统一留白 x=2：y+1, 高度-2（yyt 间距规范）
    const svg = svgOf("09:00-12:00 math")
    expect(svg).toContain(`fill="#7fd4c1"`)
    expect(svg).toContain(`y="${yFromMinutes(9 * 60, 7 * 60, 48) + 1}"`)
    expect(svg).toContain(`height="142"`)
    expect(svg).toContain(`>3h</text>`)
  })

  it("renders plan blocks with a faint fill + hatch, underneath actual blocks", () => {
    const svg = svgOf("plan 08:00-10:00 math\n09:00-10:00 math")
    const planIdx = svg.indexOf("oneday-plan")
    const actualIdx = svg.indexOf('fill-opacity="0.95"')
    expect(svg).toContain('fill-opacity="0.12"') // 淡底+彩色描边（深色模式可见性）
    expect(svg).toContain("oneday-plan-hatch") // 斜线纹理区分
    expect(planIdx).toBeGreaterThan(-1)
    expect(planIdx).toBeLessThan(actualIdx) // plan drawn first = behind
    expect(svg).toMatch(/oneday-plan-hatch" data-line="0"/) // edit state can freeze the hatch with its plan
  })

  it("keeps plans behind records even when the source lists the record first", () => {
    const svg = svgOf("09:00-10:00 math\nplan 08:00-11:00 math")
    const planIdx = svg.indexOf('class="oneday-block oneday-plan"')
    const actualIdx = svg.indexOf('class="oneday-block" data-line="0"')
    expect(planIdx).toBeGreaterThan(-1)
    expect(planIdx).toBeLessThan(actualIdx)
  })

  it("keeps the duration centered with adaptive font even for thin blocks (yyt 2026-08-17)", () => {
    const svg = svgOf("17:00-17:30 math") // 30min -> 24px tall
    expect(svg).not.toContain("oneday-duration oneday-thin")
    expect(svg).toMatch(/<text pointer-events="none" class="oneday-duration"[^>]*style="font-size:([\d.]+)px;fill:(?:#[0-9a-f]+|hsl\([^)]+\))"[^>]*>0.5h<\/text>/)
  })

  it("separates duration and note in tall blocks so the note can wrap within the inset", () => {
    const svg = svgOf("09:00-12:00 math 李林线代")
    expect(svg).not.toContain("3h · 李林线代")
    expect(svg).toMatch(/class="oneday-duration"[^>]*>3h<\/text>/)
    expect(svg).toMatch(/class="oneday-note"[^>]*>李林线代<\/text>/)
  })

  it("wraps a short CJK note when an overlapping column is too narrow", () => {
    const svg = svgOf("13:15-15:05 watch 看怪奇物语\n13:30-14:00 math")
    expect(svg).not.toContain("1.83h · 看怪奇物语")
    expect(svg).toMatch(/class="oneday-duration"[^>]*>1.83h<\/text>/)
    expect(svg).toMatch(/class="oneday-note"[^>]*>看怪奇物语<\/text>/)
  })

  it("uses the same inset multiline layout for a plan block", () => {
    const svg = svgOf("plan 09:00-10:00 math 计划备注也应该在色块内部自动换成多行显示出来")
    expect(svg).toMatch(/class="oneday-duration oneday-plan-label"[^>]*>1h<\/text>/)
    expect(svg.match(/class="oneday-note oneday-plan-label"/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("keeps a scheduled Todo title visible inside a compact plan block", () => {
    const svg = svgOf("plan 16:45-17:15 math bonjour更新 [todo:bonjour]")
    expect(svg).toMatch(/class="oneday-duration oneday-plan-label"[^>]*>0\.5h · bonjour更新<\/text>/)
  })

  it("renders annotations in the right label lane (D5 + M4)", () => {
    const svg = svgOf("@21:40 头晕")
    expect(svg).toContain("oneday-anno")
    expect(svg).toContain(">头晕</text>")
  })

  it("renders categorized time markers as colored interactive lines and labels", () => {
    const doc = parseTimeline("@10:00 [deadline] 论文 ddl\nplan @11:00 [meeting] 站会")
    const svg = renderTimelineSvg(doc, { typeColors: { deadline: "#e33", meeting: "#36c" } })
    expect(svg).toContain('class="oneday-marker"')
    expect(svg).toContain('data-line="0"')
    expect(svg).toContain('data-type="deadline"')
    expect(svg).toContain('stroke="#e33"')
    expect(svg).toContain('class="oneday-marker oneday-marker-plan"')
    expect(svg).toContain("论文 ddl")
  })

  it("resolves span and point colors from independent palettes even when names collide", () => {
    const doc = parseTimeline("09:00-10:00 focus\n@09:30 [focus] checkpoint")
    const svg = renderTimelineSvg(doc, {
      typeColors: { focus: "#22aa66" }, markerTypeColors: { focus: "#dd3355" },
    })
    expect(svg).toContain('fill="#22aa66"')
    expect(svg).toContain('class="oneday-marker-line"')
    expect(svg).toContain('stroke="#dd3355"')
  })

  it("stacks same-time markers on distinct adjacent rows", () => {
    const doc = parseTimeline("@10:00 [a] A\n@10:00 [b] B")
    const svg = renderTimelineSvg(doc, { typeColors: { a: "#f00", b: "#00f" } })
    const ys = Array.from(svg.matchAll(/class="oneday-marker(?: [^"]*)?"[^>]* data-marker-y="([^"]+)"/g), (m) => Number(m[1]))
    expect(ys).toHaveLength(2)
    expect(new Set(ys).size).toBe(2)
    expect(Math.abs(ys[1] - ys[0])).toBeLessThanOrEqual(8)
  })

  it("filters actual and plan markers with the same layer contract as duration blocks", () => {
    const doc = parseTimeline("@10:00 [a] actual\nplan @11:00 [b] plan")
    const actual = renderTimelineSvg(doc, { typeColors: { a: "#f00", b: "#00f" }, view: "actual" })
    const plan = renderTimelineSvg(doc, { typeColors: { a: "#f00", b: "#00f" }, view: "plan" })
    expect(actual).toContain('data-type="a"')
    expect(actual).not.toContain('data-type="b"')
    expect(plan).toContain('data-type="b"')
    expect(plan).not.toContain('data-type="a"')
  })

  it("extends the axis past 23 with 24h-wrapped labels (D10, 25->1)", () => {
    const svg = svgOf("00:30-01:30 sleep")
    expect(svg).toContain(">0</text>")
    expect(svg).toContain(">1</text>")
    expect(svg).not.toContain(">25</text>")
  })

  it("unknown types get a deterministic hash color (not gray, yyt 2026-08-17)", () => {
    const svg = svgOf("09:00-10:00 whatever")
    expect(svg).not.toContain(`fill="${FALLBACK_COLOR}"`)
    expect(svg).toContain('fill="hsl(')
    // 同名同色
    expect(svgOf("09:00-10:00 whatever")).toBe(svg)
  })

  it("escapes XML in notes and annotations", () => {
    const svg = svgOf("09:00-10:00 math a<b>&\"c\"")
    expect(svg).not.toContain("a<b>")
    expect(svg).toContain("a&lt;b&gt;")
  })
})

describe("parallel events (并列日程, yyt 2026-08-17)", () => {
  it("splits overlapping blocks into side-by-side columns", () => {
    const svg = svgOf("09:00-11:00 math\n09:30-10:30 micro 听课")
    const rects = [...svg.matchAll(/<rect class="oneday-block"[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/g)]
    expect(rects).toHaveLength(2)
    const [x1, w1] = [Number(rects[0][1]), Number(rects[0][2])]
    const [x2, w2] = [Number(rects[1][1]), Number(rects[1][2])]
    expect(x1).not.toBe(x2) // two columns
    expect(w1).toBeCloseTo(w2, 5)
    expect(w1).toBeLessThan(100) // each narrower than the full track
  })

  it("non-overlapping blocks keep full width", () => {
    const svg = svgOf("09:00-10:00 math\n10:00-11:00 micro")
    const rects = [...svg.matchAll(/<rect class="oneday-block"[^>]*width="([\d.]+)"/g)]
    expect(Number(rects[0][1])).toBeCloseTo(Number(rects[1][1]), 5)
  })

  it("reuses a column after a gap inside the same cluster", () => {
    // A 09-12, B 09:30-10, C 10-12 -> B and C share col 1, total 2 cols
    const svg = svgOf("09:00-12:00 math\n09:30-10:00 micro\n10:00-12:00 english")
    const widths = [...svg.matchAll(/<rect class="oneday-block"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(widths.every((w) => Math.abs(w - widths[0]) < 1e-6)).toBe(true)
  })
})

describe("note visibility (yyt 2026-08-17: 备注必须看得见)", () => {
  it("shows the note on the right side only when even the combined label cannot fit", () => {
    const svg = svgOf("17:00-17:30 meal 晚饭吃太多", COLORS, 60) // 极窄轨道
    expect(svg).toMatch(/oneday-(note oneday-side|duration oneday-thin)/)
    expect(svg).toContain("晚饭吃太多")
  })

  it("narrow tall columns keep duration and note on separate lines", () => {
    const svg = svgOf("09:00-12:00 math\n09:30-11:00 micro\n09:45-10:45 english 背单词打卡")
    expect(svg).not.toContain("1h · 背单词打卡")
    expect(svg).toMatch(/class="oneday-duration"[^>]*>1h<\/text>/)
    expect(svg).toMatch(/class="oneday-note"[^>]*>背单词打<\/text>/)
    expect(svg).toMatch(/class="oneday-note"[^>]*>卡<\/text>/)
  })

  it("truncates long side notes", () => {
    const svg = svgOf("17:00-17:30 meal 这是一段特别特别特别长的备注文字内容")
    expect(svg).toContain("…")
  })
})

describe("time-point lines and block text", () => {
  it("keeps a full-width line when no block with text sits under it", () => {
    const svg = svgOf("@12:00 [deadline] 交周报")
    const lines = [...svg.matchAll(/<line class="oneday-marker-line" x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/g)]
    expect(lines).toHaveLength(1)
    expect(Number(lines[0][1])).toBe(36)
    expect(Number(lines[0][2])).toBe(194)
  })

  it("only paints the line beside a block that shows text at that height", () => {
    const svg = svgOf("09:00-12:00 math 整理笔记\n@10:30 [deadline] 交周报")
    const lines = [...svg.matchAll(/<line class="oneday-marker-line" x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/g)]
    // Two stubs: axis → block edge and block edge → lane (2px gutters).
    expect(lines).toHaveLength(2)
    expect(Number(lines[0][2])).toBe(38)
    expect(Number(lines[1][1])).toBe(192)
    // The hit line and both endpoint dots still span the full row.
    expect(svg).toMatch(/oneday-marker-hit" x1="36" y1="[\d.]+" x2="194"/)
    expect(svg.match(/oneday-marker-dot/g)).toHaveLength(2)
  })

  it("crosses the gap between two parallel columns", () => {
    const svg = svgOf("09:00-12:00 math 线代\n09:00-12:00 micro 微观\n@10:30 [deadline] 交周报")
    const lines = [...svg.matchAll(/<line class="oneday-marker-line" x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/g)]
    expect(lines).toHaveLength(3)
  })
})

describe("label lane (M4)", () => {
  it("widens the svg by the side lane so labels are not clipped", () => {
    const svg = svgOf("17:00-17:30 meal 晚饭")
    expect(svg).toContain('width="312"') // 200 + SIDE_LANE_W(112)
  })

  it("spreads colliding side labels vertically with leader lines", () => {
    // two thin blocks 15min apart, both with notes -> note labels 12px apart < 13px row
    const svg = svgOf("17:00-17:15 meal 晚饭\n17:15-17:30 english 单词", COLORS, 60)
    const leaders = svg.match(/oneday-side-leader/g) ?? []
    expect(leaders.length).toBeGreaterThanOrEqual(1)
    const ys = [...svg.matchAll(/oneday-(?:note oneday-side|duration oneday-thin)"[^>]*x="58" y="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(ys).toHaveLength(2)
    expect(Math.abs(ys[1] - ys[0])).toBeGreaterThanOrEqual(13)
  })

  it("annotations and side labels do not overlap each other", () => {
    // annotation at 17:07 sits on top of the 17:00-17:30 block's side note
    const svg = svgOf("17:00-17:30 meal 晚饭\n@17:07 头晕", COLORS, 60)
    const ys = [...svg.matchAll(/class="oneday-(?:note oneday-side|duration oneday-thin|anno)"[^>]*x="58" y="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(ys).toHaveLength(2)
    expect(Math.abs(ys[1] - ys[0])).toBeGreaterThanOrEqual(13)
  })

  it("extends svg height when pushed-down labels overflow the axis", () => {
    // dense noted cluster right before 23:00 forces labels past the axis bottom
    const svg = svgOf("22:00-22:15 a1 甲\n22:15-22:30 a2 乙\n22:30-22:45 a3 丙\n22:45-23:00 a4 丁\n@22:50 备注", COLORS, 60)
    const height = Number(/<svg[^>]*height="([\d.]+)"/.exec(svg)?.[1])
    expect(height).toBeGreaterThan(784) // default axis bottom + pad = 784
  })
})

describe("M4b: plan hatch + label-block association (yyt 2026-08-17)", () => {
  it("plan blocks get a diagonal hatch overlay (斜线纹理)", () => {
    const svg = svgOf("plan 09:00-12:00 math")
    expect(svg).toContain("<pattern")
    expect(svg).toMatch(/oneday-hatch-\d+-0/) // 每次渲染唯一 id（跨 svg 防冲撞）
    expect(svg).toContain("oneday-plan-hatch")
    expect(svg).toMatch(/fill="url\(#oneday-hatch-\d+-0\)"/)
  })

  it("every noted block's side label draws a leader from its own column edge", () => {
    // 2-column cluster with noted blocks: leaders start at column right edges
    const svg = svgOf("09:00-12:00 math\n09:30-10:00 micro 听课\n09:15-09:30 english 单词", COLORS, 60)
    const leaders = [...svg.matchAll(/<line class="oneday-side-leader[^"]*" data-line="(\d+)" x1="([\d.]+)"/g)]
    expect(leaders.length).toBe(3) // 极窄轨道下无备注的 math 时长也去了侧栏
    expect(Number(leaders[1][2])).toBeLessThan(56) // 贴边布局后列边缘右移（trackW=18+gap）
  })

  it("side labels carry data-line for hover/focus pairing", () => {
    const svg = svgOf("17:00-17:30 meal 晚饭", COLORS, 60)
    expect(svg).toMatch(/class="oneday-(note oneday-side|duration oneday-thin)" data-line="0"/)
  })
})

describe("M5b: single tooltip + tiny-column durations (yyt 2026-08-17)", () => {
  it("renders no SVG <title> (custom tooltip only)", () => {
    expect(svgOf("09:00-10:00 math 行列式")).not.toContain("<title>")
  })

  it("even ~20px columns in a 7-way cluster get a centered tiny duration", () => {
    const src = [
      "14:00-17:00 a1", "14:00-17:30 a2", "14:10-17:00 a3", "14:20-15:10 a4",
      "14:40-18:10 a5", "15:10-18:40 a6", "16:20-19:50 a7",
    ].join("\n")
    const svg = svgOf(src)
    // 7 columns -> w≈20px; durations must be inline (side lane carries notes only)
    expect(svg).not.toContain("oneday-duration oneday-thin")
    const small = [...svg.matchAll(/class="oneday-duration"[^>]*style="font-size:([\d.]+)px;fill:(?:#[0-9a-f]+|hsl\([^)]+\))"/g)].map((m) => Number(m[1]))
    expect(small.length).toBe(7)
    expect(Math.min(...small)).toBeGreaterThanOrEqual(4.5)
  })
})

describe("responsive annotation lane", () => {
  const source = "range: 7-23\n---\n09:00-12:00 math\n@12:00 [deadline] 交周报交周报交周报交周报\n"
  const options = { typeColors: COLORS, markerTypeColors: { deadline: "#ef5b72" }, width: 200 }

  it("fits the lane to the space left beside the fixed track", () => {
    expect(fitSideLaneWidth(600, 200)).toBe(MAX_SIDE_LANE_BUDGET)
    expect(fitSideLaneWidth(200 + SIDE_LANE_W + 20, 200)).toBe(SIDE_LANE_W + 20)
    expect(fitSideLaneWidth(200 + SIDE_LANE_W, 200)).toBe(SIDE_LANE_W)
    expect(fitSideLaneWidth(280, 200)).toBe(80)
    expect(fitSideLaneWidth(200 + MIN_SIDE_LANE_W, 200)).toBe(MIN_SIDE_LANE_W)
    expect(fitSideLaneWidth(200 + MIN_SIDE_LANE_W - 1, 200)).toBe(0)
    expect(fitSideLaneWidth(120, 200)).toBe(0)
    // Unmeasured panes keep the full lane instead of guessing.
    expect(fitSideLaneWidth(0, 200)).toBe(SIDE_LANE_W)
    expect(fitSideLaneWidth(Number.NaN, 200)).toBe(SIDE_LANE_W)
  })

  it("renders the full lane by default inside one replaceable group", () => {
    const svg = renderTimelineSvg(parseTimeline(source), options)
    expect(svg).toContain(`width="${200 + SIDE_LANE_W}"`)
    expect(svg).not.toContain("data-side-lane")
    expect(svg).toMatch(/<g class="oneday-side-lane" data-lane-width="112">.*oneday-marker-label.*<\/g>/)
    expect(svg).toContain(">交周报交周报交周报交周报</text>")
  })

  it("estimates CJK glyphs wider than latin ones when truncating", () => {
    expect(truncateLaneText("交周报", 40)).toBe("交周报")
    expect(truncateLaneText("交周报交周报", 40)).toBe("交周报…")
    expect(truncateLaneText("weekly report", 40)).toBe("weekl…")
  })

  it("narrows the SVG frame and truncates labels for a shrunken lane", () => {
    const svg = renderTimelineSvg(parseTimeline(source), { ...options, sideLaneWidth: 64 })
    expect(svg).toContain(`width="264"`)
    expect(svg).toContain(`viewBox="0 0 264 `)
    expect(svg).toContain(`data-side-lane="64"`)
    expect(svg).toContain(">交周报交…</text>")
    const bg = /class="oneday-marker-label-bg"[^>]*width="([\d.]+)"/.exec(svg)
    expect(Number(bg?.[1])).toBeLessThanOrEqual(64 - 8)
    // Slack beyond the frame lets the wide-pane label keep its full text.
    const roomy = renderTimelineSvg(parseTimeline(source), { ...options, sideLaneWidth: 400 })
    expect(roomy).toContain(`width="${200 + SIDE_LANE_W}"`)
    expect(roomy).toContain(`data-side-lane="${MAX_SIDE_LANE_BUDGET}"`)
    expect(roomy).toContain(">交周报交周报交周报交周报</text>")
  })

  it("hides the lane at width 0 while keeping the markers and the SVG height", () => {
    const full = renderTimelineSvg(parseTimeline(source), options)
    const hidden = renderTimelineSvg(parseTimeline(source), { ...options, sideLaneWidth: 0 })
    expect(hidden).toContain(`width="200"`)
    expect(hidden).toContain('<g class="oneday-side-lane" data-lane-width="0"></g>')
    expect(hidden).not.toContain("oneday-marker-label")
    expect(hidden).toContain('class="oneday-marker"')
    expect(/height="([\d.]+)"/.exec(hidden)?.[1]).toBe(/height="([\d.]+)"/.exec(full)?.[1])
  })
})

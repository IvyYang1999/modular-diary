(() => {
  const $ = (id) => document.getElementById(id)
  const en = document.documentElement.lang === 'en'
  const tr = (zh, english) => en ? english : zh
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const coarse = matchMedia('(pointer:coarse)').matches
  const NS = 'http://www.w3.org/2000/svg'
  const TYPES = [['写作', '#53a3f2'], ['阅读', '#a0c849'], ['英语', '#f4a437'], ['睡觉', '#cfccc4'], ['吃饭', '#f47b74'], ['运动', '#ae7ee2']]
  const TYPE_EN = { 写作: 'Writing', 阅读: 'Reading', 英语: 'English', 睡觉: 'Sleep', 吃饭: 'Meals', 运动: 'Exercise' }
  const typeName = (name) => en ? TYPE_EN[name] : name
  // Same rule as the plugin's blockTextColor: vivid fills (HSL s >= .45, WCAG luminance < .52) take white copy.
  const copyOn = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(...c), mn = Math.min(...c), l = (mx + mn) / 2
    const sat = mx === mn ? 0 : (mx - mn) / (l > .5 ? 2 - mx - mn : mx + mn), f = (v) => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
    return sat >= .45 && .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]) < .52 ? '#fff' : 'rgba(28,28,26,.76)' }
  const HEX = Object.fromEntries(TYPES)
  const R0 = 7, R1 = 23, SNAP = 15
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const hrs = (m) => { const h = m / 60; return (Number.isInteger(h) ? h : +h.toFixed(2)) + 'h' }
  const dur = (m) => (m < 60 ? m + 'm' : hrs(m))
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n }
  const h = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n }

  /* overlap → side-by-side columns (same idea as the plugin's interval clustering) */
  function columns(list) {
    const sorted = [...list].sort((a, b) => a.s - b.s || b.e - a.e)
    const out = []; let cluster = [], ends = [], clusterEnd = -1
    const flush = () => { const n = ends.length; cluster.forEach((c) => out.push({ ...c, n })); cluster = []; ends = [] }
    for (const x of sorted) {
      if (cluster.length && x.s >= clusterEnd) flush()
      let col = ends.findIndex((e) => e <= x.s); if (col < 0) { col = ends.length; ends.push(0) }
      ends[col] = x.e; clusterEnd = Math.max(clusterEnd, x.e); cluster.push({ ...x, col })
    }
    flush(); return out
  }
  function hatchDefs(svg, id) {
    const defs = el('defs', {}, svg)
    TYPES.forEach(([, hex], i) => {
      const p = el('pattern', { id: `${id}-${i}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs)
      el('rect', { width: 6, height: 6, fill: hex, opacity: .28 }, p)
      el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: hex, 'stroke-width': 1.8, opacity: 1 }, p)
    })
  }
  const hatch = (id, t) => `url(#${id}-${TYPES.findIndex(([n]) => n === t)})`

  /* ── state ── */
  const HH = 30, LW = 30, PT = 12, PB = 12, W = 284, GAP = 2, SIDE = 64
  const TW = W - LW - 6 - SIDE
  const yOf = (m) => PT + (m - R0 * 60) * HH / 60
  const mOf = (y) => R0 * 60 + (y - PT) * 60 / HH
  const snap = (m) => Math.max(R0 * 60, Math.min(R1 * 60, Math.round(m / SNAP) * SNAP))
  const INITIAL = () => ([
    { s: 540, e: 720, t: '写作', plan: true },
    { s: 420, e: 510, t: '睡觉', note: tr('赖床', 'Slept in') },
    { s: 555, e: 705, t: '写作', note: tr('第三章初稿', 'Chapter draft'), todo: 't1' },
    { s: 705, e: 750, t: '吃饭' },
    { s: 750, e: 810, t: '阅读' },
  ])
  const TODOS = () => ([
    { id: 't1', title: tr('第三章初稿', 'Draft chapter three'), type: '写作', est: 240, done: false },
    { id: 't2', title: tr('背 list 5', 'Study word list 5'), type: '英语', est: 45, done: false },
  ])
  const HABITS = [{ name: tr('运动半小时', 'Exercise for 30 minutes'), type: '运动', target: 30 }, { name: tr('阅读一小时', 'Read for an hour'), type: '阅读', target: 60 }]
  const MODS = [
    { id: 'text', name: tr('文字', 'Text'), c: 'var(--ink)' }, { id: 'todos', name: tr('待办', 'To-dos'), c: 'var(--amber)' }, { id: 'habits', name: tr('打卡', 'Habits'), c: 'var(--green)' },
    { id: 'quote', name: tr('每日一句', 'Daily quote'), c: 'var(--violet)' }, { id: 'stats', name: tr('统计', 'Stats'), c: 'var(--red)' }, { id: 'capture', name: tr('快速记录', 'Quick capture'), c: 'var(--ink-2)' },
  ]
  let entries = INITIAL(), todos = TODOS(), enabled = new Set(MODS.map((m) => m.id)), order = MODS.map((m) => m.id)
  let pen = '写作', plan = false, sel = -1, lastNew = -1, ghost = null, autoplayOn = true, run = 0, dragTodo = null, habitDone = {}
  const tl = $('tl'), status = $('status'), src = $('src'), pop = $('pop'), popIn = $('popIn'), menu = $('menu'), toast = $('toast'), mods = $('mods')
  const HINT = coarse ? tr('手机上先看演示，桌面端再来摆', 'Explore the demo here; arrange blocks on desktop') : tr('按住拖一下记一段；点两下色块写备注，右键有更多', 'Drag to record time; double-click a block for a note, right-click for more')

  /* ── module switchboard ── */
  function renderSwitch() {
    const box = $('switch'); box.querySelectorAll('.chip').forEach((n) => n.remove())
    const mk = (m, locked) => {
      const b = h('button', 'chip', `<i></i>${m.name}`); b.type = 'button'; b.style.setProperty('--c', m.c)
      b.setAttribute('aria-pressed', String(locked || enabled.has(m.id)))
      if (locked) { b.disabled = true; b.title = tr('时间轴是底座，一直在', 'The timeline is the base and stays on') }
      else b.addEventListener('click', () => { autoplayOn = false; enabled.has(m.id) ? enabled.delete(m.id) : enabled.add(m.id); renderSwitch(); renderMods(); renderSrc() })
      box.appendChild(b)
    }
    mk({ id: 'timeline', name: tr('时间轴', 'Timeline'), c: 'var(--blue)' }, true); MODS.forEach((m) => mk(m, false))
  }

  /* ── left column: the modules ── */
  const actualOf = (todoId) => entries.filter((x) => !x.plan && x.todo === todoId).reduce((a, x) => a + x.e - x.s, 0)
  const typeMinutes = (t) => entries.filter((x) => !x.plan && x.t === t).reduce((a, x) => a + x.e - x.s, 0)
  function renderMods() {
    mods.innerHTML = ''
    for (const id of order) {
      if (!enabled.has(id)) continue
      const m = MODS.find((x) => x.id === id)
      const sec = h('section', `mod mod-${id}`); sec.dataset.id = id; sec.style.setProperty('--c', m.c)
      const head = h('header', '', `<i></i>${id === 'habits' ? tr('今日打卡', 'Today’s habits') : id === 'todos' ? tr('待办清单', 'To-do list') : m.name}<small></small><span class="grip" aria-hidden="true">⋮⋮</span>`)
      head.draggable = !coarse
      head.addEventListener('dragstart', (e) => { autoplayOn = false; e.dataTransfer.setData('text/x-mod', id); e.dataTransfer.effectAllowed = 'move'; sec.classList.add('dragging') })
      head.addEventListener('dragend', () => { sec.classList.remove('dragging'); mods.querySelectorAll('.over').forEach((n) => n.classList.remove('over')) })
      sec.addEventListener('dragover', (e) => { if (![...e.dataTransfer.types].includes('text/x-mod')) return; e.preventDefault(); sec.classList.add('over') })
      sec.addEventListener('dragleave', () => sec.classList.remove('over'))
      sec.addEventListener('drop', (e) => {
        const d = e.dataTransfer.getData('text/x-mod'); if (!d || d === id) return; e.preventDefault()
        const from = order.indexOf(d), to = order.indexOf(id); order.splice(from, 1); order.splice(to, 0, d); renderMods(); renderSrc()
      })
      sec.appendChild(head)
      const small = head.querySelector('small')
      if (id === 'text') sec.appendChild(h('div', 'mod-text', tr('<p>上午别开消息，写完再看。<br>饭后立刻回到桌前。</p>', '<p>No messages until the writing is done.<br>Get back to the desk after lunch.</p>')))
      if (id === 'todos') {
        small.textContent = `${todos.filter((t) => t.done).length}/${todos.length}`
        todos.forEach((t) => {
          const act = actualOf(t.id)
          const row = h('div', 'row todo' + (t.done ? ' done' : ''), `<input type="checkbox" ${t.done ? 'checked' : ''} aria-label="${tr('完成', 'Complete')} ${t.title}"><span class="dot" style="--k:${HEX[t.type]}"></span><span class="t">${t.title}</span><span class="m">${act ? tr('实际 ', 'Actual ') + dur(act) + ' / ' : ''}${tr('预计 ', 'Planned ')}${dur(t.est)}</span>`)
          row.draggable = !coarse
          row.addEventListener('dragstart', (e) => { autoplayOn = false; dragTodo = t; e.dataTransfer.setData('text/x-todo', t.id); e.dataTransfer.effectAllowed = 'copy' })
          row.addEventListener('dragend', () => { dragTodo = null; if (ghost) { ghost = null; paintGhost() } })
          row.querySelector('input').addEventListener('change', (e) => { t.done = e.target.checked; renderMods(); renderSrc() })
          sec.appendChild(row)
          if (act) { const p = h('div', 'prog', `<i style="--k:${HEX[t.type]};width:${Math.min(100, act / t.est * 100).toFixed(0)}%"></i>`); sec.appendChild(p) }
        })
        if (!coarse) sec.appendChild(h('p', 'hintline', tr('把一条待办拖到右边的时间轴上，它就成了一段计划。', 'Drag a to-do onto the timeline to turn it into a plan.')))
      }
      if (id === 'habits') {
        let ok = 0
        HABITS.forEach((hb) => {
          const min = typeMinutes(hb.type), done = min >= hb.target; if (done) ok++
          const row = h('div', 'row', `<span class="dot" style="--k:${HEX[hb.type]}"></span><span class="t">${hb.name}</span><span class="m">${dur(min)} / ${dur(hb.target)}</span><span class="badge${done ? ' ok' : ''}">${done ? tr('✓ 已打卡', '✓ Done') : tr('尚未打卡', 'Not yet')}</span>`)
          if (done && habitDone[hb.name] === false) row.classList.add('pulse')
          habitDone[hb.name] = done
          sec.appendChild(row)
          sec.appendChild(h('div', 'prog', `<i style="--k:${HEX[hb.type]};width:${Math.min(100, min / hb.target * 100).toFixed(0)}%"></i>`))
        })
        small.textContent = `${ok}/${HABITS.length}`
      }
      if (id === 'quote') { sec.classList.add('mod-quote'); sec.appendChild(h('div', '', tr('<p>成效的关键时刻：13 天，坚持下去。</p><span>考研日记 · 8.18</span>', '<p>The work that matters starts with showing up. Keep going.</p><span>Study journal · Aug 18</span>'))) }
      if (id === 'stats') {
        const sum = {}; for (const x of entries) if (!x.plan && x.t !== '睡觉') sum[x.t] = (sum[x.t] || 0) + (x.e - x.s)
        const rows = Object.entries(sum).sort((a, b) => b[1] - a[1]); const max = Math.max(1, ...rows.map((r) => r[1]))
        sec.appendChild(h('div', 'stats', rows.map(([t, m]) => `<span>${typeName(t)}</span><span class="meter"><i style="--k:${HEX[t]};width:${(m / max * 100).toFixed(0)}%"></i></span><span class="hr">${hrs(m)}</span>`).join('')))
      }
      if (id === 'capture') {
        const f = h('form', 'qc', tr('<input id="qi" placeholder="快速记录：刚跑步半小时…" aria-label="快速记录"><button type="submit" id="qgo">记录</button>', '<input id="qi" placeholder="Just ran for half an hour…" aria-label="Quick capture"><button type="submit" id="qgo">Record</button>')); f.autocomplete = 'off'
        const qi = f.querySelector('input')
        qi.addEventListener('focus', () => { f.classList.add('focus'); autoplayOn = false }); qi.addEventListener('blur', () => f.classList.remove('focus'))
        f.addEventListener('submit', (e) => { e.preventDefault(); submitQC(qi.value) })
        sec.appendChild(f)
      }
      mods.appendChild(sec)
    }
    if (!mods.children.length) mods.appendChild(h('p', 'hintline', tr('所有模块都收起来了，只剩时间轴。点上面的圆点把它们摆回来。', 'Only the timeline is left. Use the toggles above to bring modules back.')))
  }

  /* ── timeline ── */
  function renderPens() {
    const box = $('pens'); box.innerHTML = ''
    for (const [n, hex] of TYPES) { const b = h('button', 'pen' + (n === pen ? ' on' : ''), `<i></i>${typeName(n)}`); b.type = 'button'; b.style.setProperty('--k', hex); b.addEventListener('click', () => { pen = n; renderPens() }); box.appendChild(b) }
  }
  $('seg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return
    plan = b.dataset.mode === 'plan'; $('seg').dataset.plan = plan ? '1' : '0'
    ;[...$('seg').children].forEach((x) => x.classList.toggle('on', x === b))
    status.textContent = plan ? tr('计划模式：画出来的是斜线块，之后被真实色块盖过去', 'Plan mode: draw hatched blocks; actual time will appear on top') : HINT
  })
  /* The track redraws on its own during a gesture: rebuilding the modules mid-drag would
     destroy the todo row being dragged, and the browser cancels the drag with it. */
  function render() { renderTimeline(); renderMods(); renderSrc() }
  function renderTimeline() {
    tl.innerHTML = ''
    const H = PT + (R1 - R0) * HH + PB
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, tl); hatchDefs(svg, 'h')
    el('rect', { x: LW, y: PT, width: TW, height: (R1 - R0) * HH, fill: 'transparent', class: 'blk' }, svg)
    for (let hr = R0; hr <= R1; hr++) { const y = yOf(hr * 60); el('line', { x1: LW, y1: y, x2: LW + TW, y2: y, class: 'hl' }, svg); el('text', { x: LW - 6, y: y + 4, 'text-anchor': 'end', class: 'hourlabel' }, svg).textContent = hr }
    el('rect', { x: LW, y: PT, width: TW, height: (R1 - R0) * HH, class: 'frame' }, svg)
    entries.forEach((x, i) => { if (!x.plan) return
      const g = el('g', { class: 'ent-g' + (i === sel ? ' sel' : ''), 'data-i': i }, svg)
      el('rect', { x: LW + 1, y: yOf(x.s) + 1, width: TW - 2, height: yOf(x.e) - yOf(x.s) - 2, rx: 3, fill: hatch('h', x.t), class: 'ent' }, g)
      const lbl = `${tr('计划', 'Plan')} · ${x.note || typeName(x.t)}`; el('text', { x: LW + TW / 2, y: (yOf(x.s) + yOf(x.e)) / 2 + 4, 'text-anchor': 'middle', class: 'nt' }, g).textContent = lbl.length > (en ? 21 : 12) ? lbl.slice(0, en ? 21 : 12) + '…' : lbl
    })
    for (const x of columns(entries.map((x, i) => ({ ...x, i })).filter((x) => !x.plan))) {
      const cw = (TW - 2 - GAP * (x.n - 1)) / x.n, cx = LW + 1 + x.col * (cw + GAP), y0 = yOf(x.s) + 1, hh = Math.max(4, yOf(x.e) - yOf(x.s) - 2)
      const g = el('g', { class: 'ent-g' + (x.i === sel ? ' sel' : ''), 'data-i': x.i }, svg)
      el('rect', { x: cx, y: y0, width: cw, height: hh, rx: 3, fill: HEX[x.t], class: 'ent' }, g)
      const thin = hh < 30
      el('text', { x: cx + cw / 2, y: y0 + hh / 2 + (thin || !x.note ? 4 : -2), 'text-anchor': 'middle', class: 'dur', style: `fill:${copyOn(HEX[x.t])}` }, g).textContent = hrs(x.e - x.s)
      if (x.note) {
        if (thin || cw < 90) el('text', { x: LW + TW + 4, y: y0 + hh / 2 + 4, class: 'side' }, g).textContent = x.note.length > (en ? 12 : 6) ? x.note.slice(0, en ? 12 : 6) + '…' : x.note
        else el('text', { x: cx + cw / 2, y: y0 + hh / 2 + 13, 'text-anchor': 'middle', class: 'nt', style: `fill:${copyOn(HEX[x.t])}` }, g).textContent = x.note.length > (en ? 21 : 10) ? x.note.slice(0, en ? 21 : 10) + '…' : x.note
      }
    }
    if (ghost) {
      const a = Math.min(ghost.s, ghost.e), b = Math.max(ghost.s, ghost.e)
      el('rect', { x: LW + 1, y: yOf(a), width: TW - 2, height: Math.max(2, yOf(b) - yOf(a)), rx: 3, class: 'ghost' }, svg).style.setProperty('--k', HEX[ghost.t || pen])
      if (b > a) el('text', { x: LW + TW / 2, y: (yOf(a) + yOf(b)) / 2 + 4, 'text-anchor': 'middle', class: 'ghostlbl' }, svg).textContent = hrs(b - a)
    }
  }
  /* Update the ghost in place. Rebuilding the SVG under the pointer mid-drag removes the
     element the browser chose as drop target, and the drop never fires. */
  function paintGhost() {
    const svg = tl.querySelector('svg'); if (!svg) return
    let r = svg.querySelector('rect.ghost'), t = svg.querySelector('text.ghostlbl')
    if (!ghost) { r?.remove(); t?.remove(); return }
    if (!r) { r = el('rect', { x: LW + 1, width: TW - 2, rx: 3, class: 'ghost' }, svg); t = el('text', { x: LW + TW / 2, 'text-anchor': 'middle', class: 'ghostlbl' }, svg) }
    const a = Math.min(ghost.s, ghost.e), b = Math.max(ghost.s, ghost.e)
    r.setAttribute('y', yOf(a)); r.setAttribute('height', Math.max(2, yOf(b) - yOf(a))); r.style.setProperty('--k', HEX[ghost.t || pen])
    t.setAttribute('y', (yOf(a) + yOf(b)) / 2 + 4); t.textContent = b > a ? hrs(b - a) : ''
  }
  function renderSrc() {
    const rowsOf = { text: 4, todos: 5, habits: 5, quote: 3, stats: 4, capture: 3 }, slot = { capture: 'dialog' }
    let y = 0; const layout = order.filter((id) => enabled.has(id)).map((id) => { const s = `${slot[id] || id}@0,${y},6,${rowsOf[id]}`; y += rowsOf[id]; return s }).concat('timeline@6,0,6,45').join(' ')
    const lines = ['<span class="k">```timeline</span>', '<span class="k">date: 2026-09-05</span>', '<span class="k">range: 7-23</span>', `<span class="k">layout: ${layout}</span>`]
    if (enabled.has('todos')) for (const t of todos) lines.push(`<span class="at">todo:</span> id="${t.id}" done=${t.done} estimate=${t.est} category="${typeName(t.type)}" title="${t.title}"`)
    lines.push('<span class="k">---</span>')
    for (const x of entries.map((x, i) => ({ ...x, i })).sort((a, b) => a.s - b.s || (a.plan ? 0 : 1) - (b.plan ? 0 : 1))) {
      const line = `${x.plan ? '<span class="k">plan</span> ' : ''}${fmt(x.s)}-${fmt(x.e)} ${typeName(x.t)}${x.note ? ' ' + escapeHtml(x.note) : ''}${x.todo ? ` <span class="at">[todo:${x.todo}]</span>` : ''}`
      lines.push(x.i === lastNew ? `<span class="new">${line}</span>` : line)
    }
    if (enabled.has('text')) lines.push('<span class="k">===</span>', tr('上午别开消息，写完再看。', 'No messages until the writing is done.'), tr('饭后立刻回到桌前。', 'Get back to the desk after lunch.'))
    lines.push('<span class="k">```</span>')
    src.innerHTML = lines.join('\n')
  }
  $('srcBtn').addEventListener('click', () => { const on = $('body').classList.toggle('source'); $('srcBtn').classList.toggle('on', on) })

  /* drawing: press = select, drag = draw, a second press within 350ms = note */
  const setSel = (i) => { sel = i; tl.querySelectorAll('.ent-g').forEach((g) => g.classList.toggle('sel', +g.dataset.i === i)) }
  const posM = (ev) => mOf(ev.clientY - tl.querySelector('svg').getBoundingClientRect().top)
  let drawing = null, lastDown = { i: -1, t: 0 }
  tl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    closeFloat(); autoplayOn = false
    const g = ev.target.closest('.ent-g'); if (!g && !ev.target.classList.contains('blk')) return
    const idx = g ? +g.dataset.i : -1
    if (ev.pointerType === 'touch') { setSel(idx); return }
    if (idx >= 0 && idx === lastDown.i && ev.timeStamp - lastDown.t < 350) { ev.preventDefault(); lastDown = { i: -1, t: 0 }; openNote(idx, ev); return }
    lastDown = { i: idx, t: ev.timeStamp }
    drawing = { s: snap(posM(ev)), hit: idx, moved: false }; ghost = null; tl.setPointerCapture(ev.pointerId)
  })
  tl.addEventListener('pointermove', (ev) => {
    if (!drawing) return
    const e = snap(posM(ev)); if (!drawing.moved && e === drawing.s) return
    drawing.moved = true; if (ghost && e === ghost.e) return
    ghost = { s: drawing.s, e }; paintGhost()
    const a = Math.min(drawing.s, e), b = Math.max(drawing.s, e)
    status.innerHTML = b > a ? `<b>${fmt(a)}–${fmt(b)}</b> · ${hrs(b - a)} · ${plan ? tr('计划', 'Plan: ') : ''}${typeName(pen)}` : tr(`起点 <b>${fmt(a)}</b>，拖到终点`, `Start <b>${fmt(a)}</b>; drag to the end`)
  })
  const endDraw = () => {
    if (!drawing) return
    const d = drawing; drawing = null
    if (!d.moved) { ghost = null; setSel(d.hit); status.textContent = d.hit >= 0 ? tr('再点一下写备注，右键有更多；Delete 删除', 'Click again to add a note; right-click for more, or press Delete') : HINT; return }
    const a = Math.min(d.s, ghost.e), b = Math.max(d.s, ghost.e); ghost = null
    if (b - a >= SNAP) { entries.push({ s: a, e: b, t: pen, plan }); lastNew = entries.length - 1; sel = lastNew; showToast(en ? `${plan ? 'Planned' : 'Recorded'} ${fmt(a)}–${fmt(b)} ${typeName(pen)} · saved to note` : `${plan ? '计划' : '记录'} ${fmt(a)}–${fmt(b)} ${pen} · 已写回笔记`) }
    status.textContent = HINT; render()
  }
  tl.addEventListener('pointerup', endDraw); tl.addEventListener('pointercancel', endDraw)
  /* a todo dropped on the track becomes a plan block bound to it */
  tl.addEventListener('dragover', (ev) => {
    if (!dragTodo) return; ev.preventDefault()
    const s = Math.min(snap(posM(ev)), R1 * 60 - SNAP), e = Math.min(R1 * 60, s + dragTodo.est)
    if (ghost && ghost.s === s) return
    ghost = { s, e, t: dragTodo.type }; paintGhost(); status.innerHTML = en ? `Schedule “${dragTodo.title}” for <b>${fmt(s)}–${fmt(e)}</b>` : `把「${dragTodo.title}」排在 <b>${fmt(s)}–${fmt(e)}</b>`
  })
  tl.addEventListener('drop', (ev) => {
    if (!dragTodo || !ghost) return; ev.preventDefault()
    entries.push({ s: ghost.s, e: ghost.e, t: dragTodo.type, plan: true, note: dragTodo.title, todo: dragTodo.id }); lastNew = entries.length - 1
    showToast(en ? `Planned “${dragTodo.title}” for ${fmt(ghost.s)}–${fmt(ghost.e)}` : `「${dragTodo.title}」已排成计划 ${fmt(ghost.s)}–${fmt(ghost.e)}`); ghost = null; dragTodo = null; status.textContent = HINT; render()
  })
  tl.addEventListener('contextmenu', (ev) => {
    const g = ev.target.closest('.ent-g'); if (!g) return; ev.preventDefault()
    const i = +g.dataset.i, x = entries[i]; setSel(i); menu.innerHTML = ''
    const add = (label, fn, cls) => { const b = h('button', cls || '', label); b.addEventListener('click', () => { closeFloat(); fn() }); menu.appendChild(b) }
    add(x.note ? tr('修改备注', 'Edit note') : tr('添加备注', 'Add note'), () => openNote(i, ev))
    add(x.plan ? tr('转为实际记录', 'Mark as actual') : tr('转为计划', 'Turn into a plan'), () => { x.plan = !x.plan; lastNew = i; render() })
    for (const t of todos.filter((t) => t.type === x.t)) add(x.todo === t.id ? (en ? `Unlink “${t.title}”` : `取消绑定「${t.title}」`) : (en ? `Link to-do “${t.title}”` : `绑定待办「${t.title}」`), () => { x.todo = x.todo === t.id ? undefined : t.id; lastNew = i; render() })
    add(tr('删除', 'Delete block'), () => { entries.splice(i, 1); sel = -1; lastNew = -1; render() }, 'danger')
    place(menu, ev); menu.classList.add('on')
  })
  document.addEventListener('keydown', (ev) => {
    if (sel < 0 || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
    if (ev.key === 'Delete' || ev.key === 'Backspace') { entries.splice(sel, 1); sel = -1; lastNew = -1; render() }
    if (ev.key === 'Escape') { setSel(-1); closeFloat() }
  })
  function place(node, ev) { const r = $('demo').getBoundingClientRect(); node.style.left = Math.min(ev.clientX - r.left, r.width - 220) + 'px'; node.style.top = Math.min(ev.clientY - r.top + 6, r.height - 90) + 'px' }
  let noteIdx = -1
  function openNote(i, ev) { noteIdx = i; popIn.value = entries[i].note || ''; place(pop, ev); pop.classList.add('on'); popIn.focus(); popIn.select() }
  popIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { entries[noteIdx].note = popIn.value.trim(); lastNew = noteIdx; closeFloat(); render() } if (ev.key === 'Escape') closeFloat() })
  popIn.addEventListener('blur', () => setTimeout(() => pop.classList.remove('on'), 120))
  function closeFloat() { pop.classList.remove('on'); menu.classList.remove('on') }
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.menu,.pop')) menu.classList.remove('on'); if (sel >= 0 && !ev.target.closest('#tl,.menu,.pop')) setSel(-1) })

  /* quick capture: a tiny stand-in for the model call */
  const DEMO_NOW = 16 * 60 + 30
  function parseEN(text) {
    const type = /\b(run|ran|running|exercise|workout|walk|swim|cycle|yoga)\b/i.test(text) ? '运动'
      : /\b(write|wrote|writing|draft|code|coded|coding)\b/i.test(text) ? '写作'
      : /\b(english|vocab|words|language)\b/i.test(text) ? '英语'
      : /\b(read|reading|book|study|studied)\b/i.test(text) ? '阅读'
      : /\b(eat|ate|lunch|dinner|breakfast|meal|coffee)\b/i.test(text) ? '吃饭'
      : /\b(sleep|slept|nap|napped)\b/i.test(text) ? '睡觉' : '阅读'
    const range = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\b/i)
    let start, end
    if (range) {
      start = Number(range[1]) * 60 + Number(range[2] || 0)
      end = Number(range[3]) * 60 + Number(range[4] || 0)
      if (end <= start || start < R0 * 60 || end > R1 * 60) return null
    } else {
      const amount = text.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i)
      const d = /\bhalf an? hour\b/i.test(text) ? 30 : /\b(an?|one) hour\b/i.test(text) ? 60 : /\btwo hours?\b/i.test(text) ? 120
        : amount ? Math.round(Number(amount[1]) * (/^(h|hour|hr)/i.test(amount[2]) ? 60 : 1)) : 0
      if (!d) return null
      end = snap(DEMO_NOW); start = Math.max(R0 * 60, end - d)
    }
    const note = /\b(run|ran|running|jog|jogged)\b/i.test(text) ? 'Run'
      : text.replace(range?.[0] || '', '').replace(/\b(just|i|for|a|an|half|one|two|hour|hours|minutes?|mins?|h|m)\b/gi, '').replace(/\d+/g, '').trim().slice(0, 32)
    return { s: start, e: end, t: type, note }
  }
  function parseNL(text) {
    if (en) return parseEN(text)
    const type = /跑|健身|运动|游泳|骑|走路|散步|瑜伽/.test(text) ? '运动' : /写|稿|文章|改/.test(text) ? '写作' : /英|单词|听力|list/i.test(text) ? '英语' : /读|书|看/.test(text) ? '阅读' : /饭|吃|餐|咖啡/.test(text) ? '吃饭' : /睡|午休|躺/.test(text) ? '睡觉' : '阅读'
    let start, end, m
    const clock = (hh, mm, half) => (+hh % 24) * 60 + (mm ? +mm : half ? 30 : 0)
    const RANGE = /(\d{1,2})\s*[:：点]\s*(\d{2})?\s*(半)?\s*[-–—~到至]\s*(\d{1,2})\s*[:：点]?\s*(\d{2})?\s*(半)?/
    if ((m = text.match(RANGE))) {
      start = clock(m[1], m[2], m[3]); end = clock(m[4], m[5], m[6])
      if (end <= start) end += 720
      if (start < R0 * 60) { start += 720; end += 720 }
      if (end > R1 * 60) return null
    } else {
      let d = 0
      if ((m = text.match(/(\d+(?:\.\d+)?)\s*(小时|h|H)/))) d = Math.round(+m[1] * 60)
      if (!d && (m = text.match(/(\d+)\s*(分钟|分|min)/))) d = +m[1]
      if (!d && /半小时|半个小时/.test(text)) d = 30
      if (!d && /一小时|一个小时/.test(text)) d = 60
      if (!d && /两小时|两个小时/.test(text)) d = 120
      if (!d) return null
      end = snap(DEMO_NOW); start = Math.max(R0 * 60, end - d)
    }
    let note = text.replace(/^(我|刚刚|刚才|刚|今天)+/, '').replace(new RegExp(RANGE.source, 'g'), '')
      .replace(/(了)?(半小时|半个小时|一小时|一个小时|两小时|两个小时|\d+(?:\.\d+)?\s*(小时|分钟|分|h|min))/g, '').replace(/^[，,、的了\s]+|[，,、。的了\s]+$/g, '')
    if (note.length < 2) note = ''
    return { s: start, e: end, t: type, note: note.slice(0, 12) }
  }
  function submitQC(text) {
    text = text.trim(); if (!text) return
    const my = run, go = $('qgo'); if (go) { go.disabled = true; go.textContent = tr('生成中…', 'Working…') }
    setTimeout(() => {
      if (my !== run) return
      const r = parseNL(text)
      if (!r) { const g2 = $('qgo'); if (g2) { g2.disabled = false; g2.textContent = tr('记录', 'Record') } showToast(tr('它会追问一句：这件事花了多久？', 'How long did that take? Add a duration to try it here.')); return }
      const before = HABITS.filter((hb) => typeMinutes(hb.type) >= hb.target).length
      entries.push(r); lastNew = entries.length - 1; sel = lastNew; render()
      const hit = HABITS.find((hb) => hb.type === r.t && typeMinutes(hb.type) >= hb.target)
      showToast(hit && HABITS.filter((hb) => typeMinutes(hb.type) >= hb.target).length > before
        ? (en ? `Saved ${fmt(r.s)}–${fmt(r.e)} ${typeName(r.t)} · “${hit.name}” checked off` : `已记录 ${fmt(r.s)}–${fmt(r.e)} ${r.t} · 「${hit.name}」自动打卡`)
        : (en ? `Saved one block: ${fmt(r.s)}–${fmt(r.e)} ${typeName(r.t)}` : `已记录 1 条：${fmt(r.s)}–${fmt(r.e)} ${r.t}`))
    }, reduce ? 50 : 700)
  }
  let toastT; function showToast(t) { toast.textContent = t; toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 2600) }

  /* autoplay: a todo becomes a plan, then one sentence ticks a habit */
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms))
  async function play(force) {
    if (!force && !autoplayOn) return
    const my = ++run; entries = INITIAL(); todos = TODOS(); enabled = new Set(MODS.map((m) => m.id)); order = MODS.map((m) => m.id); sel = -1; lastNew = -1; ghost = null; habitDone = {}; autoplayOn = true
    renderSwitch(); render(); status.textContent = HINT
    await sleep(1100); if (my !== run || !autoplayOn) return
    const t = todos[1], s = 15 * 60
    const row = mods.querySelectorAll('.mod-todos .todo')[1]; if (row) row.style.background = 'var(--bg-2)'
    for (let k = 1; k <= 3; k++) { if (my !== run || !autoplayOn) return; ghost = { s, e: s + Math.round(t.est * k / 3 / SNAP) * SNAP, t: t.type }; paintGhost(); status.innerHTML = en ? `Schedule “${t.title}” for <b>${fmt(s)}–${fmt(s + t.est)}</b>` : `把「${t.title}」排在 <b>${fmt(s)}–${fmt(s + t.est)}</b>`; await sleep(220) }
    ghost = null; entries.push({ s, e: s + t.est, t: t.type, plan: true, note: t.title, todo: t.id }); lastNew = entries.length - 1; render()
    showToast(en ? `Planned “${t.title}” for 15:00–15:45` : `「${t.title}」已排成计划 15:00–15:45`); status.textContent = HINT
    await sleep(1700); if (my !== run || !autoplayOn) return
    const qi = $('qi'); if (!qi) return
    const text = tr('刚跑步半小时', 'Just ran for half an hour'); qi.closest('.qc').classList.add('focus')
    for (let i = 1; i <= text.length; i++) { if (my !== run || !autoplayOn) return; qi.value = text.slice(0, i); await sleep(90) }
    await sleep(350); if (my !== run || !autoplayOn) return
    submitQC(text)
  }
  $('replay').addEventListener('click', () => play(true))

  renderSwitch(); renderPens(); render(); status.textContent = HINT
  let played = false
  new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && !played && autoplayOn) { played = true; play() } }, { threshold: .15, rootMargin: '0px 0px -15% 0px' }).observe($('demo'))

  /* ── small timelines: the module card and the three people ── */
  function mini(list, id, { w = 104, hh = 14, r0 = R0, r1 = R1, every = 2 } = {}) {
    const lw = 16, pt = 6, H = pt + (r1 - r0) * hh + 6, tw = w - lw - 2, y = (m) => pt + (m - r0 * 60) * hh / 60
    const svg = el('svg', { viewBox: `0 0 ${w} ${H}`, class: 'mini', 'aria-hidden': 'true' }); hatchDefs(svg, id)
    for (let hr = r0; hr <= r1; hr += every) { const yy = y(hr * 60); el('line', { x1: lw, y1: yy, x2: w, y2: yy, stroke: '#e9e9e5' }, svg); el('text', { x: lw - 3, y: yy + 3, 'text-anchor': 'end', 'font-size': 7.5, fill: '#75756f' }, svg).textContent = hr }
    const clip = (x) => ({ ...x, s: Math.max(x.s, r0 * 60), e: Math.min(x.e, r1 * 60) })
    const vis = list.map(clip).filter((x) => x.e > x.s)
    for (const x of vis) if (x.plan) el('rect', { x: lw, y: y(x.s), width: tw, height: y(x.e) - y(x.s), rx: 2, fill: hatch(id, x.t) }, svg)
    for (const x of vis) if (!x.plan) { el('rect', { x: lw, y: y(x.s) + .5, width: tw, height: y(x.e) - y(x.s) - 1, rx: 2.5, fill: HEX[x.t] }, svg); if ((x.e - x.s) * hh / 60 >= 16) el('text', { x: lw + tw / 2, y: (y(x.s) + y(x.e)) / 2 + 3, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 600, fill: copyOn(HEX[x.t]) }, svg).textContent = hrs(x.e - x.s) }
    return svg
  }
  const E = (s, e, t, p) => ({ s, e, t, plan: p })
  $('picTimeline').appendChild(mini([E(540, 720, '写作', 1), E(420, 510, '睡觉'), E(555, 705, '写作'), E(705, 750, '吃饭'), E(750, 840, '阅读'), E(900, 990, '英语', 1), E(1020, 1050, '运动'), E(1140, 1230, '写作')], 'mt', { w: 300, hh: 19, r0: 9, r1: 14, every: 1 }))
  const PEOPLE = [
    { name: tr('全职自由创作者', 'Independent creators'), sub: tr('写作者 · 独立开发 · 视频博主', 'Writers · indie makers · video creators'), c: 'var(--amber)', uses: [[tr('时间轴', 'Timeline'), 'var(--blue)'], [tr('待办', 'To-dos'), 'var(--amber)'], [tr('统计', 'Stats'), 'var(--red)']],
      text: tr('没有打卡、没有例会，一天是散的。早上把今天要交的东西列成待办、拖到时间轴上；晚上看统计，知道今天到底产出了几小时，而不是「忙了一天」。', 'With no time clock or stand-up, the day can blur. List the work you want to ship in the morning, plan it on the timeline, and see your actual hours at night instead of just feeling “busy all day.”'),
      list: [E(420, 510, '睡觉'), E(540, 720, '写作', 1), E(540, 705, '写作'), E(705, 750, '吃饭'), E(780, 900, '写作'), E(900, 960, '阅读'), E(1020, 1080, '运动'), E(1080, 1125, '吃饭'), E(1170, 1290, '写作')] },
    { name: tr('备考的人', 'People studying for exams'), sub: tr('考研 · 考公 · 考证', 'Graduate exams · public service · certifications'), c: 'var(--green)', uses: [[tr('时间轴', 'Timeline'), 'var(--blue)'], [tr('打卡', 'Habits'), 'var(--green)'], [tr('每日一句', 'Daily quote'), 'var(--violet)']],
      text: tr('前一晚用「计划」画出明天的数学、英语、专业课，当天真实色块盖上去，差在哪一目了然。每科每周要够多少小时设成打卡，画够了自己亮。页面上留一句提醒自己的话。', 'Plan tomorrow’s study blocks the night before. Actual time appears over the plan, so you can see the gaps. Set weekly hour goals by subject and keep a line of encouragement on the page.'),
      list: [E(540, 720, '写作', 1), E(840, 1020, '阅读', 1), E(420, 540, '睡觉'), E(555, 735, '写作'), E(735, 810, '吃饭'), E(810, 1020, '阅读'), E(1030, 1050, '吃饭'), E(1140, 1200, '英语'), E(1200, 1260, '阅读'), E(1260, 1320, '写作')] },
    { name: tr('想做 time-engineering 的人', 'People who engineer their time'), sub: tr('独立开发者 · 远程工作者 · 自我量化爱好者', 'Indie developers · remote workers · self-trackers'), c: 'var(--blue)', uses: [[tr('时间轴', 'Timeline'), 'var(--blue)'], [tr('统计', 'Stats'), 'var(--red)'], [tr('打卡', 'Habits'), 'var(--green)'], [tr('快速记录', 'Quick capture'), 'var(--ink-2)']],
      text: tr('把时间当工程材料：先量，再改。不靠感觉，靠每天二十秒攒出来的数据。懒得动手的时候说一句话让它记；一周之后，睡眠、深度工作、碎片时间的形状就出来了。', 'Measure before you change. A few seconds of recording each day reveal the shape of your sleep, focus, and fragmented time. When you do not want to draw a block, capture it in a sentence.'),
      list: [E(420, 465, '睡觉'), E(480, 510, '运动'), E(540, 690, '写作'), E(690, 735, '吃饭'), E(750, 840, '阅读'), E(840, 990, '写作'), E(1020, 1050, '吃饭'), E(1080, 1140, '英语'), E(1170, 1260, '阅读')] },
  ]
  PEOPLE.forEach((p, i) => {
    const card = h('article', 'person'); card.style.setProperty('--c', p.c); card.appendChild(mini(p.list, 'mp' + i))
    card.insertAdjacentHTML('beforeend', `<div class="head"><h3>${p.name}</h3><p class="sub">${p.sub}</p><div class="uses">${p.uses.map(([n, c]) => `<span style="--c:${c}">${n}</span>`).join('')}</div></div><p>${p.text}</p>`)
    $('people').appendChild(card)
  })
})()

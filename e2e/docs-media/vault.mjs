/**
 * The demo vault behind the README media: an English week around "today" with
 * records, plans, goals, rhythms and a timed event. Everything is ordinary
 * Modular Diary Markdown, the same a user would have.
 */
import fs from 'node:fs'
import path from 'node:path'

const PLUGIN_ID = 'modular-diary'

export const CATEGORIES = {
  Focus: '#53a3f2',
  Meetings: '#ae7ee2',
  Exercise: '#f4a437',
  Reading: '#a0c849',
  Meals: '#f47b74',
  Errands: '#2bb3c0',
}

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const mondayOf = (date) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
export function isoWeekKey(date) {
  const value = new Date(`${mondayOf(date)}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 3)
  const yearStart = Date.UTC(value.getUTCFullYear(), 0, 1)
  return `${value.getUTCFullYear()}-W${String(Math.ceil(((value.getTime() - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`
}

const todo = (fields) => {
  const { done = false, ...rest } = fields
  const order = ['id', 'estimate', 'category', 'group', 'day', 'goal', 'under', 'parent', 'zone', 'at', 'title']
  const parts = order.filter((key) => rest[key] !== undefined).map((key) => {
    const value = rest[key]
    return ['estimate', 'day', 'zone', 'at'].includes(key) ? `${key}=${value}` : `${key}=${JSON.stringify(value)}`
  })
  return `- [${done ? 'x' : ' '}] todo: ${parts.join(' ')}`
}

const block = (lines) => ['```timeline', ...lines, '```', ''].join('\n')

/** Records of a past day: a working day on weekdays, a slower one at weekends, varied by date. */
function pastDay(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const seed = Number(date.slice(8, 10))
  const pick = (list) => list[seed % list.length]
  const shift = (seed % 3) * 15
  const hm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  const span = (from, to, rest) => `${hm(from)}-${hm(to)} ${rest}`
  const lines = weekday === 0 || weekday === 6
    ? [
        span(8 * 60 + 30 + shift, 9 * 60 + 15 + shift, 'Meals Slow breakfast'),
        span(9 * 60 + 30 + shift, 11 * 60 + shift, `Exercise ${pick(['Long run', 'Bike ride', 'Swim', 'Hike'])}`),
        span(12 * 60 + 30, 13 * 60 + 30, 'Meals Lunch'),
        span(14 * 60, 15 * 60 + 30 + shift, `Errands ${pick(['Farmers market', 'Groceries', 'Fix the bike', 'IKEA'])}`),
        span(16 * 60, 17 * 60 + 30, 'Reading Novel'),
        span(19 * 60, 20 * 60, 'Meals Dinner with friends'),
      ]
    : [
        '07:30-08:00 Exercise Stretch',
        span(8 * 60 + 15, 8 * 60 + 45, 'Meals Breakfast'),
        span(9 * 60, 11 * 60 + shift, `Focus ${pick(['Week view', 'Rhythm board', 'Sync bug', 'Release notes', 'Drag snapping'])}`),
        span(11 * 60 + 15 + shift, 12 * 60, `Meetings ${pick(['Standup', 'Design review', 'Planning'])}`),
        span(12 * 60 + 15, 13 * 60, 'Meals Lunch'),
        ...(seed % 2 ? [span(13 * 60 + 15, 14 * 60, 'Reading Paper notes')] : []),
        span(14 * 60 + 15, 16 * 60 + 45 + shift, `Focus ${pick(['README', 'Sub-goals', 'Settings page', 'Month view'])}`),
        ...(seed % 3 ? [span(17 * 60 + 30, 18 * 60 + 15, 'Exercise Run')] : []),
        span(19 * 60, 19 * 60 + 45, 'Meals Dinner'),
        ...(seed % 4 === 1 ? ['20:30-21:00 Reading Novel'] : []),
      ]
  return block([`date: ${date}`, 'range: 7-23', '---', ...lines])
}

export function writeDemoVault(vault, { today, pluginFiles }) {
  fs.rmSync(vault, { recursive: true, force: true })
  const obs = path.join(vault, '.obsidian')
  const pluginDir = path.join(obs, 'plugins', PLUGIN_ID)
  fs.mkdirSync(pluginDir, { recursive: true })
  for (const file of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join(pluginFiles, file), path.join(pluginDir, file))
  fs.writeFileSync(path.join(obs, 'community-plugins.json'), JSON.stringify([PLUGIN_ID]))
  fs.writeFileSync(path.join(obs, 'app.json'), JSON.stringify({ readableLineLength: false, showInlineTitle: false, defaultViewMode: 'preview', promptDelete: false, alwaysUpdateLinks: true }, null, 2))
  // Obsidian's own menus (not the native macOS ones), so a right-click shows up in a capture.
  fs.writeFileSync(path.join(obs, 'appearance.json'), JSON.stringify({ theme: 'moonstone', showRibbon: false, nativeMenus: false, baseFontSize: 16, showViewHeader: false, enabledCssSnippets: ['docs'] }, null, 2))
  // A calm frame: no status bar, no hover tooltips left behind by the pointer.
  fs.mkdirSync(path.join(obs, 'snippets'), { recursive: true })
  fs.writeFileSync(path.join(obs, 'snippets', 'docs.css'), '.status-bar, .tooltip, .notice-container { display: none !important; }\n')
  fs.writeFileSync(path.join(obs, 'daily-notes.json'), JSON.stringify({ folder: 'Journal', format: 'YYYY-MM-DD' }))
  fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify({
    spanTypeColors: CATEGORIES,
    markerTypeColors: { Idea: '#f4a437', Mood: '#ae7ee2' },
    timelineOnboardingSeen: true,
    hourHeight: 40,
    rangeStartHour: 7,
    rangeEndHour: 23,
    rhythmsFile: 'Rhythms.md',
    periodFolder: 'Plans',
    checklistFolder: 'Checklists',
    upcomingFile: 'Upcoming.md',
    hourlyNudge: false,
    periodFace: 'plan',
    periodHeight: 470,
    dialogBackend: 'claude-cli',
  }, null, 2))

  const monday = mondayOf(today)
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index))
  const at = (offset) => days[offset]

  fs.writeFileSync(path.join(vault, 'Rhythms.md'), [
    '# Rhythms', '',
    '- 每天 30分钟 Exercise @Exercise',
    '- 每周 3小时 Reading @Reading',
    '- 每周 2次 Call family 晚上',
    '- 每月 1次 Day trip @Errands 整天',
    '',
  ].join('\n'))

  const journal = path.join(vault, 'Journal')
  fs.mkdirSync(journal, { recursive: true })
  // Every earlier day of the month (and of this week) has its records.
  const first = [`${today.slice(0, 7)}-01`, monday].sort()[0]
  for (let date = first; date < today; date = addDays(date, 1)) fs.writeFileSync(path.join(journal, `${date}.md`), pastDay(date))

  fs.writeFileSync(path.join(journal, `${today}.md`), block([
    `date: ${today}`,
    'range: 7-23',
    'layout: dialog@0,0,7,3 toolbar@0,3,7,4 todos@0,7,7,10 habits@0,17,7,8 text@0,25,7,6 stats@0,31,7,4 timeline@7,0,5,40',
    todo({ id: 't-launch', done: true, estimate: 120, category: 'Focus', group: '', title: 'Draft the launch post' }),
    todo({ id: 't-feedback', estimate: 45, category: 'Meetings', group: '', title: 'Reply to design feedback' }),
    todo({ id: 't-dentist', estimate: 10, category: 'Errands', group: '', title: 'Book the dentist' }),
    todo({ id: 't-flowers', estimate: 15, category: 'Errands', group: '', title: 'Flowers for Mia' }),
    '---',
    '07:30-08:00 Exercise Morning stretch',
    '08:15-08:45 Meals Breakfast',
    '09:00-11:15 Focus Launch post #launch',
    '11:30-12:15 Meetings Weekly planning',
    '12:30-13:20 Meals Lunch with Mia',
    '13:30-14:20 Reading Local-first software',
    '14:30-15:20 Focus README media #launch',
    '15:30-17:10 Focus Settings page',
    'plan 09:00-11:30 Focus Launch post',
    'plan 17:15-17:45 Exercise Run 5k',
    'plan 20:30-21:30 Reading Chapter 4',
    '@10:20 [Idea] Show the week view first',
    '=== Notes',
    '**Today.** The launch post is drafted; the settings page is next.',
    '',
    'Mia liked the month view. Ask her what she would cut from the week.',
  ]))

  const plans = path.join(vault, 'Plans')
  fs.mkdirSync(plans, { recursive: true })
  // The earlier weeks of the month, mostly done, so the month view looks lived in.
  const history = [
    ['Plan the sprint', 'Meetings', 0, 'am'], ['Design review', 'Meetings', 1, '10:00'], ['Gym', 'Exercise', 2, 'pm'],
    ['Write release notes', 'Focus', 3, 'am'], ['Movie night', 'Meals', 4, 'ev'], ['Farmers market', 'Errands', 5, 'am'],
    ['Long run', 'Exercise', 6, 'am'],
  ]
  const twists = [['Gym', 'Swim'], ['Movie night', 'Dinner with Ana'], ['Farmers market', 'Bike repair'], ['Write release notes', 'Fix sync bug']]
  const monthStart = `${today.slice(0, 7)}-01`
  for (let week = mondayOf(monthStart), n = 0; week < monday; week = addDays(week, 7), n++) {
    const items = history.map(([title, category, offset, when], index) => {
      const swap = twists.find(([from]) => from === title && (n + index) % 2 === 1)
      const day = addDays(week, offset)
      if (day.slice(0, 7) !== today.slice(0, 7)) return null
      return todo({ id: `h-${n}-${index}`, done: true, estimate: 60, category, group: '', day, ...(when.includes(':') ? { at: when } : { zone: when }), title: swap ? swap[1] : title })
    }).filter(Boolean)
    const calls = [0, 3].map((offset, index) => `- [x] todo: id="h-${n}-call-${index}" estimate=0 category="" group="" day=${addDays(week, offset)} rhythm="Call family" zone=ev title="Call family"`)
    fs.writeFileSync(path.join(plans, `${isoWeekKey(week)}.md`), block([`days: ${week}..${addDays(week, 6)}`, 'scope: week', ...items, ...calls, '---']))
  }
  // Next week, partly planned.
  const next = addDays(monday, 7)
  fs.writeFileSync(path.join(plans, `${isoWeekKey(next)}.md`), block([`days: ${next}..${addDays(next, 6)}`, 'scope: week',
    todo({ id: 'n-flight', estimate: 180, category: 'Errands', group: '', day: addDays(next, 4), at: '08:30', title: 'Flight to Lisbon' }),
    todo({ id: 'n-retro', estimate: 60, category: 'Meetings', group: '', day: addDays(next, 1), zone: 'pm', title: 'Retro' }),
    '---']))
  const [year, month] = today.split('-').map(Number)
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  fs.writeFileSync(path.join(plans, `${today.slice(0, 7)}.md`), block([`days: ${monthStart}..${monthEnd}`, 'scope: month',
    'goal: text="Ship Modular Diary to the community" id="g-ship"',
    'goal: text="Run 40 km" id="g-run"',
    '---']))
  fs.writeFileSync(path.join(plans, `${isoWeekKey(today)}.md`), block([
    `days: ${monday}..${at(6)}`,
    'scope: week',
    'goal: text="Launch Modular Diary" id="g-launch" subs="day"',
    'goal: text="Read three papers" id="g-read"',
    todo({ id: 'w-gifs', done: true, estimate: 120, category: 'Focus', group: '', day: at(0), goal: 'g-launch', zone: 'pm', title: 'Record the demo GIFs' }),
    todo({ id: 'w-readme', done: true, estimate: 90, category: 'Focus', group: '', day: at(1), goal: 'g-launch', zone: 'pm', title: 'Write the README' }),
    todo({ id: 'w-settings', done: true, estimate: 90, category: 'Focus', group: '', day: at(3), goal: 'g-launch', at: '15:30', title: 'Ship the settings page' }),
    todo({ id: 'w-submit', estimate: 60, category: 'Focus', group: '', day: at(4), goal: 'g-launch', at: '10:00', title: 'Submit to the directory' }),
    todo({ id: 'w-paper1', done: true, estimate: 45, category: 'Reading', group: '', day: at(2), goal: 'g-read', zone: 'pm', title: 'Local-first software' }),
    todo({ id: 'w-paper2', estimate: 45, category: 'Reading', group: '', day: at(5), goal: 'g-read', zone: 'am', title: 'Out of the Tar Pit' }),
    todo({ id: 'w-paper3', estimate: 45, category: 'Reading', group: '', goal: 'g-read', title: 'A note on distributed computing' }),
    todo({ id: 'w-concert', estimate: 120, category: 'Errands', group: '', day: at(5), at: '15:00', title: 'Concert with Mia' }),
    todo({ id: 'w-one', estimate: 45, category: 'Meetings', group: '', day: at(4), zone: 'pm', title: '1:1 with Sam' }),
    todo({ id: 'w-dentist', estimate: 45, category: 'Errands', group: '', day: at(1), at: '09:30', title: 'Dentist' }),
    todo({ id: 'w-standup', done: true, estimate: 60, category: 'Meetings', group: '', day: at(0), zone: 'am', title: 'Plan the sprint' }),
    todo({ id: 'w-groceries', estimate: 40, category: 'Errands', group: '', day: at(6), zone: 'am', title: 'Groceries' }),
    todo({ id: 'w-team', estimate: 60, category: 'Meals', group: '', day: at(3), at: '12:30', title: 'Team lunch' }),
    '- [x] todo: id="w-call-1" estimate=0 category="" group="" day=' + at(0) + ' rhythm="Call family" zone=ev title="Call family"',
    '- [ ] todo: id="w-call-2" estimate=0 category="" group="" day=' + at(5) + ' rhythm="Call family" zone=ev title="Call family"',
    todo({ id: 'w-passport', estimate: 30, category: 'Errands', group: '', title: 'Renew passport' }),
    todo({ id: 'w-birthday', estimate: 20, category: 'Errands', group: '', title: "Plan Mia's birthday" }),
    todo({ id: 'w-bike', estimate: 40, category: 'Errands', group: '', title: 'Fix the bike' }),
    '---',
  ]))
}

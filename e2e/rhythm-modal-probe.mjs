// Render the rhythms panel with Obsidian's real app.css + the plugin's styles.css, for a visual review.
import fs from "node:fs"
import path from "node:path"
import esbuild from "esbuild"
import { chromium } from "playwright"

const root = "/Users/creator/developer/modular-diary-worktrees/rhythm"
const scratch = "/private/tmp/claude-501/-Users-creator-vaults-main-2026-10-05--------------/c044fb2d-8c3e-4c4f-8d05-75ad063f7e9c/scratchpad"
const out = path.join(scratch, "rhythm-modal-render")
fs.mkdirSync(out, { recursive: true })

const stub = `
for(const [method,tag] of [['createDiv','div'],['createSpan','span'],['createEl',null]])HTMLElement.prototype[method]=function(a={},b={}){const opts=tag?a:b,el=document.createElement(tag||a);if(opts.cls)el.className=Array.isArray(opts.cls)?opts.cls.join(' '):opts.cls;if(opts.text)el.textContent=opts.text;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,v);this.append(el);return el}
HTMLElement.prototype.empty=function(){this.replaceChildren()}
class Modal{constructor(app){this.app=app;this.containerEl=document.createElement('div');this.containerEl.className='modal-container mod-dim';const bg=document.createElement('div');bg.className='modal-bg';this.modalEl=document.createElement('div');this.modalEl.className='modal';this.titleEl=document.createElement('div');this.titleEl.className='modal-title';this.contentEl=document.createElement('div');this.contentEl.className='modal-content';const close=document.createElement('div');close.className='modal-close-button';this.modalEl.append(close,this.titleEl,this.contentEl);this.containerEl.append(bg,this.modalEl);document.body.appendChild(this.containerEl)}setTitle(v){this.titleEl.textContent=v;return this}open(){this.onOpen()}close(){this.onClose();this.containerEl.remove()}onOpen(){}onClose(){}}
const ICONS={'grip-vertical':'<circle cx="9" cy="5" r="1.4"/><circle cx="15" cy="5" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="19" r="1.4"/><circle cx="15" cy="19" r="1.4"/>','trash-2':'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" fill="none" stroke="currentColor" stroke-width="2"/>'}
const obsidian={Modal,Notice:class{constructor(m){console.log('NOTICE',m)}},setIcon:(el,name)=>{el.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor">'+(ICONS[name]||'<circle cx="12" cy="12" r="6"/>')+'</svg>'},getLanguage:()=>'zh'}
window.require=(n)=>n==='obsidian'?obsidian:{}
`
const entry = `
import { RhythmEditorModal } from "${path.join(root, "src/rhythm-editor-modal")}"
import { parseRhythms } from "${path.join(root, "src/core/rhythms")}"
import { configureI18n } from "${path.join(root, "src/i18n")}"
configureI18n(() => "zh")
const items = parseRhythms(["- 每两周 周二 6小时 心理咨询 @出门 上午 自2026-10-27 #抑郁", "- 每天 信息摄取 @信息摄取", "- 每周 3次 运动 @运动 上午-下午", "- 每月 独立旅游 @旅行 2-3天", "- 每周 周四 14:00-15:30 周会 @开发"].join("\\n"))
const colors = { 出门: "#9bc53d", 信息摄取: "#c2410c", 运动: "#f4a437", 旅行: "#2bb3c0", 开发: "#53a3f2", 写作: "#a0c849" }
window.openModal = () => new RhythmEditorModal({}, { items: () => items, save: async () => {}, openNote: () => {}, categories: () => Object.keys(colors), typeColors: () => colors, tagSuggest: () => ({ tags: () => ["抑郁", "家人", "模块日记"] }) }).open()
window.openModal()
`
fs.writeFileSync(path.join(out, "entry.ts"), entry)
const built = await esbuild.build({ entryPoints: [path.join(out, "entry.ts")], bundle: true, write: false, platform: "browser", format: "iife", external: ["obsidian"], absWorkingDir: root })
const appCss = fs.readFileSync(path.join(scratch, "app.css"), "utf8")
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8")
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html class="theme-light"><meta charset="utf-8"><style>${appCss}</style><style>${css}</style><body class="theme-light mod-macos"><script>${stub}</script><script>${built.outputFiles[0].text}</script></body></html>`)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 })
page.on("pageerror", (e) => console.error("pageerror", e.message))
await page.goto("file://" + path.join(out, "index.html"))
await page.waitForSelector(".modular-diary-rhythm-item")
await page.waitForTimeout(200)
await page.locator(".modal").screenshot({ path: path.join(out, "modal.png") })
console.log(path.join(out, "modal.png"))
await browser.close()

#!/usr/bin/env node
/**
 * Mobile load contract: Obsidian mobile has no Node, so requiring `node:*`,
 * `fs`, `child_process`, `electron`… at load time throws and the plugin never
 * starts. Evaluate the built main.js with a require that only knows `obsidian`
 * and check the plugin class comes out. Desktop-only code must load Node
 * lazily (src/agent/node.ts).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const code = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const asked = []
// Whatever the plugin touches on `obsidian` at load time: a class or function that does nothing.
const stub = new Proxy(function Stub() {}, { get: (target, key) => key === 'prototype' ? {} : key === Symbol.toPrimitive ? () => '' : stub, construct: () => stub, apply: () => stub })
const mobileRequire = (name) => {
  asked.push(name)
  if (name === 'obsidian') return new Proxy({}, { get: (_, key) => key === 'Plugin' || key === 'Modal' || key === 'PluginSettingTab' || key === 'MarkdownRenderChild' || key === 'Component' || key === 'FuzzySuggestModal' || key === 'ItemView' || key === 'AbstractInputSuggest' ? class {} : stub })
  throw new Error(`Cannot find module '${name}' (no Node on mobile)`)
}
const module = { exports: {} }
const sandbox = { module, exports: module.exports, require: mobileRequire, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Intl, URL, TextEncoder, TextDecoder }
sandbox.globalThis = sandbox
sandbox.window = sandbox
sandbox.self = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'main.js' })
const Plugin = module.exports.default ?? module.exports
assert.equal(typeof Plugin, 'function', 'main.js exports the plugin class')
const foreign = asked.filter((name) => name !== 'obsidian')
assert.deepEqual(foreign, [], `load-time requires other than obsidian: ${foreign.join(', ')}`)
console.log(`PASS mobile load: main.js loads with only \`obsidian\` available (${asked.length} require calls at load).`)

import { describe, expect, it } from 'vitest'
import { appendPostponedTodo, nextTodoDate, transferPostponedTodo, removePostponedTodo } from './todo-postpone'
import { parseTimeline } from '../core/parser'
import { timelineFences } from './block-identity'
const todo = { id: 'transfer', title: '有尾巴', note: '不能丢', estimateMin: 30, group: '工作', difficulty: 3, priority: '马上', completed: false, partial: true, line: 1 }
describe('postpone data safety', () => {
 it('handles date boundaries and rejects invalid dates', () => {
  expect(nextTodoDate('2026-12-31')).toBe('2027-01-01')
  expect(nextTodoDate('2028-02-28')).toBe('2028-02-29')
  expect(() => nextTodoDate('2026-02-30')).toThrow()
 })
 it('preserves status/attributes and existing note content, idempotently', () => {
  const initial = '# Tomorrow\n\n```timeline\ndate: 2026-10-11\n---\n09:00-10:00 work 原有记录\n```\n\n原有文字\n'
  const copied = appendPostponedTodo(initial, '2026-10-11', todo)
  expect(copied).toContain('原有记录'); expect(copied).toContain('原有文字')
  expect(copied).toContain('- [/] todo:')
  expect(parseTimeline([...timelineFences(copied)][0].source).todos[0]).toMatchObject({ ...todo, line: 1 })
  expect(appendPostponedTodo(copied, '2026-10-11', todo)).toBe(copied)
  expect(() => appendPostponedTodo(copied, '2026-10-11', { ...todo, title: '冲突' })).toThrow('postponed-todo-id-conflict')
 })
 it('does not write into examples and rejects ambiguous date blocks', () => {
  const example = '````md\n```timeline\ndate: 2026-10-11\n---\n```\n````\n'
  expect(appendPostponedTodo(example, '2026-10-11', todo)).toContain(example)
  const fence = '```timeline\ndate: 2026-10-11\n---\n```\n'
  expect(() => appendPostponedTodo(fence + fence, '2026-10-11', todo)).toThrow('ambiguous')
  expect(() => appendPostponedTodo('', '2026-10-11', { ...todo, completed: true })).toThrow()
 })
 it('removes the original only after durable copy acknowledgement', async () => {
  const steps: string[] = []
  await expect(transferPostponedTodo({copy: async () => { throw Error('disk') }, verifyCopy: async () => true, removeOriginal: async () => {steps.push('remove')}})).rejects.toThrow('disk')
  await expect(transferPostponedTodo({copy: async () => {steps.push('copy')}, verifyCopy: async () => false, removeOriginal: async () => {steps.push('remove')}})).rejects.toThrow('not-durable')
  expect(steps).toEqual(['copy'])
  await transferPostponedTodo({copy: async () => {steps.push('copy')}, verifyCopy: async () => {steps.push('verify');return true}, removeOriginal: async () => {steps.push('remove')}})
  expect(steps).toEqual(['copy','copy','verify','remove'])
 })
})

it('rejects stale source removal and keeps historical bindings', () => {
 const original = [...timelineFences(appendPostponedTodo('', '2026-10-11', todo))][0].source + '\n09:00-10:00 work 尝试过 [todo:transfer]'
 expect(removePostponedTodo(original, todo)).toContain('[todo:transfer]')
 expect(parseTimeline(removePostponedTodo(original, todo)).todos).toEqual([])
 expect(() => removePostponedTodo(original.replace('有尾巴','标题变了'), todo)).toThrow('source-changed')
})

it('reveals copied Todos and refuses same ID on another date', () => {
 const hidden = '```timeline\ndate: 2026-10-11\noff: todos stats\n---\n```'
 const copied = appendPostponedTodo(hidden, '2026-10-11', todo)
 expect(parseTimeline([...timelineFences(copied)][0].source).hiddenSlots).toEqual(['stats'])
 expect(() => appendPostponedTodo(copied.replace('2026-10-11','2026-10-09'),'2026-10-11',todo)).toThrow('id-conflict')
})

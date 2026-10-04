export interface TypeMenuOption {
  title: string
  type: string
  checked: boolean
}

export function buildTypeMenuOptions(types: string[], currentType: string): TypeMenuOption[] {
  const ordered = types.includes(currentType) ? types : [currentType, ...types]
  return [...new Set(ordered)].map((type) => ({
    title: type,
    type,
    checked: type === currentType,
  }))
}

export interface TodoMenuOption {
  title: string
  todoId: string | null
  checked: boolean
}

export function buildTodoMenuOptions(
  todos: Array<{ id: string; title: string }>,
  currentTodoId: string | undefined,
  unbindTitle: string
): TodoMenuOption[] {
  return [
    ...(currentTodoId ? [{ title: unbindTitle, todoId: null, checked: false }] : []),
    ...todos.map((todo) => ({ title: todo.title, todoId: todo.id, checked: todo.id === currentTodoId })),
  ]
}

export type TodoGroupValue = "none" | "category" | "status" | "tag"

export interface TodoGroupMenuOption {
  title: string
  value: TodoGroupValue
  checked: boolean
}

/** The parent button already establishes that this menu controls grouping. */
export function buildTodoGroupMenuOptions(
  current: TodoGroupValue,
  titles: Record<TodoGroupValue, string>
): TodoGroupMenuOption[] {
  return (["none", "category", "status", "tag"] as const).map((value) => ({
    title: titles[value],
    value,
    checked: current === value,
  }))
}

/** Second-level grouping: everything except "same as the primary level". */
export function buildTodoSubGroupMenuOptions(
  primary: TodoGroupValue,
  current: TodoGroupValue,
  titles: Record<TodoGroupValue, string>
): TodoGroupMenuOption[] {
  return (["none", "category", "status", "tag"] as const)
    .filter((value) => value === "none" || value !== primary)
    .map((value) => ({
      title: titles[value],
      value,
      checked: current === value,
    }))
}

export type TodoSortValue = "manual" | "estimate" | "actual"

export interface TodoSortMenuOption {
  title: string
  value: TodoSortValue
  checked: boolean
}

/** The parent button already establishes that this menu controls sorting. */
export function buildTodoSortMenuOptions(
  current: TodoSortValue,
  titles: Record<TodoSortValue, string>
): TodoSortMenuOption[] {
  return (["manual", "estimate", "actual"] as const).map((value) => ({
    title: titles[value],
    value,
    checked: current === value,
  }))
}

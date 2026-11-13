export type TaskTreeRow<T> = { readonly task: T; readonly depth: number }

/** Stable pre-order projection for a flat task graph. Orphans stay visible as roots. */
export function taskTree<T extends { readonly id?: string; readonly parentID?: string }>(tasks: readonly T[]) {
  const indexed = new Set(tasks.flatMap((task) => (task.id ? [task.id] : [])))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const task of tasks) {
    const parent = task.parentID && indexed.has(task.parentID) ? task.parentID : undefined
    if (!parent) roots.push(task)
    else children.set(parent, [...(children.get(parent) ?? []), task])
  }
  const rows: TaskTreeRow<T>[] = []
  const seen = new Set<T>()
  const visit = (task: T, depth: number) => {
    if (seen.has(task)) return
    seen.add(task)
    rows.push({ task, depth })
    if (task.id) for (const child of children.get(task.id) ?? []) visit(child, depth + 1)
  }
  roots.forEach((task) => visit(task, 0))
  tasks.forEach((task) => visit(task, 0))
  return rows
}

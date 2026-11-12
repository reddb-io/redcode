export const sample = JSON.stringify(
  {
    customer: { name: "Ana", email: "ana@example.com", plan: "Pro" },
    orders: [
      { id: "ORD-1042", total: 149.9, paid: true },
      { id: "ORD-1043", total: 89.5, paid: false },
    ],
    active: true,
    notes: null,
  },
  null,
  2,
)

export function inspect(source: string) {
  const bytes = new TextEncoder().encode(source).length
  // Bound this local explorer before rendering the DS tree; this is not a Redcode resource warning.
  if (bytes > 262144) return { ok: false as const, error: "Este exemplo aceita documentos de até 256 KiB." }
  try {
    const value: unknown = JSON.parse(source)
    const queue = [{ value, depth: 0 }]
    const types = { string: 0, number: 0, boolean: 0, null: 0 }
    let objects = 0,
      arrays = 0,
      keys = 0,
      depth = 0
    while (queue.length) {
      const item = queue.pop()!
      depth = Math.max(depth, item.depth)
      if (depth > 64)
        return { ok: false as const, error: "Este explorador visual aceita até 64 níveis de profundidade." }
      if (item.value === null) {
        types.null++
        continue
      }
      if (typeof item.value !== "object") {
        types[typeof item.value as "string" | "number" | "boolean"]++
        continue
      }
      if (Array.isArray(item.value)) arrays++
      else {
        objects++
        keys += Object.keys(item.value).length
      }
      for (const child of Object.values(item.value)) queue.push({ value: child, depth: item.depth + 1 })
    }
    const labels = { string: "Strings", number: "Números", boolean: "Booleanos", null: "Null" }
    return {
      ok: true as const,
      value,
      bytes,
      objects,
      arrays,
      keys,
      depth,
      root: type(value),
      leaves: Object.values(types).reduce((a, b) => a + b, 0),
      types: Object.entries(types).map(([id, value], index) => ({
        id,
        label: labels[id as keyof typeof labels],
        value,
        series: (index + 1) as 1 | 2 | 3 | 4,
      })),
    }
  } catch (cause) {
    return { ok: false as const, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function pointer(value: unknown, path: string) {
  if (path === "") return { ok: true as const, value, type: type(value) }
  if (!path.startsWith("/"))
    return { ok: false as const, error: "O caminho deve começar com /; vazio retorna o documento completo." }
  let current = value
  for (const raw of path.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(raw)) return { ok: false as const, error: "Escape inválido. Use ~0 para ~ e ~1 para /." }
    const key = raw.replace(/~[01]/g, (match) => (match === "~0" ? "~" : "/"))
    if (
      current === null ||
      typeof current !== "object" ||
      (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(key)) ||
      !Object.prototype.hasOwnProperty.call(current, key)
    )
      return { ok: false as const, error: `Caminho não encontrado: ${path}` }
    current = (current as Record<string, unknown>)[key]
  }
  return { ok: true as const, value: current, type: type(current) }
}
function type(value: unknown) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value
}

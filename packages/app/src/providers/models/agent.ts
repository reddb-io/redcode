export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}

// The TUI's built-in order, so a built-in agent keeps its colour whatever order the server lists agents in.
const builtins = ["build", "plan", "design", "question"]

const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * An agent's identity colour, as a CSS colour for marks such as a dot or a border tint, never for text: the agent's
 * own `color` when it is a hex colour, otherwise one of the design system's six categorical series, chosen like the
 * TUI by built-in order and then by the agent's position among the visible agents.
 */
export function agentColor(items: ReadonlyArray<{ name: string; color?: string }>, name: string) {
  const index = items.findIndex((item) => item.name === name)
  const color = items[index]?.color

  if (color && hex.test(color)) return color
  const builtin = builtins.indexOf(name)
  const position = index === -1 ? 0 : builtin === -1 ? index : builtin

  return `var(--reddb-color-series-${(position % 6) + 1})`
}

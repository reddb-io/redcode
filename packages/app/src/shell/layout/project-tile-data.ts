// Project icon colors map onto the six DS series roles; gray asks for the ink tile.
const SERIES: Record<string, number> = {
  blue: 1,
  orange: 2,
  cyan: 3,
  mint: 3,
  green: 3,
  lime: 3,
  purple: 4,
  yellow: 5,
  pink: 6,
  red: 6,
}

/** A stable series role (1–6) for a project that never picked a color. */
export function projectTone(key: string) {
  const hash = Array.from(key).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7)
  return (hash % 6) + 1
}

export function projectTileTone(project: { id?: string; worktree: string; icon?: { color?: string } }) {
  const color = project.icon?.color
  return color === "gray" ? "ink" : String(SERIES[color ?? ""] ?? projectTone(project.id ?? project.worktree))
}

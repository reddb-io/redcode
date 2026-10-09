/**
 * The workbench: the right column of a session split into a top and a bottom group of panel tabs. Pure state
 * transitions; the side region applies them to the tabs extensions list and the dock.
 */

export type WorkbenchGroup = "top" | "bottom"

export type WorkbenchState = {
  /** Tabs placed in the group that is not their home group, by panel key. */
  readonly placed: Readonly<Record<string, WorkbenchGroup>>
  /** The selected tab of the top group. */
  readonly top?: string
  /** The selected tab of the bottom group. */
  readonly bottom?: string
  /** The top group's share of the column height while both groups show. */
  readonly ratio: number
  /** The group that fills the column while the other stays mounted out of sight. */
  readonly maximized?: WorkbenchGroup
  /** The column takes the whole session area; the conversation hides. */
  readonly expanded: boolean
}

export const WORKBENCH_RATIO = { min: 0.15, max: 0.85, initial: 0.55 } as const

/** The smallest height either group keeps while the divider moves. */
export const WORKBENCH_GROUP_MIN_HEIGHT = 120

export const WORKBENCH_INITIAL: WorkbenchState = { placed: {}, ratio: WORKBENCH_RATIO.initial, expanded: false }

export function otherGroup(group: WorkbenchGroup): WorkbenchGroup {
  return group === "top" ? "bottom" : "top"
}

export function groupOf(state: WorkbenchState, key: string, home: WorkbenchGroup): WorkbenchGroup {
  return state.placed[key] ?? home
}

/** Splits the open keys, in strip order, into the two groups. `home` names the group a key starts in. */
export function arrange(keys: readonly string[], state: WorkbenchState, home: (key: string) => WorkbenchGroup) {
  return {
    top: keys.filter((key) => groupOf(state, key, home(key)) === "top"),
    bottom: keys.filter((key) => groupOf(state, key, home(key)) === "bottom"),
  }
}

/** The group's selection: the stored tab while the group lists it, otherwise the first fallback the group lists. */
export function pick(keys: readonly string[], stored: string | undefined, fallback: readonly string[]) {
  if (stored !== undefined && keys.includes(stored)) return stored

  return fallback.find((key) => keys.includes(key))
}

/** The groups on screen: a group with content, unless the other one is maximized and has content too. */
export function shown(has: { top: boolean; bottom: boolean }, maximized?: WorkbenchGroup) {
  return {
    top: has.top && (maximized !== "bottom" || !has.bottom),
    bottom: has.bottom && (maximized !== "top" || !has.top),
    split: has.top && has.bottom && maximized === undefined,
  }
}

/** Keys that render together move together: every entry sharing the moved entry's render group. */
export function companions(entries: readonly { key: string; group?: string }[], key: string) {
  const group = entries.find((entry) => entry.key === key)?.group

  if (group === undefined) return [key]

  return entries.flatMap((entry) => (entry.group === group ? [entry.key] : []))
}

/** Moves keys to a group and selects the first there. A move restores a maximized group so both stay reachable. */
export function move(
  state: WorkbenchState,
  keys: readonly string[],
  to: WorkbenchGroup,
  home: (key: string) => WorkbenchGroup,
): WorkbenchState {
  if (keys.length === 0) return state

  const placed = Object.fromEntries([
    ...Object.entries(state.placed).filter(([key]) => !keys.includes(key)),
    ...keys.flatMap((key) => (home(key) === to ? [] : [[key, to] as const])),
  ])

  return { ...state, placed, [to]: keys[0], maximized: undefined }
}

export function select(state: WorkbenchState, group: WorkbenchGroup, key: string): WorkbenchState {
  if (state[group] === key) return state

  return { ...state, [group]: key }
}

export function toggleMaximized(state: WorkbenchState, group: WorkbenchGroup): WorkbenchState {
  return { ...state, maximized: state.maximized === group ? undefined : group }
}

export function toggleExpanded(state: WorkbenchState): WorkbenchState {
  return { ...state, expanded: !state.expanded }
}

/** Undoes one level of focus, the widest first: full width, then a maximized group. */
export function restore(state: WorkbenchState): WorkbenchState {
  if (state.expanded) return { ...state, expanded: false }

  if (state.maximized) return { ...state, maximized: undefined }

  return state
}

/** Clamps the divider so both groups keep their minimum height in a column `height` pixels tall. */
export function clampRatio(ratio: number, height?: number) {
  const floor = height && height > 0 ? Math.min(0.5, WORKBENCH_GROUP_MIN_HEIGHT / height) : 0
  const min = Math.max(WORKBENCH_RATIO.min, floor)
  const max = Math.min(WORKBENCH_RATIO.max, 1 - floor)

  return Math.min(max, Math.max(min, ratio))
}

export function resize(state: WorkbenchState, ratio: number, height?: number): WorkbenchState {
  return { ...state, ratio: clampRatio(ratio, height) }
}

/**
 * Places keys that appeared since `before` in `target` and selects the first: a launcher run from one group opens
 * its tab there.
 */
export function adopt(
  state: WorkbenchState,
  input: {
    before: readonly string[]
    after: readonly string[]
    target: WorkbenchGroup
    home: (key: string) => WorkbenchGroup
  },
): WorkbenchState {
  const added = input.after.filter((key) => !input.before.includes(key))

  return move(state, added, input.target, input.home)
}

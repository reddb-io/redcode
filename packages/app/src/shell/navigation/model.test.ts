import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  buildNavigationTree,
  clampNavigationWidth,
  groupByDay,
  navigationAge,
  navigationSessionOrder,
  stepNavigation,
  togglePinned,
} from "./model"

const session = (id: string, directory: string, updated: number, extra: Partial<SessionInfo> = {}) =>
  ({
    id,
    projectID: `project:${directory}`,
    title: `Session ${id}`,
    location: { directory },
    time: { created: updated, updated },
    ...extra,
  }) as SessionInfo

const alpha = { id: "project:/repo/alpha", worktree: "/repo/alpha" }
const beta = { id: "project:/repo/beta", worktree: "/repo/beta", name: "Beta app" }
const ids = (items: { session: SessionInfo }[]) => items.map((item) => item.session.id)

describe("buildNavigationTree", () => {
  test("nests root sessions under their project, newest first, in project order", () => {
    const tree = buildNavigationTree({
      projects: [alpha, beta],
      sessions: [
        session("a1", "/repo/alpha", 10),
        session("b1", "/repo/beta", 30),
        session("a2", "/repo/alpha", 20),
        session("child", "/repo/alpha", 40, { parentID: "a1" } as Partial<SessionInfo>),
        session("gone", "/repo/alpha", 50, {
          time: { created: 50, updated: 50, archived: 60 },
        } as Partial<SessionInfo>),
      ],
      pinned: [],
    })
    expect(tree.projects.map((project) => [project.key, project.name, ids(project.sessions)])).toEqual([
      ["/repo/alpha", "alpha", ["a2", "a1"]],
      ["/repo/beta", "Beta app", ["b1"]],
    ])
    expect(ids(tree.recents)).toEqual(["b1", "a2", "a1"])
  })

  test("moves pinned sessions out of their project into the pinned list, in pin order", () => {
    const tree = buildNavigationTree({
      projects: [alpha],
      sessions: [session("a1", "/repo/alpha", 10), session("a2", "/repo/alpha", 20), session("a3", "/repo/alpha", 30)],
      pinned: ["a1", "missing", "a3"],
    })
    expect(ids(tree.pinned)).toEqual(["a1", "a3"])
    expect(tree.pinned.every((item) => item.pinned)).toBe(true)
    expect(ids(tree.projects[0]!.sessions)).toEqual(["a2"])
    expect(ids(tree.recents)).toEqual(["a2"])
  })

  test("shows the latest five, keeps sessions needing attention, and counts the rest as hidden", () => {
    const sessions = Array.from({ length: 8 }, (_, index) => session(`s${index}`, "/repo/alpha", 100 - index))
    const tree = buildNavigationTree({
      projects: [alpha],
      sessions,
      pinned: [],
      attention: (id) => id === "s7",
    })
    const project = tree.projects[0]!
    expect(ids(project.sessions)).toEqual(["s0", "s1", "s2", "s3", "s4", "s7"])
    expect(project.hidden).toBe(2)
    expect(project.total).toBe(8)
    expect(project.attention).toBe(true)

    const expanded = buildNavigationTree({ projects: [alpha], sessions, pinned: [], showAll: () => true })
    expect(expanded.projects[0]!.sessions).toHaveLength(8)
    expect(expanded.projects[0]!.hidden).toBe(0)
  })

  test("keeps empty projects and reads the persisted expanded state", () => {
    const tree = buildNavigationTree({
      projects: [alpha, beta],
      sessions: [session("a1", "/repo/alpha", 10)],
      pinned: [],
      expanded: (key) => key !== "/repo/alpha",
    })
    expect(tree.projects.map((project) => [project.key, project.expanded, project.total])).toEqual([
      ["/repo/alpha", false, 1],
      ["/repo/beta", true, 0],
    ])
  })

  test("filters by session title or project name and expands every match", () => {
    const sessions = [
      session("a1", "/repo/alpha", 10, { title: "Fix login" } as Partial<SessionInfo>),
      session("a2", "/repo/alpha", 20, { title: "Refactor cache" } as Partial<SessionInfo>),
      session("b1", "/repo/beta", 30, { title: "Write docs" } as Partial<SessionInfo>),
      session("p1", "/repo/alpha", 40, { title: "Login screen" } as Partial<SessionInfo>),
    ]
    const tree = buildNavigationTree({
      projects: [alpha, beta],
      sessions,
      pinned: ["p1"],
      query: " LOGIN ",
      expanded: () => false,
    })
    expect(tree.filtered).toBe(true)
    expect(ids(tree.pinned)).toEqual(["p1"])
    expect(tree.projects.map((project) => [project.key, project.expanded, ids(project.sessions)])).toEqual([
      ["/repo/alpha", true, ["a1"]],
    ])

    const byName = buildNavigationTree({ projects: [alpha, beta], sessions, pinned: [], query: "beta" })
    expect(byName.projects.map((project) => [project.key, ids(project.sessions)])).toEqual([["/repo/beta", ["b1"]]])
  })

  test("resolves worktree sessions through the project's sandboxes", () => {
    const tree = buildNavigationTree({
      projects: [{ ...alpha, sandboxes: ["/repo/alpha-feature"] }],
      sessions: [session("w1", "/repo/alpha-feature", 10, { projectID: "other" } as Partial<SessionInfo>)],
      pinned: [],
    })
    expect(ids(tree.projects[0]!.sessions)).toEqual(["w1"])
  })
})

describe("navigation order", () => {
  test("lists pinned sessions then expanded projects' visible sessions", () => {
    const tree = buildNavigationTree({
      projects: [alpha, beta],
      sessions: [session("a1", "/repo/alpha", 10), session("b1", "/repo/beta", 20), session("b2", "/repo/beta", 30)],
      pinned: ["b2"],
      expanded: (key) => key === "/repo/beta",
    })
    expect(navigationSessionOrder(tree)).toEqual(["b2", "b1"])
  })

  test("steps cyclically and starts from either end for an unknown item", () => {
    expect(stepNavigation(["a", "b", "c"], "c", 1)).toBe("a")
    expect(stepNavigation(["a", "b", "c"], "a", -1)).toBe("c")
    expect(stepNavigation(["a", "b", "c"], undefined, 1)).toBe("a")
    expect(stepNavigation(["a", "b", "c"], "x", -1)).toBe("c")
    expect(stepNavigation([], "a", 1)).toBeUndefined()
  })
})

describe("groupByDay", () => {
  test("buckets by local calendar day and drops empty groups", () => {
    const now = new Date(2026, 9, 9, 12)
    const at = (days: number) => new Date(2026, 9, 9 - days, 9).getTime()
    const groups = groupByDay([at(0), at(1), at(3), at(30), at(0)], (time) => time, now)
    expect(groups.map((group) => [group.id, group.items.length])).toEqual([
      ["today", 2],
      ["yesterday", 1],
      ["week", 1],
      ["older", 1],
    ])
    expect(groupByDay([at(40)], (time) => time, now).map((group) => group.id)).toEqual(["older"])
  })
})

describe("navigationAge", () => {
  test("picks the largest whole unit", () => {
    expect(navigationAge(30_000)).toBeUndefined()
    expect(navigationAge(4 * 60_000)).toEqual({ value: 4, unit: "minute" })
    expect(navigationAge(2 * 3_600_000 + 5)).toEqual({ value: 2, unit: "hour" })
    expect(navigationAge(3 * 86_400_000)).toEqual({ value: 3, unit: "day" })
    expect(navigationAge(15 * 86_400_000)).toEqual({ value: 2, unit: "week" })
    expect(navigationAge(90 * 86_400_000)).toEqual({ value: 3, unit: "month" })
    expect(navigationAge(800 * 86_400_000)).toEqual({ value: 2, unit: "year" })
  })
})

describe("pins and width", () => {
  test("pins at the top and unpins an existing entry", () => {
    const one = togglePinned([], { server: "s", session: "a" })
    const two = togglePinned(one, { server: "s", session: "b" })
    expect(two).toEqual([
      { server: "s", session: "b" },
      { server: "s", session: "a" },
    ])
    expect(togglePinned(two, { server: "s", session: "a" })).toEqual([{ server: "s", session: "b" }])
    expect(togglePinned(two, { server: "other", session: "a" })).toHaveLength(3)
  })

  test("clamps the sidemenu width", () => {
    expect(clampNavigationWidth(100)).toBe(220)
    expect(clampNavigationWidth(300.4)).toBe(300)
    expect(clampNavigationWidth(900)).toBe(420)
  })
})

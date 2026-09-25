/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@reddb-io/redcode-plugin/tui"
import path from "path"
import { testRender } from "@opentui/solid"
import { locationLines, SidebarFooter } from "../../src/feature-plugins/sidebar/footer"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiPluginApi } from "../fixture/tui-plugin"

test("sidebar footer omits the product and version line", async () => {
  // Built from the platform's separator: the footer abbreviates with `path`, so a hard-coded "/"
  // expectation only ever described a POSIX machine.
  const home = path.join(path.sep, "work")
  const directory = path.join(home, "redcode")
  const api = createTuiPluginApi()
  Object.assign(api, { app: { version: "1.2.3" } })
  Object.assign(api.state, {
    path: { directory },
    provider: [],
    vcs: { branch: "main" },
  })

  const app = await testRender(
    () => (
      <TestTuiContexts cwd={directory} paths={{ home }}>
        <SidebarFooter api={api} sessionID="session" />
      </TestTuiContexts>
    ),
    { width: 60, height: 16 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("~" + path.sep + "redcode")
    expect(frame).not.toContain("OpenCode")
    expect(frame).not.toContain("1.2.3")
  } finally {
    app.renderer.destroy()
  }
})

describe("sidebar location lines", () => {
  const home = path.join(path.sep, "home", "dev")
  const project = path.join(home, "Work", "redcode")

  test("primary checkout shows project, primary marker and branch", () => {
    expect(locationLines({ directory: project, checkout: project, branch: "main", home, width: 40 })).toEqual([
      "~" + path.sep + path.join("Work", "redcode"),
      "⎇ primary checkout",
      "⑂ main",
    ])
  })

  test("nested session worktree shows its path relative to the project", () => {
    const directory = path.join(project, ".red", "worktrees", "setup-flow", "packages", "tui")
    expect(locationLines({ directory, checkout: project, branch: "setup-flow", home, width: 40 })).toEqual([
      "~" + path.sep + path.join("Work", "redcode"),
      "⎇ .red/worktrees/setup-flow",
      "⑂ setup-flow",
    ])
  })

  test("a non-Git directory keeps only the directory", () => {
    expect(locationLines({ directory: path.join(home, "notes"), home, width: 40 })).toEqual(["~" + path.sep + "notes"])
  })

  test("long lines lose their middle to fit the width", () => {
    const directory = path.join(project, ".red", "worktrees", "a-rather-long-worktree-name")
    const lines = locationLines({ directory, branch: "a-rather-long-worktree-name", home, width: 16 })
    expect(lines.slice(1)).toEqual(["⎇ .red/wo…e-name", "⑂ a-rathe…e-name"])
    expect(lines.every((line) => line.length <= 16)).toBe(true)
  })
})

test("sidebar footer shows the moved session's worktree and branch", async () => {
  const home = path.join(path.sep, "work")
  const directory = path.join(home, "redcode")
  const worktree = path.join(directory, ".red", "worktrees", "setup-flow")
  const requested: (string | undefined)[] = []
  const api = createTuiPluginApi({
    client: {
      vcs: {
        get: async (input: { directory?: string }) => {
          requested.push(input.directory)
          return { data: { branch: "setup-flow" } }
        },
      },
    } as unknown as TuiPluginApi["client"],
    state: { session: { get: () => ({ directory: worktree }) as never } },
  })
  Object.assign(api.state, { path: { directory, worktree: directory }, provider: [], vcs: { branch: "main" } })

  const app = await testRender(
    () => (
      <TestTuiContexts cwd={directory} paths={{ home }}>
        <SidebarFooter api={api} sessionID="session" />
      </TestTuiContexts>
    ),
    { width: 60, height: 18 },
  )

  try {
    const frame = await wait(app, (text) => text.includes("⑂ setup-flow"))
    expect(frame).toContain("~" + path.sep + "redcode")
    expect(frame).toContain("⎇ .red/worktrees/setup-flow")
    expect(frame).not.toContain("main")
    expect(requested).toEqual([worktree])
  } finally {
    app.renderer.destroy()
  }
})

/** Renders until `done` accepts the frame, for content that arrives after an async fetch. */
async function wait(app: Awaited<ReturnType<typeof testRender>>, done: (frame: string) => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    if (done(frame)) return frame
    await Bun.sleep(10)
  }
  await app.renderOnce()
  return app.captureCharFrame()
}

import path from "path"
import { describe, expect, test } from "bun:test"
import type { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ConfigWatch } from "@opencode/core/config/watch"
import { AbsolutePath } from "@opencode/core/schema"

const project = path.resolve("watch-plan-project")
const root = AbsolutePath.make(path.join(project, ".opencode"))
const sources: ConfigDiscovery.Sources = {
  direct: ["opencode.json", "opencode.jsonc"].map((name) => AbsolutePath.make(path.join(project, name))),
  project: [{ path: root, present: false }],
  claude: [AbsolutePath.make(path.join(project, ".claude"))],
  agents: [AbsolutePath.make(path.join(project, ".agents"))],
}
const ignored = [
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  "**/{node_modules,.git,.venv,venv,__pycache__}/**",
]

describe("ConfigWatch.plan", () => {
  test("excludes service state from the current global root without excluding config sources", () => {
    const global = AbsolutePath.make(path.join(project, ".red", "code"))
    const runtime = ["data", "cache", "state"].map((name) => path.join(global, name))
    const plan = ConfigWatch.plan({ ...sources, global }, runtime)
    expect(Array.from(plan.values())).toContainEqual({
      path: global,
      type: "directory",
      ignore: [...ignored, "data", "cache", "state"],
    })
    expect(Array.from(plan.values())).toContainEqual({
      path: project,
      type: "entries",
      names: [".agents", ".claude", ".opencode", "opencode.json", "opencode.jsonc"],
    })
  })

  test("uses contained runtime paths rather than ignoring unrelated config directories", () => {
    const runtime = [path.join(root, "runtime", "data"), path.resolve("watch-plan-external", "cache"), root]
    const plan = ConfigWatch.plan({ ...sources, project: [{ path: root, present: true }] }, runtime)
    expect(Array.from(plan.values())).toContainEqual({
      path: root,
      type: "directory",
      ignore: [...ignored, path.join("runtime", "data")],
    })
  })

  test("groups missing candidates and keeps parent watches when roots appear", () => {
    const missing = ConfigWatch.plan(sources)
    expect(Array.from(missing.values())).toEqual([
      { path: project, type: "entries", names: [".agents", ".claude", ".opencode", "opencode.json", "opencode.jsonc"] },
    ])
    const present = ConfigWatch.plan({ ...sources, project: [{ path: root, present: true }] })
    expect(Array.from(present.values())).toEqual([
      { path: root, type: "directory", ignore: ignored },
      ...missing.values(),
    ])
  })

  test("adds exact watches for explicit files only when not already covered", () => {
    expect(ConfigWatch.plan({ ...sources, explicit: sources.direct[0] })).toEqual(ConfigWatch.plan(sources))
    const present = { ...sources, project: [{ path: root, present: true }] }
    expect(ConfigWatch.plan({ ...present, explicit: AbsolutePath.make(path.join(root, "custom.json")) })).toEqual(
      ConfigWatch.plan(present),
    )
    const directory = path.resolve("watch-plan-external")
    expect(
      Array.from(
        ConfigWatch.plan({ ...sources, explicit: AbsolutePath.make(path.join(directory, "custom.json")) }).values(),
      ),
    ).toContainEqual({ path: directory, type: "entries", names: ["custom.json"] })
  })
})

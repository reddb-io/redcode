import { expect, test } from "bun:test"
import { cp, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"
import { Schema } from "effect"
import { Design } from "@opencode/schema/design"
import { DesignBuild } from "../src/design/build"
import { DesignFiles } from "../src/design/files"
import { git, initRepo } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"

test("a nested app in a temporary worktree reuses the primary monorepo's hoisted dependencies", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source")
  const worktree = path.join(tmp.path, "redcode-worktrees", "profile")
  await mkdir(path.join(source, "apps", "profile"), { recursive: true })
  await initRepo(source)
  await Bun.write(path.join(source, "apps", "profile", "package.json"), '{"name":"profile"}')
  await git(source, "add", ".")
  await git(source, "commit", "-m", "profile")
  await mkdir(path.join(source, "node_modules"), { recursive: true })
  // Use the installed React packages themselves, including React DOM's scheduler dependency.
  const require = createRequire(import.meta.url)
  await Promise.all(
    ["react", "react-dom", "scheduler"].map(async (name) => {
      const manifest =
        name === "scheduler"
          ? createRequire(require.resolve("react-dom/package.json")).resolve("scheduler/package.json")
          : require.resolve(`${name}/package.json`)
      await cp(await realpath(path.dirname(manifest)), path.join(source, "node_modules", name), { recursive: true })
    }),
  )
  await git(source, "worktree", "add", "-b", "profile", worktree)
  const application = path.join(worktree, "apps", "profile")
  expect(await DesignBuild.home(application)).toBe(path.join(source, "apps", "profile"))
  expect(await Bun.file(path.join(worktree, "node_modules")).exists()).toBe(false)
  const root = path.join(application, ".red", "code", "design", "design_profile", "work")
  await Bun.write(
    path.join(root, "src", "main.tsx"),
    `import { createRoot } from "react-dom/client"
createRoot(document.getElementById("root")!).render(<main>Profile subscription</main>)`,
  )
  const document = Schema.decodeUnknownSync(Design.Info)({
    id: "design_profile",
    sessionID: "ses_profile",
    name: "Profile",
    journey: "new",
    engine: "react",
    kind: "screen",
    root,
    application,
    entry: "src/main.tsx",
    brief: { objective: "Profile", audience: "", content: "", constraints: "", references: [] },
    decisions: [],
    questions: [],
    scenarios: [],
    designSystem: "",
    system: { framework: "react", paths: [], css: [], tailwind: false },
    sources: [],
    tweaks: {},
    revision: null,
    approvedRevision: null,
    ended: false,
    updated: 1,
  })
  const blobs = path.join(tmp.path, "blobs")
  expect(await DesignBuild.dependencies(document)).toContain("no node_modules symlink needed")
  const output = await DesignBuild.build(
    {
      id: "rev_profile",
      designID: document.id,
      parent: null,
      name: "Profile",
      created: 1,
      document,
      files: await DesignFiles.snapshot(root, blobs),
    },
    blobs,
    path.join(tmp.path, "build"),
  )
  expect(await Bun.file(path.join(output, "index.html")).text()).toContain("assets/")
  const bundles = await Array.fromAsync(new Bun.Glob("assets/*.js").scan({ cwd: output, absolute: true }))
  expect(bundles).toHaveLength(1)
  expect(await Bun.file(bundles[0]).text()).toContain("Profile subscription")
  expect(await Bun.file(path.join(worktree, "node_modules")).exists()).toBe(false)
  await mkdir(path.join(worktree, "node_modules"), { recursive: true })
  expect(await DesignBuild.home(application)).toBe(application)
  await git(source, "worktree", "remove", "--force", worktree)
}, 30_000)

test("missing dependencies do not cause a checkout switch in a non-Git project", async () => {
  await using tmp = await tmpdir()
  expect(await DesignBuild.home(tmp.path)).toBe(tmp.path)
})

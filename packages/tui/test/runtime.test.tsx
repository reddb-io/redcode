import { expect, test } from "bun:test"
import path from "path"
import { testRender } from "@opentui/solid"
import { abbreviateHome } from "../src/runtime"
import { TuiPathsProvider, useTuiPaths } from "../src/context/runtime"

test("abbreviates paths within home boundaries", () => {
  // The separator comes from the platform, so the expectation has to as well: pinning "/" only
  // proved this had never run on Windows.
  const home = path.join(path.sep, "home", "test")
  expect(abbreviateHome(home, home)).toBe("~")
  expect(abbreviateHome(path.join(home, "project"), home)).toBe("~" + path.sep + "project")
  const sibling = path.join(path.sep, "home", "tester", "project")
  expect(abbreviateHome(sibling, home)).toBe(sibling)
  const elsewhere = path.join(path.sep, "tmp", "project")
  expect(abbreviateHome(elsewhere, home)).toBe(elsewhere)
})

test("provides focused immutable runtime inputs", async () => {
  let paths: ReturnType<typeof useTuiPaths>

  function Runtime() {
    paths = useTuiPaths()
    return <text>{paths.cwd}</text>
  }

  const app = await testRender(
    () => (
      <TuiPathsProvider value={{ cwd: "/work", home: "/home/test", state: "/state", worktree: "/worktree" }}>
        <Runtime />
      </TuiPathsProvider>
    ),
    { width: 40, height: 3 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("/work")
    expect(Object.isFrozen(paths!)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

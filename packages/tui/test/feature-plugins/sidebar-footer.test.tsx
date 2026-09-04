/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import path from "path"
import { testRender } from "@opentui/solid"
import { SidebarFooter } from "../../src/feature-plugins/sidebar/footer"
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
    { width: 60, height: 12 },
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

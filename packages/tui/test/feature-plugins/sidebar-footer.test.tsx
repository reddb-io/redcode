/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { SidebarFooter } from "../../src/feature-plugins/sidebar/footer"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiPluginApi } from "../fixture/tui-plugin"

test("sidebar footer omits the product and version line", async () => {
  const api = createTuiPluginApi()
  Object.assign(api, { app: { version: "1.2.3" } })
  Object.assign(api.state, {
    path: { directory: "/work/redcode" },
    provider: [],
    vcs: { branch: "main" },
  })

  const app = await testRender(
    () => (
      <TestTuiContexts cwd="/work/redcode" paths={{ home: "/work" }}>
        <SidebarFooter api={api} sessionID="session" />
      </TestTuiContexts>
    ),
    { width: 60, height: 12 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("~/redcode")
    expect(frame).not.toContain("OpenCode")
    expect(frame).not.toContain("1.2.3")
  } finally {
    app.renderer.destroy()
  }
})

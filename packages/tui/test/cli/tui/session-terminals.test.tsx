/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { PersistentPtyInfo } from "@opencode/client"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTerminalsProvider, useSessionTerminals } from "../../../src/context/session-terminals"
import { StorageProvider } from "../../../src/context/storage"
import { tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

function terminal(id: string, status: PersistentPtyInfo["status"]): PersistentPtyInfo {
  return {
    id,
    status,
    sessionID: "parent",
    title: id,
    command: "sh",
    args: [],
    cwd: directory,
    pid: 42,
    foregroundProcess: null,
    output: { head: 0, tail: 0 },
    size: { cols: 80, rows: 24 },
  }
}

test("unattended terminal exits clear live panes, selection and focus without deleting output", async () => {
  await using temporary = await tmpdir()
  let list = [terminal("pty_live", "running"), terminal("pty_old", "exited")]
  const writes: string[] = []
  const events = createEventStream()
  const calls = createFetch((url, request) => {
    if (request.method !== "GET") writes.push(url.pathname)
    if (url.pathname === "/api/experimental/session/parent/terminal") return json({ data: list })
  }, events)
  let terminals!: ReturnType<typeof useSessionTerminals>
  function Content() {
    terminals = useSessionTerminals()
    return (
      <text>
        {terminals
          .get("parent")
          .terminals.map((entry) => entry.title)
          .join(" ") || "No live terminals"}
      </text>
    )
  }
  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig({}, { terminal: true })}>
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider directory={directory}>
                  <SessionTerminalsProvider>
                    <Content />
                  </SessionTerminalsProvider>
                </DataProvider>
              </ClientProvider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 10 },
  )
  try {
    app.renderer.start()
    await terminals.refresh("parent")
    await app.waitForFrame((frame) => frame.includes("pty_live"))
    expect(app.captureCharFrame()).not.toContain("pty_old")
    await terminals.selectTerminal("parent", "pty_live")
    expect(terminals.shouldFocus("pty_live")).toBe(true)
    list = list.map((entry) => ({ ...entry, status: "exited" }))
    // No Removed event or visible WebSocket: the periodic reconciliation must observe this exit.
    const deadline = Date.now() + 5_000
    while (terminals.get("parent").terminals.length || terminals.get("parent").selectedTerminalID) {
      if (Date.now() > deadline) throw new Error("Unattended terminal exit was not reconciled")
      await Bun.sleep(10)
    }
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("No live terminals")
    expect(terminals.get("parent").selectedTerminalID).toBeNull()
    expect(terminals.shouldFocus("pty_live")).toBe(false)
    expect(writes).toEqual([])
    expect(list).toHaveLength(2)
    // Reopening the session cannot resurrect a retained exited daemon record.
    await terminals.refresh("parent")
    expect(terminals.get("parent").terminals).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

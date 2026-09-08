/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { DialogGoalBudget } from "../../src/component/dialog-goal-budget"
import { SDKProvider } from "../../src/context/sdk"
import { mountDialog } from "../fixture/dialog"
import { tmpdir } from "../fixture/fixture"
import { eventSource, json } from "../fixture/tui-sdk"
import { wait } from "../cli/cmd/tui/sync-fixture"

test("budget dialog rejects invalid limits and sends a valid total to the captured session", async () => {
  await using tmp = await tmpdir()
  const requests: Array<{ url: string; body: unknown }> = []
  const fetcher: typeof fetch = Object.assign(
    async (input: string | URL | Request) => {
      if (!(input instanceof Request)) throw new Error("SDK must pass a request")
      requests.push({ url: input.url, body: await input.json() })
      return json({ id: "goal_test", status: "paused", turns: { used: 2, max: 10 } })
    },
    { preconnect: fetch.preconnect },
  )
  const app = await mountDialog({
    root: tmp.path,
    children: () => (
      <SDKProvider url="http://test" fetch={fetcher} events={eventSource()}>
        <DialogGoalBudget sessionID="ses_captured" />
      </SDKProvider>
    ),
  })
  try {
    await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const textarea = app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("Budget input not focused")
    for (const text of ["", "0", "1.5", "Infinity", "9007199254740992"]) {
      textarea.setText(text)
      app.mockInput.pressEnter()
      expect(requests).toEqual([])
    }
    textarea.setText("10")
    app.mockInput.pressEnter()
    await wait(() => requests.length === 1)
    expect(requests).toEqual([{ url: "http://test/session/ses_captured/goal/budget", body: { max_turns: 10 } }])
  } finally {
    app.renderer.destroy()
  }
})

/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { QuestionPrompt } from "../../src/routes/session/question"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount, wait, json } from "../cli/cmd/tui/sync-fixture"

test("long plan approval keeps answers and dismiss visible and keyboard usable", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const replies: unknown[] = []
  function Prompt() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
    onCleanup(registerOpencodeKeymap(keymap, renderer, config))
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <TuiConfigProvider config={config}>
          <ThemeProvider mode="dark">
            <QuestionPrompt
              request={{
                id: "que_plan",
                sessionID: "ses_test",
                questions: [
                  {
                    header: "Execute plan",
                    question: `Execute plan?\n${"A detailed implementation step with code and acceptance criteria.\n".repeat(150)}END OF PLAN`,
                    options: [
                      { label: "Approve", description: "Execute the recorded plan" },
                      { label: "Revise", description: "Continue planning" },
                    ],
                    custom: false,
                  },
                ],
              }}
            />
          </ThemeProvider>
        </TuiConfigProvider>
      </OpencodeKeymapProvider>
    )
  }
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/question/que_plan/reply" && input instanceof Request) {
        replies.push(await input.json())
        return json(true)
      }
    },
    tmp.path,
    () => <Prompt />,
  )
  try {
    await setup.app.renderOnce()
    await Bun.sleep(50)
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("1. Approve")
    expect(setup.app.captureCharFrame()).toContain("dismiss")
    for (let index = 0; index < 30; index++) setup.app.mockInput.pressKey("\u001b[6~")
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("END OF PLAN")
    expect(setup.app.captureCharFrame()).toContain("1. Approve")
    setup.app.mockInput.pressKey("2")
    await wait(() => replies.length === 1)
    expect(replies).toEqual([{ answers: [["Revise"]] }])
  } finally {
    setup.app.renderer.destroy()
  }
})

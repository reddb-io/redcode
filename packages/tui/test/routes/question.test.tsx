/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { QuestionPrompt } from "../../src/routes/session/question"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../src/keymap"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { tmpdir } from "../fixture/fixture"
import { mount, wait, json } from "../cli/cmd/tui/sync-fixture"

const decision =
  "Tabela de leads → colunas reordenáveis [status, origem, responsável] com filtros persistidos por $domain/$resource e paginação server-side; ações em massa só aparecem quando há seleção — ícones à direita"
/** The legacy plan_exit question after a Design approval: unwrapped long lines, accents, arrows and the handoff block. */
const handoff = [
  "Execute plan .red/code/plans/1789386287606-shiny-harbor.md (revision c2f8c9fb6bfa7ba65718b25fea3a5d49588767caa0ee6dd)?",
  "",
  "# Implementation plan",
  ...Array.from({ length: 30 }, (_, index) => `- Step ${index}: ${decision}`),
  "<!-- redcode:design:start -->",
  "Approved Design design_87d1d4df-1234: Leads – redesign das tabelas do admin. Revision: rev_98aa",
  "Immutable approval package: /home/user/app/.red/code/design/design_87d1d4df-1234.json.",
  "Selected variant: Densa (variant_1)",
  "Objective: Not recorded",
  "Decisions:",
  ...Array.from({ length: 25 }, (_, index) => `- ${index}. ${decision} ${decision}`),
  "Acceptance criteria:",
  ...Array.from({ length: 12 }, (_, index) => `- ${decision} (critério ${index})`),
  "<!-- redcode:design:end -->",
  "",
  "Execution tasks:",
  ...Array.from({ length: 10 }, (_, index) => `- t${index}: ${decision} — ${decision}`),
  "END OF HANDOFF",
].join("\n")

function PlanExitPrompt(props: { question: string }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
  onCleanup(registerOpencodeKeymap(keymap, renderer, config))
  return (
    <OpencodeKeymapProvider keymap={keymap}>
      <TuiConfigProvider config={config}>
        <ThemeProvider mode="dark">
          <ToastProvider>
            <QuestionPrompt
              request={{
                id: "que_exit",
                sessionID: "ses_test",
                questions: [
                  {
                    header: "Build Agent",
                    question: props.question,
                    options: [
                      { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                      { label: "No", description: "Stay with plan agent to continue refining the plan" },
                    ],
                    custom: false,
                  },
                ],
              }}
            />
            <Toast />
          </ToastProvider>
        </ThemeProvider>
      </TuiConfigProvider>
    </OpencodeKeymapProvider>
  )
}

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
            <ToastProvider>
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
            </ToastProvider>
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

test("plan_exit with a Design handoff renders and Yes submits", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const replies: unknown[] = []
  const setup = await mount(
    async (url, input) => {
      if (url.pathname === "/question/que_exit/reply" && input instanceof Request) {
        replies.push(await input.json())
        return json(true)
      }
    },
    tmp.path,
    () => <PlanExitPrompt question={handoff} />,
    { width: 200, height: 50 },
  )
  try {
    await setup.app.renderOnce()
    await Bun.sleep(50)
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("1. Yes")
    for (let index = 0; index < 40; index++) setup.app.mockInput.pressKey("\u001b[6~")
    await setup.app.renderOnce()
    expect(setup.app.captureCharFrame()).toContain("END OF HANDOFF")
    setup.app.mockInput.pressKey("\r")
    await wait(() => replies.length === 1)
    expect(replies).toEqual([{ answers: [["Yes"]] }])
  } finally {
    setup.app.renderer.destroy()
  }
})

for (const [name, key, route] of [
  ["Yes", "\r", "reply"],
  ["Escape", "\u001b", "reject"],
] as const) {
  test(`a plan approval the server no longer knows is dropped on ${name} instead of freezing`, async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const calls: string[] = []
    const setup = await mount(
      async (url) => {
        if (url.pathname !== `/question/que_exit/${route}`) return
        calls.push(url.pathname)
        return Response.json(
          { name: "QuestionNotFoundError", data: { requestID: "que_exit", message: "Question request not found" } },
          { status: 404 },
        )
      },
      tmp.path,
      () => <PlanExitPrompt question={handoff} />,
    )
    try {
      setup.sync.set("question", "ses_test", [
        { id: "que_exit", sessionID: "ses_test", questions: [{ header: "Build Agent", question: "x", options: [] }] },
      ])
      await setup.app.renderOnce()
      await Bun.sleep(50)
      await setup.app.renderOnce()
      setup.app.mockInput.pressKey(key)
      await wait(() => calls.length === 1)
      await wait(() => (setup.sync.data.question.ses_test ?? []).length === 0)
      await setup.app.renderOnce()
      expect(setup.app.captureCharFrame()).toContain("no longer active")
    } finally {
      setup.app.renderer.destroy()
    }
  })
}

/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { ModelSuggestion } from "@reddb-io/redcode-schema/model-suggestion"
import {
  answerSuggestion,
  KEEP_COMMAND,
  ModelSuggestionView,
  suggestionText,
  SWITCH_COMMAND,
} from "../../src/component/model-suggestion"
import { useOpencodeKeymap } from "../../src/keymap"
import { mountDialog } from "../fixture/dialog"
import { wait } from "../cli/cmd/tui/sync-fixture"
import { tmpdir } from "../fixture/fixture"

const suggestion: ModelSuggestion.Info = {
  trigger: "vision",
  current: { providerID: "red-router", modelID: "text-only" },
  model: { providerID: "red-router", modelID: "pin:claude@bedrock" },
  name: "Claude Sonnet 4.5",
  kind: "flat",
  why: [{ code: "vision", detail: "supports vision" }],
  whyText: "supports vision",
  delta: { pricePct: -45.5, context: 72_000, gained: ["vision"], lost: [] },
}

const label = "RedRouter » Bedrock · Claude Sonnet 4.5"

test("the card reads the route, the reason and the deltas", () => {
  expect(suggestionText(suggestion, label)).toEqual({
    title: `Suggest: ${label}`,
    why: "supports vision",
    deltas: "price -45.5% · context +72K · +vision",
  })
  expect(suggestionText({ ...suggestion, delta: undefined }, label).deltas).toBe("")
})

test("the card says when the current model's exhausted quota resets, in local time", () => {
  const now = Date.parse("2026-09-25T12:00:00")
  const until = Date.parse("2026-09-25T14:30:00")
  const time = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  expect(suggestionText({ ...suggestion, until }, label, now).deltas).toBe(
    `quota until ${time} · price -45.5% · context +72K · +vision`,
  )
  // A reset already past says nothing.
  expect(suggestionText({ ...suggestion, until }, label, until + 1).deltas).toBe(
    "price -45.5% · context +72K · +vision",
  )
})

test("only switch selects the suggested model, a flat offer by its pin id; keep selects nothing", async () => {
  const selected: unknown[] = []
  const resolved: unknown[] = []
  const answer = (choice: ModelSuggestion.Choice) =>
    answerSuggestion({
      suggestion,
      choice,
      select: (model) => selected.push(model),
      unavailable: () => {
        throw new Error("the model is still available")
      },
      resolve: async (value) => {
        resolved.push(value)
        return true
      },
    })
  await answer("keep")
  expect(selected).toEqual([])
  expect(resolved).toEqual([{ trigger: "vision", choice: "keep" }])
  await answer("switch")
  expect(selected).toEqual([{ providerID: "red-router", modelID: "pin:claude@bedrock" }])
  expect(resolved.at(-1)).toEqual({ trigger: "vision", choice: "switch" })
})

test("a failed answer to the server still switches and never throws", async () => {
  const selected: unknown[] = []
  await answerSuggestion({
    suggestion,
    choice: "switch",
    select: (model) => selected.push(model),
    unavailable: () => {},
    resolve: () => Promise.reject(new Error("offline")),
  })
  expect(selected).toHaveLength(1)
})

test("switch selects nothing when the server says the model is no longer available", async () => {
  const selected: unknown[] = []
  const gone: unknown[] = []
  await answerSuggestion({
    suggestion,
    choice: "switch",
    select: (model) => selected.push(model),
    unavailable: () => gone.push(suggestion.model),
    resolve: async () => false,
  })
  expect(selected).toEqual([])
  expect(gone).toHaveLength(1)
})

test("the card answers by click and by command, and leaves the prompt its keys", async () => {
  await using tmp = await tmpdir()
  const answers: ModelSuggestion.Choice[] = []
  let dispatch: (command: string) => void = () => {}
  function Card() {
    const keymap = useOpencodeKeymap()
    dispatch = (command) => keymap.dispatchCommand(command)
    return (
      <>
        <ModelSuggestionView suggestion={suggestion} label={label} onAnswer={(choice) => answers.push(choice)} />
        <input id="prompt" placeholder="Ask anything" focused />
      </>
    )
  }
  const setup = await mountDialog({ root: tmp.path, children: () => <Card /> })
  try {
    await wait(() => !!setup.renderer.currentFocusedEditor)
    await setup.renderOnce()
    const screen = setup.captureCharFrame()
    expect(screen).toContain("Suggest: RedRouter » Bedrock · Claude Sonnet 4.5")
    expect(screen).toContain("supports vision")
    expect(screen).toContain("price -45.5% · context +72K · +vision")
    expect(screen).toContain("/switch-model · /keep-model")
    // Rendering alone answers nothing.
    expect(answers).toEqual([])

    const lines = screen.split("\n")
    const row = lines.findIndex((line) => line.includes("/switch-model"))
    await setup.mockMouse.click(lines[row]!.indexOf("keep") + 1, row)
    expect(answers).toEqual(["keep"])

    dispatch(SWITCH_COMMAND)
    dispatch(KEEP_COMMAND)
    expect(answers).toEqual(["keep", "switch", "keep"])

    setup.mockInput.typeText("still typing")
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("still typing")
    expect(answers).toEqual(["keep", "switch", "keep"])
  } finally {
    setup.renderer.destroy()
  }
})

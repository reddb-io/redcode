import { afterEach, describe, expect, test } from "bun:test"
import { createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import {
  formatCompletedSubagentDetail,
  formatSubagentRetry,
  formatSubagentTitle,
  formatSubagentToolcalls,
  InlineToolRow,
  parseApplyPatchFiles,
  parseDiagnostics,
  parseQuestionAnswers,
  parseQuestions,
  parseTodos,
  alwaysSeparate,
  createTodoFold,
  foldTodoFailures,
  TodoFailureRow,
  TodoFailureRunsProvider,
  toolDisplay,
} from "../../../src/routes/session"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

type ToolFixture = { icon: string; label: string; error?: string }

const tools: readonly ToolFixture[] = [
  {
    icon: "✱",
    label:
      'Grep "OPENCODE.*DB|database|sqlite|drizzle|dev.*db|data.*dir|xdg|APPDATA" in packages/redcode/src (151 matches)',
  },
  {
    icon: "✱",
    label: 'Glob "**/*db*" in packages/redcode (6 matches)',
  },
  {
    icon: "→",
    label: "Read packages/redcode/src/storage/db.ts [offset=1, limit=130]",
  },
  {
    icon: "→",
    label: "Read packages/redcode/src/index.ts [offset=1, limit=100]",
    error: "No LSP server available for this file type.",
  },
  {
    icon: "✱",
    label:
      'Grep "export const OPENCODE_DB|OPENCODE_DB|OPENCODE_DEV|Global\\.Path\\.data|data =" in packages/redcode/src (115 matches)',
  },
] as const

function ShellOutput() {
  return (
    <box
      ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
      marginTop={1}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      gap={1}
    >
      <box gap={1}>
        <text>$ ls</text>
        <text>file.ts</text>
      </box>
    </box>
  )
}

function UserMessage() {
  return (
    <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2}>
        <text>Check whether the next tool remains separated.</text>
      </box>
    </box>
  )
}

function Fixture(props: { errorExpanded?: boolean; before?: "shell" | "user" }) {
  return (
    <box flexDirection="column" width={72}>
      <box flexDirection="column">
        {props.before === "shell" && <ShellOutput />}
        {props.before === "user" && <UserMessage />}
        <For each={tools}>
          {(item) => (
            <InlineToolRow
              icon={item.icon}
              complete={true}
              pending=""
              failed={Boolean(item.error)}
              error={item.error}
              errorExpanded={props.errorExpanded}
            >
              {item.label}
            </InlineToolRow>
          )}
        </For>
      </box>
    </box>
  )
}

function TaskRowsFixture() {
  return (
    <box flexDirection="column" width={72}>
      <InlineToolRow icon="✱" complete={true} pending="">
        Grep "Task" (2 matches)
      </InlineToolRow>
      <InlineToolRow icon="⠙" complete={true} pending="" separate={true}>
        Explore Task — Inspect active task spacing
      </InlineToolRow>
      <InlineToolRow icon="✓" complete={true} pending="" separate={true}>
        {"General Task — Confirm completed task spacing\n↳ 1 toolcall · 501ms"}
      </InlineToolRow>
      <InlineToolRow icon="→" complete={true} pending="">
        Read src/cli/cmd/tui/routes/session/index.tsx
      </InlineToolRow>
    </box>
  )
}

function LoadedReadBeforeTaskFixture() {
  return (
    <box flexDirection="column" width={72}>
      <InlineToolRow icon="→" complete={true} pending="">
        Read src/cli/cmd/tui/routes/session/index.tsx
      </InlineToolRow>
      <box paddingLeft={3}>
        <text paddingLeft={3}>↳ Loaded src/cli/cmd/tui/routes/session/tools.tsx</text>
      </box>
      <InlineToolRow icon="✓" complete={true} pending="" separate={true}>
        {"Explore Task — Inspect active task spacing\n↳ 1 toolcall · 501ms"}
      </InlineToolRow>
    </box>
  )
}

function AssistantSummaryBeforeInlineFixture() {
  return (
    <box flexDirection="column" width={72}>
      <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3}>
        <text>▣ Build · Little Frank · 53.1s</text>
      </box>
      <InlineToolRow icon="✓" complete={true} pending="">
        {"Build Task — Review changes\n↳ 48 toolcalls · 1m 40s"}
      </InlineToolRow>
    </box>
  )
}

function AssistantErrorBeforeInlineFixture() {
  return (
    <box flexDirection="column" width={72}>
      <box
        ref={(el: BoxRenderable) => alwaysSeparate.add(el)}
        border={["left"]}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
      >
        <text>Managed inference requires an active Member plan</text>
      </box>
      <InlineToolRow icon="✓" complete={true} pending="">
        {"Build Task — Review changes\n↳ 48 toolcalls · 1m 40s"}
      </InlineToolRow>
    </box>
  )
}

function StickyScrollFixture(props: { separated: boolean; scroll: (scroll: ScrollBoxRenderable) => void }) {
  return (
    <scrollbox ref={props.scroll} stickyScroll={true} stickyStart="bottom" height={3} width={72}>
      <box height={1}>
        <text>First row</text>
      </box>
      <box height={1}>
        <text>Second row</text>
      </box>
      <Show when={props.separated}>
        <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)}>
          <text>Assistant text</text>
        </box>
      </Show>
      <InlineToolRow icon="→" complete={true} pending="">
        Read src/cli/cmd/tui/routes/session/index.tsx
      </InlineToolRow>
    </scrollbox>
  )
}

function FailedPendingToolFixture() {
  return (
    <InlineToolRow icon="%" complete={false} pending="Preparing patch…" failed={true} failure="Patch failed">
      Patch
    </InlineToolRow>
  )
}

function FailedCompleteToolFixture() {
  return (
    <InlineToolRow icon="→" complete={true} pending="Reading file…" failed={true} failure="Read failed">
      Read src/index.ts
    </InlineToolRow>
  )
}

async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
  testSetup = await testRender(component, options)
  await testSetup.renderOnce()
  await testSetup.renderOnce()

  return testSetup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

describe("TUI inline tool wrapping", () => {
  test("falls back for unknown tool names", () => {
    expect(toolDisplay("bash")).toBe("bash")
    expect(toolDisplay("plugin_tool")).toBe("generic")
  })

  test("replaces pending copy when a tool fails before completion", async () => {
    const frame = await renderFrame(() => <FailedPendingToolFixture />, { width: 72, height: 3 })
    expect(frame).toContain("Patch failed")
    expect(frame).not.toContain("Preparing patch")
  })

  test("folds failed todowrite runs across assistant messages, broken by user messages and rendered parts", () => {
    const todo = (id: string, status = "error") => ({ id, type: "tool", tool: "todowrite", state: { status } })
    const parts: Record<
      string,
      Array<{ id: string; type: string; tool?: string; text?: string; state?: { status: string } }>
    > = {
      a1: [{ id: "t1", type: "text", text: "Completing" }, todo("f1")],
      a2: [{ id: "s2", type: "step-start" }, { id: "r2", type: "reasoning", text: "retry" }, todo("f2")],
      a3: [
        { id: "e3", type: "text", text: "  " },
        todo("f3"),
        { id: "read", type: "tool", tool: "read", state: { status: "completed" } },
        todo("f4"),
      ],
      u: [{ id: "ut", type: "text", text: "keep going" }],
      a4: [todo("f5"), todo("ok", "completed"), todo("f6")],
    }
    const runs = foldTodoFailures(
      [
        { id: "a1", role: "assistant" },
        { id: "a2", role: "assistant" },
        { id: "a3", role: "assistant" },
        { id: "u", role: "user" },
        { id: "a4", role: "assistant" },
      ],
      (id) => parts[id] ?? [],
    )
    for (const id of ["f1", "f2", "f3"])
      expect(runs.get(id)).toMatchObject({ lead: "f1", count: 3, latest: { id: "f3" } })
    // A rendered tool breaks the run, as does a user message and a successful todowrite.
    expect(runs.get("f4")).toMatchObject({ lead: "f4", count: 1 })
    expect(runs.get("f5")).toMatchObject({ lead: "f5", count: 1 })
    expect(runs.get("f6")).toMatchObject({ lead: "f6", count: 1 })
    expect(runs.has("ok")).toBe(false)
  })

  test("re-folds only live messages while a session streams, with the same runs as a full fold", () => {
    type Fixture = { id: string; type: string; tool?: string; text?: string; state?: { status: string } }
    const todo = (id: string): Fixture => ({ id, type: "tool", tool: "todowrite", state: { status: "error" } })
    const parts: Record<string, Fixture[]> = {
      a1: [{ id: "t1", type: "text", text: "Completing" }, todo("f1")],
      a2: [{ id: "r2", type: "reasoning", text: "retry" }, todo("f2")],
      a3: [todo("f3")],
    }
    const messages = [
      { id: "a1", role: "assistant", time: { completed: 1 } },
      { id: "a2", role: "assistant", time: { completed: 2 } },
      { id: "a3", role: "assistant", time: {} },
    ]
    // Counts reductions of a message's parts; the cache key still reads each part's status by index.
    const walks: string[] = []
    const partsOf = (id: string): Fixture[] =>
      new Proxy(parts[id] ?? [], {
        get(target, key, receiver) {
          if (key === Symbol.iterator) walks.push(id)
          return Reflect.get(target, key, receiver)
        },
      })
    const full = (list: typeof messages) => [...foldTodoFailures(list, (id) => parts[id] ?? [])]
    const fold = createTodoFold<Fixture>()
    const first = fold(messages, partsOf)
    expect([...first]).toEqual(full(messages))
    expect(first.get("f3")).toMatchObject({ lead: "f1", count: 3 })
    // A streamed token in the live message: finished messages are not walked again.
    walks.length = 0
    parts.a3 = [...parts.a3!, { id: "t3", type: "text", text: "" }]
    expect([...fold(messages, partsOf)]).toEqual(full(messages))
    expect(walks).toEqual(["a3"])
    // The live message finishing with a rendered part breaks the run, and is then cached too.
    parts.a3 = [...parts.a3!, { id: "t4", type: "text", text: "Done" }, todo("f4")]
    const finished = [...messages.slice(0, 2), { id: "a3", role: "assistant", time: { completed: 3 } }]
    const settled = fold(finished, partsOf)
    expect([...settled]).toEqual(full(finished))
    expect(settled.get("f4")).toMatchObject({ lead: "f4", count: 1 })
    walks.length = 0
    fold(finished, partsOf)
    expect(walks).toEqual([])
    // A tool part that settles as an error after its message finished is folded in.
    parts.a2 = [
      parts.a2![0]!,
      parts.a2![1]!,
      { id: "late", type: "tool", tool: "todowrite", state: { status: "running" } },
    ]
    expect(fold(finished, partsOf).has("late")).toBe(false)
    parts.a2 = [parts.a2[0]!, parts.a2[1]!, { ...parts.a2[2]!, state: { status: "error" } }]
    const late = fold(finished, partsOf)
    expect([...late]).toEqual(full(finished))
    expect(late.get("late")).toMatchObject({ lead: "f1", count: 4 })
    // So does a todowrite part that is not the last one settling as an error later.
    parts.a3 = parts.a3!.map((part) => (part.id === "f3" ? { ...part, state: { status: "running" } } : part))
    const pending = fold(finished, partsOf)
    expect([...pending]).toEqual(full(finished))
    expect(pending.has("f3")).toBe(false)
    parts.a3 = parts.a3.map((part) => (part.id === "f3" ? { ...part, state: { status: "error" } } : part))
    const settledLate = fold(finished, partsOf)
    expect([...settledLate]).toEqual(full(finished))
    expect(settledLate.get("f3")).toMatchObject({ lead: "f1", count: 4 })
    // A part removed from a finished message is noticed as well.
    parts.a2 = parts.a2.slice(0, 2)
    const removed = fold(finished, partsOf)
    expect([...removed]).toEqual(full(finished))
    expect(removed.has("late")).toBe(false)
    expect(removed.get("f1")).toMatchObject({ lead: "f1", count: 3 })
    // So is an error recorded on a finished message.
    const errored = finished.map((message) => (message.id === "a1" ? { ...message, error: { name: "x" } } : message))
    expect([...fold(errored, partsOf)]).toEqual(full(errored))
    expect(fold(errored, partsOf).get("f1")).toMatchObject({ count: 1 })
  })

  test("does not fold failures across a revert boundary", () => {
    const todo = (id: string) => ({ id, type: "tool", tool: "todowrite", state: { status: "error" } })
    const parts: Record<string, Array<ReturnType<typeof todo>>> = {
      a1: [todo("f1")],
      a2: [todo("f2")],
      a3: [todo("f3")],
      a4: [todo("f4")],
    }
    const messages = ["a1", "a2", "a3", "a4"].map((id) => ({ id, role: "assistant" }))
    // Everything from the reverted message on is hidden, so nothing there joins or extends a visible run.
    const runs = foldTodoFailures(messages, (id) => parts[id] ?? [], "a3")
    expect(runs.get("f1")).toMatchObject({ lead: "f1", count: 2, latest: { id: "f2" } })
    expect(runs.has("f3")).toBe(false)
    expect(runs.has("f4")).toBe(false)
    expect(createTodoFold()(messages, (id) => parts[id] ?? [], "a3")).toEqual(runs)
  })

  test("renders one counted todowrite failure row across messages without remounting it as the run grows", async () => {
    type FixturePart = { id: string; type: string; tool: string; state: { status: string; error: string } }
    const failure = (id: string, error: string): FixturePart => ({
      id,
      type: "tool",
      tool: "todowrite",
      state: { status: "error", error },
    })
    const [store, setStore] = createStore<{
      messages: Array<{ id: string; role: string }>
      parts: Record<string, FixturePart[]>
    }>({
      messages: [
        { id: "a1", role: "assistant" },
        { id: "a2", role: "assistant" },
      ],
      parts: { a1: [failure("f1", "first refusal")], a2: [failure("f2", "second refusal")] },
    })
    let mounts = 0
    let expand = () => {}
    function Row(props: { failure: string; part: FixturePart }) {
      mounts++
      const [expanded, setExpanded] = createSignal(false)
      expand = () => setExpanded(true)
      return (
        <InlineToolRow
          icon="⚙"
          complete={false}
          pending="Updating todos…"
          failed={true}
          failure={props.failure}
          error={props.part.state.error}
          errorExpanded={expanded()}
        >
          Updating todos…
        </InlineToolRow>
      )
    }
    const frame = async () => {
      await testSetup!.renderOnce()
      await testSetup!.renderOnce()
      return testSetup!.captureCharFrame()
    }
    testSetup = await testRender(
      () => (
        <box flexDirection="column" width={72}>
          <TodoFailureRunsProvider messages={store.messages} parts={(id) => store.parts[id] ?? []}>
            <For each={store.messages}>
              {(message) => (
                <For each={store.parts[message.id]}>{(part) => <TodoFailureRow part={part} row={Row} />}</For>
              )}
            </For>
          </TodoFailureRunsProvider>
        </box>
      ),
      { width: 72, height: 6 },
    )
    const two = await frame()
    expect(two).toContain("Todo update failed ×2")
    expect(two.match(/Todo update failed/g)).toHaveLength(1)
    expect(mounts).toBe(1)
    expand()
    expect(await frame()).toContain("second refusal")
    setStore(
      produce((draft) => {
        draft.messages.push({ id: "a3", role: "assistant" })
        draft.parts.a3 = [failure("f3", "third refusal")]
      }),
    )
    const three = await frame()
    expect(three).toContain("Todo update failed ×3")
    expect(three.match(/Todo update failed/g)).toHaveLength(1)
    // Still expanded, now quoting the latest refusal: the row was updated in place, not remounted.
    expect(three).toContain("third refusal")
    expect(three).not.toContain("second refusal")
    expect(mounts).toBe(1)
  })

  test("preserves useful completed copy when a tool fails", async () => {
    const frame = await renderFrame(() => <FailedCompleteToolFixture />, { width: 72, height: 3 })
    expect(frame).toContain("Read src/index.ts")
    expect(frame).not.toContain("Read failed")
  })

  test("filters malformed nested tool wire data", () => {
    expect(
      parseApplyPatchFiles([
        null,
        { type: "add" },
        { type: "add", relativePath: "a.ts", filePath: "a.ts", patch: "diff", deletions: 0 },
      ]),
    ).toEqual([
      { type: "add", relativePath: "a.ts", filePath: "a.ts", patch: "diff", deletions: 0, movePath: undefined },
    ])
    expect(parseTodos([null, { status: "pending" }, { status: "pending", content: "Safe" }])).toEqual([
      { status: "pending", content: "Safe" },
    ])
    expect(parseQuestions([{}, { question: 1 }, { question: "Continue?" }])).toEqual([{ question: "Continue?" }])
    expect(parseQuestionAnswers([null, ["yes", 1], "no"])).toEqual([[], ["yes"], []])
    expect(parseQuestionAnswers({})).toBeUndefined()
  })

  test("ignores diagnostics with malformed nested ranges", () => {
    expect(
      parseDiagnostics(
        {
          "a.ts": [
            { severity: 1, message: "missing range" },
            { severity: 1, message: "bad line", range: { start: { line: "0", character: 1 } } },
            { severity: 1, message: "valid", range: { start: { line: 2, character: 3 } } },
          ],
        },
        "a.ts",
      ),
    ).toEqual([{ message: "valid", range: { start: { line: 2, character: 3 } } }])
  })

  test("formats completed subagent toolcall details", () => {
    expect(formatCompletedSubagentDetail(0, "501ms")).toBe("501ms")
    expect(formatCompletedSubagentDetail(1, "501ms")).toBe("1 toolcall · 501ms")
    expect(formatCompletedSubagentDetail(2, "501ms")).toBe("2 toolcalls · 501ms")
    expect(formatSubagentToolcalls(0)).toBe("0 toolcalls")
  })

  test("keeps background state attached to the subagent identity", () => {
    expect(formatSubagentTitle("Explore", "Inspect renderer", false)).toBe("Explore Task — Inspect renderer")
    expect(formatSubagentTitle("Explore", "Inspect renderer", true)).toBe(
      "Explore Task (background) — Inspect renderer",
    )
  })

  test("keeps retry status ahead of wrapping messages", () => {
    expect(formatSubagentRetry(2, "Rate limited by provider")).toBe("Retrying (attempt 2) · Rate limited by provider")
  })

  test("snapshots consecutive grep, glob, and read rows at a narrow width", async () => {
    expect(await renderFrame(() => <Fixture />, { width: 72, height: 12 })).toMatchSnapshot()
  })

  test("snapshots expanded tool errors under the tool text", async () => {
    expect(await renderFrame(() => <Fixture errorExpanded />, { width: 72, height: 12 })).toMatchSnapshot()
  })

  test("keeps separation after a shell output block", async () => {
    expect(await renderFrame(() => <Fixture before="shell" />, { width: 72, height: 16 })).toMatchSnapshot()
  })

  test("keeps separation after a padded user message", async () => {
    expect(await renderFrame(() => <Fixture before="user" />, { width: 72, height: 14 })).toMatchSnapshot()
  })

  test("separates after a multi-line task row", async () => {
    expect(await renderFrame(() => <TaskRowsFixture />, { width: 72, height: 10 })).toMatchSnapshot()
  })

  test("separates a task row from a preceding inline detail", async () => {
    expect(await renderFrame(() => <LoadedReadBeforeTaskFixture />, { width: 72, height: 8 })).toMatchSnapshot()
  })

  test("separates an inline row from the previous assistant summary", async () => {
    expect(await renderFrame(() => <AssistantSummaryBeforeInlineFixture />, { width: 72, height: 5 })).toMatchSnapshot()
  })

  test("separates an inline row from the previous assistant error", async () => {
    expect(await renderFrame(() => <AssistantErrorBeforeInlineFixture />, { width: 72, height: 7 })).toMatchSnapshot()
  })

  test("updates sticky-bottom geometry when a text separator mounts and unmounts", async () => {
    const [separated, setSeparated] = createSignal(false)
    let scroll: ScrollBoxRenderable | undefined
    testSetup = await testRender(
      () => <StickyScrollFixture separated={separated()} scroll={(value) => (scroll = value)} />,
      {
        width: 72,
        height: 3,
      },
    )

    await testSetup.renderOnce()
    expect(scroll?.scrollHeight).toBe(3)
    expect(scroll?.scrollTop).toBe(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height))

    setSeparated(true)
    await testSetup.renderOnce()
    expect(scroll?.scrollHeight).toBe(5)
    expect(scroll?.scrollTop).toBe(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height))

    setSeparated(false)
    await testSetup.renderOnce()
    expect(scroll?.scrollHeight).toBe(3)
    expect(scroll?.scrollTop).toBe(Math.max(0, scroll!.scrollHeight - scroll!.viewport.height))
  })
})

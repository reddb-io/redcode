import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { selectedForeground, tint, useTheme } from "../../context/theme"
import type { QuestionAnswer, QuestionRequest } from "@reddb-io/redcode-sdk/v2"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useToast } from "../../ui/toast"
import { SplitBorder } from "../../ui/border"
import { useTuiConfig } from "../../config"
import { useBindings, useOpencodeModeStack } from "../../keymap"
import { useExit } from "../../context/exit"
import {
  classifyDialogFailure,
  createExitPresses,
  dialogRequest,
  dialogTimeout,
  type DialogFailure,
} from "../../util/dialog-request"

const QUESTION_MODE = "question"

const FAILURE: Record<DialogFailure, string> = {
  gone: "This question is no longer active — the request was interrupted. You can continue typing.",
  "slow-gone":
    "The server was slow and this question is no longer pending. Your answer may still be applied; check the session before asking again.",
  "slow-pending":
    "The server is slow and has not taken your answer yet. Still waiting: press Enter to retry or Esc to dismiss.",
  unreachable:
    "The server is not responding. Your answer may still be applied. Press Esc to dismiss, or Ctrl+C twice to exit.",
  failed: "Sending your answer failed. Try again, or press Esc to dismiss.",
}

export function QuestionPrompt(props: { request: QuestionRequest; directory?: string; timeout?: number }) {
  const sdk = useSDK()
  const exit = useExit()
  const sync = useSync()
  const toast = useToast()
  const { theme, syntax } = useTheme()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const modeStack = useOpencodeModeStack()

  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)
  const tabs = createMemo(() => (single() ? 1 : questions().length + 1)) // questions + confirm tab (no confirm for single select)
  const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    selected: 0,
    editing: false,
  })

  let textarea: TextareaRenderable | undefined
  let body: ScrollBoxRenderable | undefined

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const custom = createMemo(() => question()?.custom !== false)
  const other = createMemo(() => custom() && store.selected === options().length)
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  const presses = createExitPresses()
  onCleanup(presses.reset)
  const timeout = () => props.timeout ?? dialogTimeout(sdk.url)

  // A failed or slow reply/reject must never leave this dialog unresponsive, and must not drop a request
  // the server may still apply: only a request the server no longer has closes the dialog.
  async function fail(error: unknown) {
    const request = props.request
    console.error("question reply/reject failed", error)
    const outcome = await classifyDialogFailure(error, () =>
      dialogRequest(
        (signal) => sdk.client.question.list({ directory: props.directory }, { throwOnError: true, signal }),
        timeout(),
      ).then((result) => (result.data ?? []).some((item) => item.id === request.id)),
    )
    if (outcome === "gone" || outcome === "slow-gone") sync.removeQuestion(request.sessionID, request.id)
    toast.show({ variant: "error", message: FAILURE[outcome] })
  }

  function submit() {
    const answers = questions().map((_, i) => store.answers[i] ?? [])
    dialogRequest(
      (signal) =>
        sdk.client.question.reply(
          {
            requestID: props.request.id,
            directory: props.directory,
            answers,
          },
          { throwOnError: true, signal },
        ),
      timeout(),
    ).catch(fail)
  }

  function reject() {
    dialogRequest(
      (signal) =>
        sdk.client.question.reject(
          {
            requestID: props.request.id,
            directory: props.directory,
          },
          { throwOnError: true, signal },
        ),
      timeout(),
    ).catch(fail)
  }

  function pick(answer: string, custom: boolean = false) {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)
    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }
    if (single()) {
      dialogRequest(
        (signal) =>
          sdk.client.question.reply(
            {
              requestID: props.request.id,
              directory: props.directory,
              answers: [[answer]],
            },
            { throwOnError: true, signal },
          ),
        timeout(),
      ).catch(fail)
      return
    }
    setStore("tab", store.tab + 1)
    setStore("selected", 0)
  }

  function toggle(answer: string) {
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)
    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  function moveTo(index: number) {
    setStore("selected", index)
  }

  function selectTab(index: number) {
    setStore("tab", index)
    setStore("selected", 0)
  }

  function selectOption() {
    if (other()) {
      if (!multi()) {
        setStore("editing", true)
        return
      }
      const value = input()
      if (value && customPicked()) {
        toggle(value)
        return
      }
      setStore("editing", true)
      return
    }
    const opt = options()[store.selected]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  onMount(() => {
    const popMode = modeStack.push(QUESTION_MODE)
    onCleanup(popMode)
  })

  useBindings(() => ({
    mode: QUESTION_MODE,
    enabled: store.editing && !confirm(),
    commands: [
      {
        name: "prompt.clear",
        title: "Clear answer edit",
        category: "Question",
        run() {
          const text = textarea?.plainText ?? ""
          if (!text) {
            setStore("editing", false)
            return
          }
          textarea?.setText("")
        },
      },
    ],
    bindings: [
      {
        key: "escape",
        desc: "Cancel answer edit",
        group: "Question",
        cmd: () => {
          setStore("editing", false)
        },
      },
      ...tuiConfig.keybinds.get("prompt.clear"),
      {
        key: "return",
        desc: "Submit answer edit",
        group: "Question",
        cmd: () => {
          const text = textarea?.plainText?.trim() ?? ""
          const prev = store.custom[store.tab]

          if (!text) {
            if (prev) {
              const inputs = [...store.custom]
              inputs[store.tab] = ""
              setStore("custom", inputs)

              const answers = [...store.answers]
              answers[store.tab] = (answers[store.tab] ?? []).filter((x) => x !== prev)
              setStore("answers", answers)
            }
            setStore("editing", false)
            return
          }

          if (multi()) {
            const inputs = [...store.custom]
            inputs[store.tab] = text
            setStore("custom", inputs)

            const existing = store.answers[store.tab] ?? []
            const next = [...existing]
            if (prev) {
              const index = next.indexOf(prev)
              if (index !== -1) next.splice(index, 1)
            }
            if (!next.includes(text)) next.push(text)
            const answers = [...store.answers]
            answers[store.tab] = next
            setStore("answers", answers)
            setStore("editing", false)
            return
          }

          pick(text, true)
          setStore("editing", false)
        },
      },
    ],
  }))

  useBindings(() => {
    const opts = options()
    const total = opts.length + (custom() ? 1 : 0)
    const max = Math.min(total, 9)

    return {
      mode: QUESTION_MODE,
      enabled: !store.editing,
      commands: [
        {
          name: "app.exit",
          title: "Reject question",
          category: "Question",
          run() {
            if (presses.press(props.request.id)) return exit()
            reject()
          },
        },
      ],
      bindings: [
        { key: "pageup", desc: "Scroll question up", group: "Question", cmd: () => body?.scrollBy(-body.height) },
        { key: "pagedown", desc: "Scroll question down", group: "Question", cmd: () => body?.scrollBy(body.height) },
        {
          key: "left",
          desc: "Previous question",
          group: "Question",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        {
          key: "h",
          desc: "Previous question",
          group: "Question",
          cmd: () => selectTab((store.tab - 1 + tabs()) % tabs()),
        },
        { key: "right", desc: "Next question", group: "Question", cmd: () => selectTab((store.tab + 1) % tabs()) },
        { key: "l", desc: "Next question", group: "Question", cmd: () => selectTab((store.tab + 1) % tabs()) },
        {
          key: "tab",
          desc: "Next question",
          group: "Question",
          cmd: ({ event }: { event: { shift: boolean } }) => {
            selectTab((store.tab + (event.shift ? -1 : 1) + tabs()) % tabs())
          },
        },
        ...(confirm()
          ? [
              { key: "return", desc: "Submit answer", group: "Question", cmd: () => submit() },
              { key: "escape", desc: "Reject question", group: "Question", cmd: () => reject() },
              ...tuiConfig.keybinds.get("app.exit"),
            ]
          : [
              ...Array.from({ length: max }, (_, index) => ({
                key: String(index + 1),
                desc: `Select answer ${index + 1}`,
                group: "Question",
                cmd: () => {
                  moveTo(index)
                  selectOption()
                },
              })),
              {
                key: "up",
                desc: "Previous answer",
                group: "Question",
                cmd: () => moveTo((store.selected - 1 + total) % total),
              },
              {
                key: "k",
                desc: "Previous answer",
                group: "Question",
                cmd: () => moveTo((store.selected - 1 + total) % total),
              },
              { key: "down", desc: "Next answer", group: "Question", cmd: () => moveTo((store.selected + 1) % total) },
              { key: "j", desc: "Next answer", group: "Question", cmd: () => moveTo((store.selected + 1) % total) },
              { key: "return", desc: "Select answer", group: "Question", cmd: () => selectOption() },
              { key: "escape", desc: "Reject question", group: "Question", cmd: () => reject() },
              ...tuiConfig.keybinds.get("app.exit"),
            ]),
      ],
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <Show when={!single()}>
          <box flexDirection="row" gap={1} paddingLeft={1}>
            <For each={questions()}>
              {(q, index) => {
                const isActive = () => index() === store.tab
                const isAnswered = () => {
                  return (store.answers[index()]?.length ?? 0) > 0
                }
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={
                      isActive()
                        ? theme.accent
                        : tabHover() === index()
                          ? theme.backgroundElement
                          : theme.backgroundPanel
                    }
                    onMouseOver={() => setTabHover(index())}
                    onMouseOut={() => setTabHover(null)}
                    onMouseUp={() => {
                      if (renderer.getSelection()?.getSelectedText()) return
                      selectTab(index())
                    }}
                  >
                    <text
                      fg={
                        isActive()
                          ? selectedForeground(theme, theme.accent)
                          : isAnswered()
                            ? theme.text
                            : theme.textMuted
                      }
                    >
                      {q.header}
                    </text>
                  </box>
                )
              }}
            </For>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                confirm() ? theme.accent : tabHover() === "confirm" ? theme.backgroundElement : theme.backgroundPanel
              }
              onMouseOver={() => setTabHover("confirm")}
              onMouseOut={() => setTabHover(null)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                selectTab(questions().length)
              }}
            >
              <text fg={confirm() ? selectedForeground(theme, theme.accent) : theme.textMuted}>Confirm</text>
            </box>
          </box>
        </Show>

        <Show when={!confirm()}>
          <box paddingLeft={1} gap={1}>
            <scrollbox
              ref={(value: ScrollBoxRenderable) => {
                body = value
              }}
              maxHeight={Math.max(3, Math.min(dimensions().height - 16, Math.floor(dimensions().height * 0.45)))}
              flexShrink={0}
            >
              <markdown
                syntaxStyle={syntax()}
                streaming={true}
                content={`${question()?.question ?? ""}${multi() ? " (select all that apply)" : ""}`}
                internalBlockMode="top-level"
                tableOptions={{ style: "grid" }}
                fg={theme.markdownText}
                bg={theme.backgroundPanel}
              />
            </scrollbox>
            <box flexShrink={0}>
              <For each={options()}>
                {(opt, i) => {
                  const active = () => i() === store.selected
                  const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                  return (
                    <box
                      onMouseOver={() => moveTo(i())}
                      onMouseDown={() => moveTo(i())}
                      onMouseUp={() => {
                        if (renderer.getSelection()?.getSelectedText()) return
                        selectOption()
                      }}
                    >
                      <box flexDirection="row">
                        <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                          <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                            {`${i() + 1}.`}
                          </text>
                        </box>
                        <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                          <text fg={active() ? theme.secondary : picked() ? theme.success : theme.text}>
                            {multi() ? `[${picked() ? "✓" : " "}] ${opt.label}` : opt.label}
                          </text>
                        </box>
                        <Show when={!multi()}>
                          <text fg={theme.success}>{picked() ? " ✓" : ""}</text>
                        </Show>
                      </box>

                      <box paddingLeft={3}>
                        <text fg={theme.textMuted}>{opt.description}</text>
                      </box>
                    </box>
                  )
                }}
              </For>
              <Show when={custom()}>
                <box
                  onMouseOver={() => moveTo(options().length)}
                  onMouseDown={() => moveTo(options().length)}
                  onMouseUp={() => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    selectOption()
                  }}
                >
                  <box flexDirection="row">
                    <box backgroundColor={other() ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text fg={other() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                        {`${options().length + 1}.`}
                      </text>
                    </box>
                    <box backgroundColor={other() ? theme.backgroundElement : undefined}>
                      <text fg={other() ? theme.secondary : customPicked() ? theme.success : theme.text}>
                        {multi() ? `[${customPicked() ? "✓" : " "}] Type your own answer` : "Type your own answer"}
                      </text>
                    </box>

                    <Show when={!multi()}>
                      <text fg={theme.success}>{customPicked() ? " ✓" : ""}</text>
                    </Show>
                  </box>
                  <Show when={store.editing}>
                    <box paddingLeft={3}>
                      <textarea
                        ref={(val: TextareaRenderable) => {
                          textarea = val
                          val.traits = { status: "ANSWER" }
                          queueMicrotask(() => {
                            val.focus()
                            val.gotoLineEnd()
                          })
                        }}
                        initialValue={input()}
                        placeholder="Type your own answer"
                        placeholderColor={theme.textMuted}
                        minHeight={1}
                        maxHeight={6}
                        textColor={theme.text}
                        focusedTextColor={theme.text}
                        cursorColor={theme.primary}
                        cursorStyle={tuiConfig.cursor}
                      />
                    </box>
                  </Show>
                  <Show when={!store.editing && input()}>
                    <box paddingLeft={3}>
                      <text fg={theme.textMuted}>{input()}</text>
                    </box>
                  </Show>
                </box>
              </Show>
            </box>
          </box>
        </Show>

        <Show when={confirm() && !single()}>
          <box paddingLeft={1}>
            <text fg={theme.text}>Review</text>
          </box>
          <For each={questions()}>
            {(q, index) => {
              const value = () => store.answers[index()]?.join(", ") ?? ""
              const answered = () => Boolean(value())
              return (
                <box paddingLeft={1}>
                  <text>
                    <span style={{ fg: theme.textMuted }}>{q.header}:</span>{" "}
                    <span style={{ fg: answered() ? theme.text : theme.error }}>
                      {answered() ? value() : "(not answered)"}
                    </span>
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <Show when={!single()}>
            <text fg={theme.text}>
              {"⇆"} <span style={{ fg: theme.textMuted }}>tab</span>
            </text>
          </Show>
          <Show when={!confirm()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
            </text>
          </Show>
          <text fg={theme.text}>
            enter{" "}
            <span style={{ fg: theme.textMuted }}>
              {confirm() ? "submit" : multi() ? "toggle" : single() ? "submit" : "confirm"}
            </span>
          </text>

          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
          <text fg={theme.textMuted}>pgup/pgdn scroll</text>
        </box>
      </box>
    </box>
  )
}

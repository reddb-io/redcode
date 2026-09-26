import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@reddb-io/redcode-ui/v2/dialog-v2"
import { Field } from "@reddb-io/redcode-ui/v2/field-v2"
import { TextareaV2 } from "@reddb-io/redcode-ui/v2/textarea-v2"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@/utils/toast"

/**
 * Where a goal is typed. No arguments travel with a slash command, so the definition of done
 * is written here: free text, plus the optional lines the server parses.
 */
export function DialogGoal(props: {
  current?: boolean
  onSubmit: (text: string, options: { maxTurns: number; executePlan: boolean }) => Promise<void> | void
}) {
  const dialog = useDialog()
  const [state, setState] = createStore({ text: "", busy: false, maxTurns: 50, executePlan: false })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const value = state.text.trim()
    if (!value || state.busy || !Number.isInteger(state.maxTurns) || state.maxTurns < 1 || state.maxTurns > 1000) return
    setState("busy", true)
    try {
      await props.onSubmit(value, { maxTurns: state.maxTurns, executePlan: state.executePlan })
      dialog.close()
    } catch {
      showToast({ title: "Could not update the goal" })
    } finally {
      setState("busy", false)
    }
  }

  return (
    <Dialog fit>
      <form onSubmit={submit} class="contents">
        <DialogHeader>
          <DialogTitle>{"What does done look like?"}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-4 px-4 pt-4 pb-1">
          <Field>
            <TextareaV2
              class="!w-full"
              rows={5}
              value={state.text}
              placeholder={"make the tests pass; verify: bun test; gate: bun test; constraints: do not touch the app"}
              spellcheck={false}
              autofocus
              onInput={(event) => setState("text", event.currentTarget.value)}
            />
            <p class="text-12-regular text-text-weak">{"Free text, plus optional lines: verify:, constraints:, boundaries:, stop when:, gate: (a command that must exit 0)."}</p>
          </Field>
          <label class="flex items-center gap-2 text-12-regular">
            {"Provider-turn limit"}
            <input
              type="number"
              min="1"
              max="1000"
              required
              value={state.maxTurns}
              onInput={(event) => setState("maxTurns", event.currentTarget.valueAsNumber)}
              class="w-20 rounded border border-border-base px-2 py-1"
            />
          </label>
          <Show when={props.current}>
            <label class="flex items-center gap-2 text-12-regular">
              <input
                type="checkbox"
                checked={state.executePlan}
                onChange={(event) => setState("executePlan", event.currentTarget.checked)}
              />
              {"Allow implementing this goal's plan without another execution approval"}
            </label>
          </Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 type="button" variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
            {"Cancel"}
          </ButtonV2>
          <ButtonV2 type="submit" variant="contrast" disabled={state.busy || !state.text.trim()}>
            {"Start"}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

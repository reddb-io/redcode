import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@reddb-io/redcode-ui/v2/dialog-v2"
import { Field } from "@reddb-io/redcode-ui/v2/field-v2"
import { TextareaV2 } from "@reddb-io/redcode-ui/v2/textarea-v2"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"

/**
 * Where a goal is typed. No arguments travel with a slash command, so the definition of done
 * is written here: free text, plus the optional lines the server parses.
 */
export function DialogGoal(props: {
  current?: boolean
  onSubmit: (text: string, options: { maxTurns: number; executePlan: boolean }) => Promise<void> | void
}) {
  const language = useLanguage()
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
      showToast({ title: language.t("session.goal.error") })
    } finally {
      setState("busy", false)
    }
  }

  return (
    <Dialog fit>
      <form onSubmit={submit} class="contents">
        <DialogHeader>
          <DialogTitle>{language.t("session.goal.dialog.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-4 px-4 pt-4 pb-1">
          <Field>
            <TextareaV2
              class="!w-full"
              rows={5}
              value={state.text}
              placeholder={language.t("session.goal.dialog.placeholder")}
              spellcheck={false}
              autofocus
              onInput={(event) => setState("text", event.currentTarget.value)}
            />
            <p class="text-12-regular text-text-weak">{language.t("session.goal.dialog.help")}</p>
          </Field>
          <label class="flex items-center gap-2 text-12-regular">
            {language.t("session.goal.turnLimit")}
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
              {language.t("session.goal.executePlan")}
            </label>
          </Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 type="button" variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant="contrast" disabled={state.busy || !state.text.trim()}>
            {language.t("session.goal.dialog.submit")}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

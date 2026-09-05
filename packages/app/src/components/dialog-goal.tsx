import { ButtonV2 } from "@reddb-io/redcode-ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@reddb-io/redcode-ui/v2/dialog-v2"
import { Field } from "@reddb-io/redcode-ui/v2/field-v2"
import { TextareaV2 } from "@reddb-io/redcode-ui/v2/textarea-v2"
import { useDialog } from "@reddb-io/redcode-ui/context/dialog"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"

/**
 * Where a goal is typed. No arguments travel with a slash command, so the definition of done
 * is written here: free text, plus the optional lines the server parses.
 */
export function DialogGoal(props: { onSubmit: (text: string) => Promise<void> | void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [text, setText] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const value = text().trim()
    if (!value || busy()) return
    setBusy(true)
    try {
      await props.onSubmit(value)
      dialog.close()
    } finally {
      setBusy(false)
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
              value={text()}
              placeholder={language.t("session.goal.dialog.placeholder")}
              spellcheck={false}
              autofocus
              onInput={(event) => setText(event.currentTarget.value)}
            />
            <p class="text-12-regular text-text-weak">{language.t("session.goal.dialog.help")}</p>
          </Field>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 type="button" variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant="contrast" disabled={busy() || !text().trim()}>
            {language.t("session.goal.dialog.submit")}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

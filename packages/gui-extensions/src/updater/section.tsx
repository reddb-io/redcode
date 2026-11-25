import { ReactView } from "@opencode/ui/react-view"
import { useExtension } from "../sdk"
import type definition from "./index"
import { UpdateSettings } from "./section.react"

export default function UpdatesSection(props: {
  /** Undefined while main is not active. */
  upgradable: () => boolean | undefined
  checking: () => boolean
  run: () => void
}) {
  const ctx = useExtension<typeof definition>()
  const releaseNotes = ctx.stores.releaseNotes

  return (
    <ReactView
      component={UpdateSettings}
      props={{
        heading: ctx.t("section.title"),
        notesTitle: ctx.t("releaseNotes.title"),
        notesDescription: ctx.t("releaseNotes.description"),
        enabled: releaseNotes.value.enabled,
        toggle: (checked) =>
          releaseNotes.update((draft) => {
            draft.enabled = checked
          }),
        checkTitle: ctx.t("check.title"),
        checkDescription: ctx.t(props.upgradable() === false ? "check.development" : "check.description"),
        checkLabel: ctx.t(props.checking() ? "action.checking" : "action.checkNow"),
        disabled: !props.upgradable() || props.checking(),
        run: props.run,
      }}
    />
  )
}

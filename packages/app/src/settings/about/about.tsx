import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
import { showToast } from "@/shell/notifications/toast"
import { AnimatedWordmark } from "./animated-wordmark"

export function SettingsAbout(props: { active: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()

  let noticesButton: HTMLButtonElement | undefined

  const showNotices = async () => {
    // The license texts load only when someone reads them.
    const loaded = await import("./notices/dialog").catch(() => undefined)

    if (!loaded) {
      showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") })

      return
    }

    // dialog.show has no trigger for Kobalte to restore, so closing returns focus to the button by hand.
    void dialog.show(() => (
      <loaded.default
        onCloseAutoFocus={(event) => {
          if (!noticesButton?.isConnected) return
          event.preventDefault()
          noticesButton.focus({ preventScroll: true })
        }}
      />
    ))
  }

  return (
    <div class="settings-about-content">
      <div class="settings-about-intro">
        <p>
          {language.t("settings.about.version", {
            version: platform.version ?? language.t("settings.about.devVersion"),
          })}
        </p>
        <p>{language.t("settings.about.license")}</p>
      </div>

      <AnimatedWordmark active={props.active} />

      <p class="settings-about-faint">
        <ExternalLink href="https://github.com/reddb-io/redcode">
          <bdi dir="ltr">{language.t("settings.about.website")}</bdi>
        </ExternalLink>
      </p>

      <div class="settings-about-details">
        <p>{language.t("settings.about.description")}</p>
        <p>
          <ExternalLink href="https://github.com/anomalyco/opencode">
            {language.t("settings.about.trademark")}
          </ExternalLink>
        </p>
        <p>{language.t("settings.about.typeset")}</p>
        <p>
          <button ref={noticesButton} type="button" class="settings-about-link" onClick={() => void showNotices()}>
            {language.t("settings.about.notices.title")}
          </button>
        </p>
      </div>

      <div class="settings-about-copyright">
        <p>{language.t("settings.about.copyright")}</p>
      </div>
    </div>
  )
}

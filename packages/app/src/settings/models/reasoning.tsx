import { createResource, Show } from "solid-js"
import { useModels } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

const sourceLabels = {
  flag: "settings.models.reasoning.source.flag",
  config: "settings.models.reasoning.source.config",
  default: "settings.models.reasoning.source.default",
} as const

/**
 * The effective System Two and System One roles and where the reasoning mode comes from. Read-only:
 * the roles are chosen with `redcode setup` or the terminal's setup dialog.
 */
export function SettingsReasoningRoles() {
  const language = useLanguage()
  const models = useModels()
  const server = useServerSDK()
  const [status] = createResource(() => server.api["server.intelligence"].status())
  // Reading an unresolved resource would suspend the settings page, so only settled values are read.
  const current = () => (status.state === "ready" || status.state === "refreshing" ? status.latest : undefined)
  const modelName = (ref: { providerID: string; id: string } | undefined) => {
    if (!ref) return language.t("settings.models.reasoning.unset")
    return models.find({ providerID: ref.providerID, modelID: ref.id })?.name ?? `${ref.providerID}/${ref.id}`
  }

  return (
    <section class="settings-section" aria-label={language.t("settings.models.reasoning.title")}>
      <h3 class="settings-section-title">{language.t("settings.models.reasoning.title")}</h3>
      <Show
        when={current()}
        fallback={
          <div class="settings-models-status">
            {status.error
              ? language.t("settings.models.reasoning.unavailable")
              : `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`}
          </div>
        }
      >
        {(value) => (
          <SettingsList>
            <SettingsRow
              title={language.t("settings.models.reasoning.mode")}
              description={language.t(sourceLabels[value().effective.source])}
            >
              <span class="text-12-medium text-v2-text-text-base">
                {language.t(
                  value().effective.reasoning === "dual"
                    ? "settings.models.reasoning.mode.dual"
                    : "settings.models.reasoning.mode.single",
                )}
              </span>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.models.reasoning.principal")}
              description={language.t("settings.models.reasoning.principal.description")}
            >
              <span class="text-12-medium text-v2-text-text-base">{modelName(value().settings.principal)}</span>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.models.reasoning.fast")}
              description={language.t("settings.models.reasoning.fast.description")}
            >
              <span class="text-12-medium text-v2-text-text-base">{modelName(value().settings.fast)}</span>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.models.reasoning.evaluator")}
              description={
                value().settings.evaluator?.transport ?? language.t("settings.models.reasoning.evaluator.description")
              }
            >
              <span class="text-12-medium text-v2-text-text-base">
                {value().settings.evaluator?.model ?? language.t("settings.models.reasoning.unset")}
              </span>
            </SettingsRow>
          </SettingsList>
        )}
      </Show>
      <Show when={current() && current()?.settings.onboarding !== "completed"}>
        <div class="text-12-regular text-v2-text-text-muted">{language.t("settings.models.reasoning.setup")}</div>
      </Show>
    </section>
  )
}

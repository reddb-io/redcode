import type { IntelligenceEvaluator, IntelligenceStatus } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { firstConnectionFailure, type ConnectionFailure } from "@opencode/util/connection-failure"
import { createMemo, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useModels } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { showToast } from "@/shell/notifications/toast"

const sourceLabels = {
  flag: "settings.models.reasoning.source.flag",
  config: "settings.models.reasoning.source.config",
  default: "settings.models.reasoning.source.default",
} as const

const failureRoles = {
  principal: "settings.models.reasoning.failure.principal",
  fast: "settings.models.reasoning.failure.fast",
  evaluator: "settings.models.reasoning.failure.evaluator",
} as const

const failureReasons = {
  credential: "settings.models.reasoning.failure.credential",
  status: "settings.models.reasoning.failure.status",
  timeout: "settings.models.reasoning.failure.timeout",
  unreachable: "settings.models.reasoning.failure.unreachable",
  unknown: "settings.models.reasoning.failure.unknown",
} as const

type Draft = {
  reasoning?: "single" | "dual"
  principal?: string
  // An empty key reuses the principal for bounded transformations.
  fast?: string
  evaluator?: string
  evaluatorModel?: string
  apiKey: string
  checking: boolean
  failure?: { role: keyof typeof failureRoles; failure: ConnectionFailure }
}

type EvaluatorChoice = { key: string; label: string; evaluator: IntelligenceEvaluator }

/**
 * The System Two and System One roles and the reasoning mode, edited like the terminal's `/setup`: every
 * selected connection is checked before saving, and a failed check shows why with a Retry.
 */
export function SettingsReasoningRoles() {
  const language = useLanguage()
  const models = useModels()
  const server = useServerSDK()
  const api = server.api["server.intelligence"]
  const [status, { refetch }] = createResource(() => api.status())
  const [draft, setDraft] = createStore<Draft>({ apiKey: "", checking: false })
  // Reading an unresolved resource would suspend the settings page, so only settled values are read.
  const current = () => (status.state === "ready" || status.state === "refreshing" ? status.latest : undefined)
  const modelKey = (ref: { providerID: string; id: string } | undefined) =>
    ref ? `${ref.providerID}/${ref.id}` : undefined
  const modelOptions = createMemo(() =>
    models
      .list()
      .filter((model) => !/(^|\/)jev(?:$|[-.])/i.test(model.id))
      .map((model) => ({
        key: `${model.provider.id}/${model.id}`,
        ref: { providerID: model.provider.id, id: model.id },
        label: `${model.provider.name} · ${model.name}`,
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label)),
  )
  const fastOptions = createMemo(() => [
    { key: "", ref: undefined, label: language.t("settings.models.reasoning.fast.reuse") },
    ...modelOptions(),
  ])
  const evaluatorOptions = (value: IntelligenceStatus): EvaluatorChoice[] => {
    const choices = [
      ...(value.settings.evaluator
        ? [{ label: language.t("settings.models.reasoning.evaluator.current"), evaluator: value.settings.evaluator }]
        : []),
      ...(value.router?.evaluator ? [{ label: "RedRouter", evaluator: value.router.evaluator }] : []),
      ...value.evaluators
        .filter((option) => option.evaluator.transport !== "red-router" || !value.router?.evaluator)
        .map((option) => ({ label: option.name, evaluator: option.evaluator })),
    ].map((choice) => ({
      key: `${choice.evaluator.transport} ${choice.evaluator.baseURL} ${choice.evaluator.model}`,
      label: `${choice.label} · ${choice.evaluator.model}`,
      evaluator: choice.evaluator,
    }))
    return choices.filter((choice, index) => choices.findIndex((item) => item.key === choice.key) === index)
  }
  const reasoning = (value: IntelligenceStatus) =>
    draft.reasoning ?? value.settings.reasoning ?? value.effective.reasoning
  const principal = (value: IntelligenceStatus) =>
    modelOptions().find((option) => option.key === (draft.principal ?? modelKey(value.settings.principal)))
  const fast = (value: IntelligenceStatus) =>
    fastOptions().find((option) => option.key === (draft.fast ?? modelKey(value.settings.fast) ?? "")) ??
    fastOptions()[0]
  const evaluator = (value: IntelligenceStatus) => {
    const options = evaluatorOptions(value)
    return options.find((option) => option.key === draft.evaluator) ?? options[0]
  }
  const evaluatorModel = (value: IntelligenceStatus) => draft.evaluatorModel ?? evaluator(value)?.evaluator.model ?? ""

  const save = async (value: IntelligenceStatus) => {
    const selected = principal(value)
    if (!selected || draft.checking) return
    const transformation = fast(value).ref
    const dual = reasoning(value) === "dual"
    const chosen = evaluator(value)
    const s1 =
      dual && chosen && evaluatorModel(value).trim()
        ? { ...chosen.evaluator, model: evaluatorModel(value).trim() }
        : undefined
    if (dual && !s1) return
    const apiKey = draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}
    setDraft({ checking: true, failure: undefined })
    const failed = await firstConnectionFailure([
      {
        role: "principal" as const,
        run: () =>
          server.api.generate.text(
            { prompt: "Reply with OK.", model: selected.ref },
            { signal: AbortSignal.timeout(30_000) },
          ),
      },
      ...(transformation && modelKey(transformation) !== selected.key
        ? [
            {
              role: "fast" as const,
              run: () =>
                server.api.generate.text(
                  { prompt: "Reply with OK.", model: transformation },
                  { signal: AbortSignal.timeout(30_000) },
                ),
            },
          ]
        : []),
      ...(s1
        ? [
            {
              role: "evaluator" as const,
              run: () =>
                api.probe({ evaluator: s1, ...apiKey }, { signal: AbortSignal.timeout(30_000) }).then((check) => {
                  if (!check.ok) throw new Error(check.message)
                }),
            },
          ]
        : []),
    ])
    if (failed) {
      setDraft({ checking: false, failure: failed })
      return
    }
    const saved = await api
      .save({
        settings: {
          ...value.settings,
          enabled: true,
          reasoning: reasoning(value),
          onboarding: "completed",
          principal: selected.ref,
          fast: transformation && modelKey(transformation) !== selected.key ? transformation : undefined,
          ...(s1 ? { evaluator: s1 } : {}),
        },
        ...apiKey,
      })
      .then(
        () => true,
        (error: unknown) => {
          showToast({
            title: language.t("common.requestFailed"),
            description: error instanceof Error ? error.message : undefined,
          })
          return false
        },
      )
    setDraft({ checking: false })
    if (!saved) return
    setDraft({
      reasoning: undefined,
      principal: undefined,
      fast: undefined,
      evaluator: undefined,
      evaluatorModel: undefined,
      apiKey: "",
    })
    showToast({ variant: "success", icon: "circle-check", title: language.t("settings.models.reasoning.saved") })
    void refetch()
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
              <Select
                data-action="settings-reasoning-mode"
                options={["single" as const, "dual" as const]}
                current={reasoning(value())}
                value={(mode) => mode}
                label={(mode) =>
                  language.t(
                    mode === "dual" ? "settings.models.reasoning.mode.dual" : "settings.models.reasoning.mode.single",
                  )
                }
                placement="bottom-end"
                gutter={6}
                onSelect={(mode) => mode && setDraft({ reasoning: mode, failure: undefined })}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.models.reasoning.principal")}
              description={language.t("settings.models.reasoning.principal.description")}
            >
              <Select
                data-action="settings-reasoning-principal"
                options={modelOptions()}
                current={principal(value())}
                placeholder={language.t("settings.models.reasoning.unset")}
                value={(option) => option.key}
                label={(option) => option.label}
                placement="bottom-end"
                gutter={6}
                onSelect={(option) => option && setDraft({ principal: option.key, failure: undefined })}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.models.reasoning.fast")}
              description={language.t("settings.models.reasoning.fast.description")}
            >
              <Select
                data-action="settings-reasoning-fast"
                options={fastOptions()}
                current={fast(value())}
                value={(option) => option.key}
                label={(option) => option.label}
                placement="bottom-end"
                gutter={6}
                onSelect={(option) => option && setDraft({ fast: option.key, failure: undefined })}
              />
            </SettingsRow>
            <Show when={reasoning(value()) === "dual"}>
              <SettingsRow
                title={language.t("settings.models.reasoning.evaluator")}
                description={language.t("settings.models.reasoning.evaluator.description")}
              >
                <Select
                  data-action="settings-reasoning-evaluator"
                  options={evaluatorOptions(value())}
                  current={evaluator(value())}
                  placeholder={language.t("settings.models.reasoning.unset")}
                  value={(option) => option.key}
                  label={(option) => option.label}
                  placement="bottom-end"
                  gutter={6}
                  onSelect={(option) =>
                    option && setDraft({ evaluator: option.key, evaluatorModel: undefined, failure: undefined })
                  }
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.models.reasoning.evaluator.model")}
                description={evaluator(value())?.evaluator.baseURL ?? ""}
              >
                <TextField
                  hideLabel
                  label={language.t("settings.models.reasoning.evaluator.model")}
                  value={evaluatorModel(value())}
                  onChange={(model) => setDraft({ evaluatorModel: model, failure: undefined })}
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.models.reasoning.evaluator.apiKey")}
                description={language.t("settings.models.reasoning.evaluator.apiKey.description")}
              >
                <TextField
                  hideLabel
                  type="password"
                  label={language.t("settings.models.reasoning.evaluator.apiKey")}
                  value={draft.apiKey}
                  onChange={(apiKey) => setDraft({ apiKey })}
                />
              </SettingsRow>
            </Show>
            <SettingsRow
              title={language.t("settings.models.reasoning.save.title")}
              description={
                draft.checking
                  ? language.t("settings.models.reasoning.checking")
                  : language.t("settings.models.reasoning.save.description")
              }
            >
              <Button
                data-action="settings-reasoning-save"
                size="normal"
                variant="neutral"
                disabled={draft.checking || !principal(value())}
                onClick={() => void save(value())}
              >
                {language.t("settings.models.reasoning.save")}
              </Button>
            </SettingsRow>
            <Show when={draft.failure}>
              {(failed) => (
                <SettingsRow
                  title={language.t(failureRoles[failed().role])}
                  description={[
                    language.t(failureReasons[failed().failure.kind], {
                      status: String(failed().failure.status ?? ""),
                    }),
                    failed().failure.detail,
                    language.t("settings.models.reasoning.failure.kept"),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <Button
                    data-action="settings-reasoning-retry"
                    size="normal"
                    variant="neutral"
                    disabled={draft.checking}
                    onClick={() => void save(value())}
                  >
                    {language.t("common.retry")}
                  </Button>
                </SettingsRow>
              )}
            </Show>
          </SettingsList>
        )}
      </Show>
      <Show when={current() && current()?.settings.onboarding !== "completed"}>
        <div class="text-12-regular text-v2-text-text-muted">{language.t("settings.models.reasoning.pending")}</div>
      </Show>
    </section>
  )
}

/** @jsxImportSource react */
import { useState, useSyncExternalStore } from "react"
import type { IntelligenceEvaluator, IntelligenceStatus } from "@opencode/client"
import { firstConnectionFailure, type ConnectionFailure } from "@opencode/util/connection-failure"
import { Button } from "@reddb-io/design-system/base/Button"
import { Input } from "@reddb-io/design-system/base/Input"
import { Select } from "@reddb-io/design-system/base/Select"
import { settingsState } from "../state"
import { SettingsList, SettingsRow } from "../shared.react"
import type { createReasoningServices } from "./reasoning"

const sourceLabels = {
  session: "settings.models.reasoning.source.session",
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
  reasoning?: "single" | "dual" | "observe"
  principal?: string
  // An empty key reuses the principal for bounded transformations.
  fast?: string
  evaluator?: string
  evaluatorModel?: string
  checking: boolean
  failure?: { role: keyof typeof failureRoles; failure: ConnectionFailure }
}

type EvaluatorChoice = { key: string; label: string; evaluator: IntelligenceEvaluator }

export function ReasoningRoles(props: { services: ReturnType<typeof createReasoningServices> }) {
  const services = props.services
  const state = useSyncExternalStore(services.snapshot.subscribe, services.snapshot.getSnapshot)
  const language = state.language
  const server = state
  const api = state.api["server.intelligence"]
  const [form] = useState(() => settingsState<Draft>({ checking: false }))
  const draft = useSyncExternalStore(form.subscribe, form.getSnapshot)
  const modelKey = (ref: { providerID: string; id: string } | undefined) =>
    ref ? `${ref.providerID}/${ref.id}` : undefined
  const modelOptions = () => state.models
  const fastOptions = () => [
    { key: "", ref: undefined, label: language.t("settings.models.reasoning.fast.reuse") },
    ...state.models,
  ]
  const connected = () => new Set(state.connected)
  const evaluatorOptions = (value: IntelligenceStatus): EvaluatorChoice[] => {
    const choices = [
      ...(value.settings.evaluator
        ? [{ label: language.t("settings.models.reasoning.evaluator.current"), evaluator: value.settings.evaluator }]
        : []),
      ...(value.router?.evaluator ? [{ label: "RedRouter", evaluator: value.router.evaluator }] : []),
      // Only services with an active connection are offered; the connection's own credential does the evaluating.
      ...value.evaluators
        .filter((option) => option.evaluator.transport !== "red-router" || !value.router?.evaluator)
        .filter((option) => connected().has(option.evaluator.transport))
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
    const dual = reasoning(value) !== "single"
    const chosen = evaluator(value)
    const s1 =
      dual && chosen && evaluatorModel(value).trim()
        ? { ...chosen.evaluator, model: evaluatorModel(value).trim() }
        : undefined
    if (dual && !s1) return
    form.update({ checking: true, failure: undefined })
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
                api.probe({ evaluator: s1 }, { signal: AbortSignal.timeout(30_000) }).then((check) => {
                  if (!check.ok) throw new Error(check.message)
                }),
            },
          ]
        : []),
    ])
    if (failed) {
      form.update({ checking: false, failure: failed })
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
      })
      .then(
        () => true,
        (error: unknown) => {
          services.notify({
            title: language.t("common.requestFailed"),
            description: error instanceof Error ? error.message : undefined,
          })
          return false
        },
      )
    form.update({ checking: false })
    if (!saved) return
    form.update({
      reasoning: undefined,
      principal: undefined,
      fast: undefined,
      evaluator: undefined,
      evaluatorModel: undefined,
    })
    services.notify({ variant: "success", icon: "circle-check", title: language.t("settings.models.reasoning.saved") })
    void services.refetch()
  }

  const value = state.current
  return (
    <section className="settings-section" aria-label={language.t("settings.models.reasoning.title")}>
      <h3 className="settings-section-title">{language.t("settings.models.reasoning.title")}</h3>
      {!value ? (
        <div className="settings-models-status">
          {state.error
            ? language.t("settings.models.reasoning.unavailable")
            : `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`}
        </div>
      ) : (
        <SettingsList>
          <SettingsRow
            title={language.t("settings.models.reasoning.mode")}
            description={language.t(sourceLabels[value.effective.source])}
          >
            {(association) => (
              <Select
                {...association}
                data-action="settings-reasoning-mode"
                controlSize="sm"
                value={reasoning(value)}
                options={(["single", "dual", "observe"] as const).map((mode) => ({
                  value: mode,
                  label: language.t(`settings.models.reasoning.mode.${mode}`),
                }))}
                onValueChange={(mode) => {
                  if (mode === "single" || mode === "dual" || mode === "observe")
                    form.update({ reasoning: mode, failure: undefined })
                }}
              />
            )}
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.models.reasoning.principal")}
            description={language.t("settings.models.reasoning.principal.description")}
          >
            {(association) => (
              <Select
                {...association}
                data-action="settings-reasoning-principal"
                controlSize="sm"
                value={principal(value)?.key ?? ""}
                options={[
                  { value: "", label: language.t("settings.models.reasoning.unset"), disabled: true },
                  ...modelOptions().map((option) => ({ value: option.key, label: option.label })),
                ]}
                onValueChange={(principal) => form.update({ principal, failure: undefined })}
              />
            )}
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.models.reasoning.fast")}
            description={language.t("settings.models.reasoning.fast.description")}
          >
            {(association) => (
              <Select
                {...association}
                data-action="settings-reasoning-fast"
                controlSize="sm"
                value={fast(value).key}
                options={fastOptions().map((option) => ({ value: option.key, label: option.label }))}
                onValueChange={(fast) => form.update({ fast, failure: undefined })}
              />
            )}
          </SettingsRow>
          {reasoning(value) !== "single" && (
            <>
              <SettingsRow
                title={language.t("settings.models.reasoning.evaluator")}
                description={language.t("settings.models.reasoning.evaluator.description")}
              >
                {(association) => (
                  <Select
                    {...association}
                    data-action="settings-reasoning-evaluator"
                    controlSize="sm"
                    value={evaluator(value)?.key ?? ""}
                    options={[
                      { value: "", label: language.t("settings.models.reasoning.unset"), disabled: true },
                      ...evaluatorOptions(value).map((option) => ({ value: option.key, label: option.label })),
                    ]}
                    onValueChange={(evaluator) =>
                      form.update({ evaluator, evaluatorModel: undefined, failure: undefined })
                    }
                  />
                )}
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.models.reasoning.evaluator.model")}
                description={evaluator(value)?.evaluator.transport ?? ""}
              >
                {(association) => (
                  <Input
                    {...association}
                    value={evaluatorModel(value)}
                    onValueChange={(evaluatorModel) => form.update({ evaluatorModel, failure: undefined })}
                  />
                )}
              </SettingsRow>
            </>
          )}
          <SettingsRow
            title={language.t("settings.models.reasoning.save.title")}
            description={language.t(
              draft.checking ? "settings.models.reasoning.checking" : "settings.models.reasoning.save.description",
            )}
          >
            {(association) => (
              <Button
                {...association}
                aria-labelledby={undefined}
                data-action="settings-reasoning-save"
                size="sm"
                disabled={draft.checking || !principal(value)}
                onClick={() => void save(value)}
              >
                {language.t("settings.models.reasoning.save")}
              </Button>
            )}
          </SettingsRow>
          {draft.failure && (
            <SettingsRow
              title={language.t(failureRoles[draft.failure.role])}
              description={[
                language.t(failureReasons[draft.failure.failure.kind], {
                  status: String(draft.failure.failure.status ?? ""),
                }),
                draft.failure.failure.detail,
                language.t("settings.models.reasoning.failure.kept"),
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {() => (
                <Button
                  data-action="settings-reasoning-retry"
                  size="sm"
                  disabled={draft.checking}
                  onClick={() => void save(value)}
                >
                  {language.t("common.retry")}
                </Button>
              )}
            </SettingsRow>
          )}
        </SettingsList>
      )}
      {value && value.settings.onboarding !== "completed" && (
        <div className="text-12-regular text-ink-muted">{language.t("settings.models.reasoning.pending")}</div>
      )}
    </section>
  )
}

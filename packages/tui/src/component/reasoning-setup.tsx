import type { IntelligenceEvaluator, IntelligenceSettings } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { DialogIntegration } from "./dialog-integration"
import { errorMessage } from "../util/error"

export async function configureReasoning(context: Plugin.Context, saved: (settings: IntelligenceSettings) => void) {
  const api = context.client["server.intelligence"]
  const status = await api.status()
  const location = context.location ?? context.data.location.default()
  const models = (await context.client.model.list({ location })).data
    .filter(
      (model) => model.enabled && model.capabilities.output.includes("text") && !/(^|\/)jev(?:$|[-.])/i.test(model.id),
    )
    .toSorted((a, b) => a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name))
  if (!models.length) {
    context.ui.dialog.show(() => (
      <DialogIntegration
        onConnected={() => {
          void configureReasoning(context, saved).catch((error) =>
            context.ui.toast.show({ variant: "error", message: errorMessage(error) }),
          )
        }}
      />
    ))
    return
  }
  const reasoning = await context.ui.dialog.select({
    title: "Reasoning mode",
    current: status.effective.reasoning,
    options: [
      { value: "single" as const, title: "Single · S2 only", description: "System Two generates responses" },
      { value: "dual" as const, title: "Dual · S2 + S1", description: "System One evaluates System Two's work" },
    ],
  })
  if (!reasoning) return
  const principal = await context.ui.dialog.select({
    title: "S2 · System Two model",
    current: status.settings.principal && `${status.settings.principal.providerID}/${status.settings.principal.id}`,
    options: models.map((model) => ({
      value: `${model.providerID}/${model.id}`,
      title: model.name,
      category: model.providerID,
      description:
        model.id === status.router?.recommended?.default?.id && model.providerID === status.router.providerID
          ? `Recommended · ${status.router.recommended.default.reason}`
          : model.id,
    })),
  })
  if (!principal) return
  const selected = models.find((model) => `${model.providerID}/${model.id}` === principal)!
  const evaluator = reasoning === "dual" ? await chooseEvaluator(context, status) : undefined
  if (reasoning === "dual" && !evaluator) return
  const model = { providerID: selected.providerID, id: selected.id }
  const confirmed = await context.ui.dialog.confirm({
    title: "Test and save reasoning roles",
    message: `S2: ${principal}\n${evaluator ? `S1: ${evaluator.evaluator.transport}/${evaluator.evaluator.model}\nSources and candidates will be sent to this evaluator.\n` : ""}This sends a small connection check before saving.${status.effective.source === "flag" ? `\nThe server's REDCODE_REASONING=${status.environment} overrides the saved mode.` : ""}`,
  })
  if (!confirmed) return
  context.ui.toast.show({ variant: "info", message: "Checking reasoning connections…" })
  await context.client.generate.text(
    { prompt: "Reply with OK.", model, location },
    { signal: AbortSignal.timeout(30_000) },
  )
  if (evaluator) {
    const check = await api.probe(evaluator, { signal: AbortSignal.timeout(30_000) })
    if (!check.ok) throw new Error(check.message)
  }
  const settings = await api.save({
    settings: {
      ...status.settings,
      enabled: true,
      reasoning,
      onboarding: "completed",
      principal: model,
      ...(evaluator ? { evaluator: evaluator.evaluator } : {}),
    },
    ...(evaluator?.apiKey ? { apiKey: evaluator.apiKey } : {}),
  })
  saved(settings)
  context.ui.toast.show({
    variant: "success",
    message: reasoning === "dual" ? "S2 and S1 configured" : "S2 configured",
  })
}

async function chooseEvaluator(
  context: Plugin.Context,
  status: Awaited<ReturnType<Plugin.Context["client"]["server.intelligence"]["status"]>>,
) {
  const options = [
    ...(status.settings.evaluator
      ? [{ name: "Keep current evaluator", evaluator: status.settings.evaluator, keep: true }]
      : []),
    ...(status.router?.evaluator
      ? [{ name: "Detected RedRouter · existing connection", evaluator: status.router.evaluator, keep: false }]
      : []),
    ...status.evaluators.map((option) => ({ ...option, keep: false })),
  ]
  const index = await context.ui.dialog.select({
    title: "S1 · System One connection",
    options: options.map((option, index) => ({
      value: index,
      title: option.name,
      description: `${option.evaluator.baseURL} · ${option.evaluator.model}`,
    })),
  })
  if (index === undefined) return
  const chosen = options[index]
  if (chosen.keep) return { evaluator: chosen.evaluator, apiKey: undefined }
  const baseURL = await context.ui.dialog.prompt({ title: "S1 API base URL", value: chosen.evaluator.baseURL })
  if (baseURL === undefined) return
  const apiKey = await context.ui.dialog.prompt({
    title: "S1 API key",
    description: "Leave empty to reuse the saved credential or provider connection.",
  })
  if (apiKey === undefined) return
  const evaluator: IntelligenceEvaluator = {
    ...chosen.evaluator,
    baseURL: baseURL.trim(),
    // A credential selected for one endpoint must not follow an edited URL.
    credentialID: baseURL.trim() === chosen.evaluator.baseURL ? chosen.evaluator.credentialID : undefined,
  }
  const discovered = await context.client["server.intelligence"]
    .discover(
      { evaluator, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      { signal: AbortSignal.timeout(30_000) },
    )
    .catch((error) => {
      context.ui.toast.show({
        variant: "warning",
        message: `Model discovery failed: ${errorMessage(error)}. Enter a model ID to test it.`,
      })
      return undefined
    })
  const model = discovered?.models.length
    ? await context.ui.dialog.select({
        title: "S1 · Evaluator model",
        options: [
          ...discovered.models.map((model) => ({ value: model.id, title: model.name, description: model.id })),
          { value: "", title: "Enter model ID manually" },
        ],
      })
    : ""
  if (model === undefined) return
  const id = model || (await context.ui.dialog.prompt({ title: "S1 model ID", value: evaluator.model }))
  if (!id?.trim()) return
  return { evaluator: { ...evaluator, model: id.trim() }, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }
}

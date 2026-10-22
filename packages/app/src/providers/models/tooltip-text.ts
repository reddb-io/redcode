import type { SharedLanguage } from "@/runtime/react/language"
import type { ModelSelection } from "./selection"

export function modelTooltipDescription(
  model: ReturnType<ModelSelection["list"]>[number],
  language: SharedLanguage,
  free = false,
) {
  const labels = {
    text: language.t("model.input.text"),
    image: language.t("model.input.image"),
    audio: language.t("model.input.audio"),
    video: language.t("model.input.video"),
    pdf: language.t("model.input.pdf"),
  }
  const inputs = Object.entries(model.capabilities.input)
    .filter(([, enabled]) => enabled)
    .map(([kind]) => labels[kind as keyof typeof labels])
    .join(", ")
  const tags = [
    model.latest ? language.t("model.tag.latest") : undefined,
    free ? language.t("model.tag.free") : undefined,
  ].filter(Boolean)
  return [
    `${language.t("model.tooltip.model")}: ${model.name}${tags.length ? ` (${tags.join(", ")})` : ""}`,
    `${language.t("model.tooltip.provider")}: ${model.provider.name}`,
    ...(inputs ? [`${language.t("model.tooltip.inputs")}: ${inputs}`] : []),
    `${language.t("model.tooltip.reasoning")}: ${language.t(model.capabilities.reasoning ? "model.tooltip.reasoning.allowed" : "model.tooltip.reasoning.none")}`,
    `${language.t("model.tooltip.context.label")}: ${model.limit.context.toLocaleString(language.intl)}`,
  ].join("\n")
}

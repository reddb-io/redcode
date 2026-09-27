import type { Model } from "@opencode/schema/model"

export function compatibility(input: unknown): Model.Compatibility | undefined {
  if (typeof input === "string") return { reasoningField: input }
  if (typeof input !== "object" || input === null || Array.isArray(input) || !("field" in input)) return undefined
  return typeof input.field === "string" ? { reasoningField: input.field } : undefined
}

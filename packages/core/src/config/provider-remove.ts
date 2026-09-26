export * as ConfigProviderRemove from "./provider-remove.js"

type Edit = { readonly path: readonly string[]; readonly value: unknown }

export function plan(input: unknown, providerID: string, hide: boolean) {
  const data = record(input)
  const edits: Edit[] = []
  const references: string[] = []
  const uses = (value: unknown) =>
    typeof value === "string"
      ? value.startsWith(`${providerID}/`)
      : record(value).providerID === providerID

  const configured = ["providers", "provider"].some((key) => Object.hasOwn(record(data[key]), providerID))
  ;(["providers", "provider"] as const).forEach((key) => {
    if (Object.hasOwn(record(data[key]), providerID)) edits.push({ path: [key, providerID], value: undefined })
  })
  ;(["model", "small_model"] as const).forEach((key) => {
    if (!uses(data[key])) return
    references.push(key)
    edits.push({ path: [key], value: undefined })
  })
  ;(["agents", "agent", "commands", "command"] as const).forEach((key) => {
    Object.entries(record(data[key])).forEach(([name, item]) => {
      if (!uses(record(item).model)) return
      references.push(`${key}.${name}.model`)
      edits.push({ path: [key, name, "model"], value: undefined })
    })
  })
  ;(["enabled_providers", "disabled_providers"] as const).forEach((key) => {
    const list = data[key]
    if (!Array.isArray(list) || !list.includes(providerID)) return
    references.push(key)
    const next = list.filter((item) => item !== providerID)
    edits.push({ path: [key], value: next.length ? next : undefined })
  })

  const experimental = record(data.experimental)
  const policies = Array.isArray(experimental.policies) ? experimental.policies : []
  const owned = policies.filter((item) => {
    const policy = record(item)
    return policy.source === "provider-removal" && policy.action === "provider.use" && policy.resource === providerID
  })
  const retained = policies.filter((item) => !owned.includes(item))
  const next = hide
    ? [...retained, { action: "provider.use", resource: providerID, effect: "deny", source: "provider-removal" }]
    : retained
  if (owned.length || hide) edits.push({ path: ["experimental", "policies"], value: next.length ? next : undefined })
  return { configured, references, hidden: hide, edits }
}

export function unhide(input: unknown, providerID: string) {
  const data = record(input)
  const edits: Edit[] = []
  const policies = record(data.experimental).policies
  const current = Array.isArray(policies) ? policies : []
  const next = current.filter((item) => {
    const policy = record(item)
    return policy.source !== "provider-removal" || policy.action !== "provider.use" || policy.resource !== providerID
  })
  if (next.length !== current.length)
    edits.push({ path: ["experimental", "policies"], value: next.length ? next : undefined })
  const disabled = data.disabled_providers
  if (Array.isArray(disabled) && disabled.includes(providerID)) {
    const remaining = disabled.filter((item) => item !== providerID)
    edits.push({ path: ["disabled_providers"], value: remaining.length ? remaining : undefined })
  }
  return edits
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

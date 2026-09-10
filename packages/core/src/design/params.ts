export * as DesignParams from "./params"

import { Design } from "@reddb-io/redcode-schema/design"

/** Validate relationships that cannot be expressed by an individual field's schema. */
export function validate(document: Pick<Design.Info, "controls" | "presets" | "scenarios">) {
  const components = document.controls ?? []
  const fail = (message: string): never => {
    throw new Design.Error({ code: "invalid", message })
  }
  if (new Set(components.map((item) => item.id)).size !== components.length)
    fail("Parameter component IDs must be unique")
  const valid = (field: Design.ParamField, value: unknown) => {
    if (field.type === "number")
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      )
    if (field.type === "boolean") return typeof value === "boolean"
    return (
      typeof value === "string" && value.length <= 4000 && (field.type !== "select" || field.options.includes(value))
    )
  }
  for (const component of components) {
    if (new Set(component.fields.map((field) => field.id)).size !== component.fields.length)
      fail(`Parameter IDs must be unique in ${component.id}`)
    for (const field of component.fields) {
      if (!valid(field, field.default)) fail(`Invalid parameter default: ${component.id}.${field.id}`)
      if (field.type === "select" && new Set(field.options).size !== field.options.length)
        fail(`Parameter options must be unique: ${component.id}.${field.id}`)
    }
  }
  const presets = document.presets ?? []
  if (new Set(presets.map((item) => item.id)).size !== presets.length) fail("Scenario preset IDs must be unique")
  for (const source of [
    ...presets.map((item) => ({ name: item.name, values: item.values })),
    ...document.scenarios.filter((item) => item.params).map((item) => ({ name: item.name, values: item.params! })),
  ]) {
    for (const [id, values] of Object.entries(source.values)) {
      const component = components.find((item) => item.id === id)
      if (!component) fail(`Unknown component in ${source.name}: ${id}`)
      for (const [key, value] of Object.entries(values)) {
        const field = component!.fields.find((item) => item.id === key)
        if (!field || !valid(field, value)) fail(`Invalid parameter in ${source.name}: ${id}.${key}`)
      }
    }
  }
}

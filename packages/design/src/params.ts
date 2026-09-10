import type { Design } from "@reddb-io/redcode-schema/design"

/** Serialized into the sandbox. Keep this function self-contained. */
export function params(components: readonly Design.ParamComponent[]) {
  const defaults = Object.fromEntries(
    components.map((component) => [
      component.id,
      Object.fromEntries(component.fields.map((field) => [field.id, field.default])),
    ]),
  )
  const state = { values: structuredClone(defaults), selecting: false, ready: false }
  const valid = (field: Design.ParamField, value: unknown) => {
    if (field.type === "boolean") return typeof value === "boolean"
    if (field.type === "number")
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      )
    if (typeof value !== "string" || value.length > 4000) return false
    return field.type !== "select" || field.options.includes(value)
  }
  const announce = () => {
    if (state.ready) parent.postMessage({ type: "design:params-state", values: state.values }, "*")
  }
  const apply = (data: unknown, reset: boolean, notify: boolean) => {
    if (!data || typeof data !== "object") return
    if (reset) state.values = structuredClone(defaults)
    for (const component of components) {
      const patch = Reflect.get(data, component.id)
      if (!patch || typeof patch !== "object") continue
      for (const field of component.fields) {
        const value = Reflect.get(patch, field.id)
        if (valid(field, value)) state.values[component.id][field.id] = value
      }
    }
    if (notify)
      window.dispatchEvent(
        new CustomEvent("design:params", {
          detail: { values: structuredClone(state.values), reset },
        }),
      )
    announce()
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    if (event.data?.type === "design:params-set") {
      state.ready = true
      apply(event.data.values, event.data.reset === true, true)
    }
    if (event.data?.type === "design:params-get") announce()
    if (event.data?.type === "design:params-select") state.selecting = event.data.enabled === true
  })
  window.addEventListener("design:state", (event) => {
    if (!(event instanceof CustomEvent)) return
    apply(event.detail?.values, false, false)
  })
  document.addEventListener(
    "click",
    (event) => {
      if (!state.selecting || !(event.target instanceof Element)) return
      const target = event.target
      const matches = components.flatMap((component) => {
        // Selectors are authored with the prototype; an invalid selector must not break interaction.
        try {
          const node = target.closest(component.selector)
          if (
            component.variant &&
            node?.closest<HTMLElement>("[data-design-variant]")?.dataset.designVariant !== component.variant
          )
            return []
          return node ? [{ component, node }] : []
        } catch {
          return []
        }
      })
      const selected = matches.find(
        (match) =>
          !matches.some((other) => other !== match && match.node !== other.node && match.node.contains(other.node)),
      )
      if (!selected) return
      event.preventDefault()
      event.stopImmediatePropagation()
      state.selecting = false
      parent.postMessage({ type: "design:params-component", component: selected.component.id }, "*")
    },
    true,
  )
  // The host requests state after load, including when scripts mount asynchronously.
  apply({}, true, true)
}

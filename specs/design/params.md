# Interactive parameters and scenarios

The shared Design review exposes **Params** alongside Review, Assets and Details. A prototype declares its component controls; the panel creates accessible text, number, select and checkbox inputs. Runtime changes stay local and require no provider call. **Save scenario** persists the current values in the Design document and publishes a new immutable revision. Historical revisions remain intact; saving is available on the latest open revision.

A variant is a visual direction. A scenario supplies values for experiencing that direction, such as a wizard at step two with a failed operation. A revision records the prototype source, controls and saved scenarios together.

## Review workflow

1. Open Params and select a component, or enable **Pick a component in the preview** and click it. Picking consumes one click and returns to normal interaction. Annotation and component picking are mutually exclusive.
2. Change properties or operate the prototype's buttons. Both update the same component state. In comparison view, Params controls the primary preview; the comparison remains independent.
3. Choose a saved scenario or edit values. **Restart scenario** reapplies the chosen scenario, or defaults when using custom values. Prototype code must cancel pending simulated work on reset.
4. Enter a scenario name and save. The saved revision contains all current parameter values. Reopening a review restores the local draft; saved scenarios travel with the document.
5. Add review notes while observing the relevant state. Each note retains its own parameter snapshot, component, variant and selected scenario; sending later does not rewrite earlier note context. Feedback also includes the current state. The agent receives this structured evidence through the normal feedback admission path.

Existing prototypes without controls remain interactive and show an explanatory empty state in Params. The agent must add bindings to expose their state; HTML inspection cannot infer arbitrary framework properties.

## Prototype contract

Use `design_document` with `action: "update"` and the following fields inside `input`:

```json
{
  "controls": [
    {
      "id": "wizard",
      "name": "Setup wizard",
      "selector": "#wizard",
      "fields": [
        { "id": "step", "name": "Current step", "type": "number", "default": 1, "min": 1, "max": 3 },
        {
          "id": "outcome",
          "name": "Simulated outcome",
          "type": "select",
          "default": "success",
          "options": ["success", "error", "loading"]
        }
      ]
    }
  ],
  "presets": [
    {
      "id": "step-two-error",
      "name": "Error at step two",
      "values": { "wizard": { "step": 2, "outcome": "error" } }
    }
  ],
  "scenarios": [
    {
      "id": "wizard-error",
      "name": "Error at step two",
      "selector": "#result",
      "state": "error",
      "params": { "wizard": { "step": 2, "outcome": "error" } },
      "actions": [{ "selector": "#submit", "action": "click" }]
    }
  ]
}
```

Components and presets may supply a `variant` ID. IDs start with a letter and contain letters, digits, underscores or hyphens, up to 64 characters. Field types are `text`, `boolean`, `number` and `select`; defaults must match their type and bounds. Parameter names are unique within a component. Document validation rejects unknown fields and invalid preset/scenario values.

Install the parameter listener before rendering or notifying the host:

```js
const state = { wizard: { step: 1, outcome: "success" } }
window.addEventListener("design:params", (event) => {
  if (event.detail.reset) cancelPendingSimulation()
  Object.assign(state.wizard, event.detail.values.wizard)
  render()
})
function next() {
  state.wizard.step = Math.min(3, state.wizard.step + 1)
  render()
  window.dispatchEvent(
    new CustomEvent("design:state", {
      detail: { values: { wizard: state.wizard } },
    }),
  )
}
```

For React/Solid, apply received values through the framework's state setter and publish user-driven changes through `design:state`. After asynchronous mounting, post `{type: "design:params-get"}` to `parent` to request the current panel state. Remove listeners on component unmount. Keep simulations local; the preview retains its isolated sandbox and cannot access host credentials or network APIs.

Audit and comparison initialize each scenario from component defaults plus `scenario.params`, then exercise its existing click/fill/press actions. Assertions observe `data-state` on the declared target. A saved preset is a reproducible configuration, not proof that the scenario passed; acceptance scenarios must declare actions and an observable expected state.

The browser regression fixture in `packages/server/test/fixture/design-params.html` demonstrates a working wizard with Previous/Next, success/error/loading/retry, and a modal with configurable warning/confirmation and centered OK or OK + Cancel actions.

import { jsx, jsxs } from "react/jsx-runtime";
import { StatusIndicator } from "@reddb-io/design-system/base";
import { operational } from "../../src/operational.variants.js";
import {
  validateGates,
  GATE_LABELS,
  GATE_TONES
} from "../../src/core/operational.js";
function PhaseSummary({
  label,
  gates,
  description,
  className
}) {
  const s = operational();
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-phase-summary": true,
      "aria-label": label,
      className: s.body({ class: className }),
      children: [
        /* @__PURE__ */ jsx("p", { className: s.title(), children: label }),
        description && /* @__PURE__ */ jsx("p", { className: s.description(), children: description }),
        /* @__PURE__ */ jsx("ul", { className: s.list(), children: validateGates(gates).map((gate) => /* @__PURE__ */ jsxs("li", { "data-gate-id": gate.id, "data-state": gate.state, children: [
          /* @__PURE__ */ jsxs("div", { className: s.row(), children: [
            /* @__PURE__ */ jsx("span", { className: s.title(), children: gate.label }),
            /* @__PURE__ */ jsx(
              StatusIndicator,
              {
                label: GATE_LABELS[gate.state],
                tone: GATE_TONES[gate.state]
              }
            )
          ] }),
          gate.description && /* @__PURE__ */ jsx("p", { className: s.description(), children: gate.description })
        ] }, gate.id)) })
      ]
    }
  );
}
export {
  PhaseSummary
};

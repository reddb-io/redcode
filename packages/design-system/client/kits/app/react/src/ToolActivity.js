"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { Disclosure } from "@reddb-io/design-system/base";
import { TOOL_STEP_STATUS_LABELS, toolActivityState } from "../../src/core/contracts/toolactivity.js";
import { toolActivity } from "../../src/composites/tool-activity.variants.js";
function ToolActivity({ summary, steps, open, statusLabels, onOpenChange, detail, className }) {
  const styles = toolActivity();
  const labels = { ...TOOL_STEP_STATUS_LABELS, ...statusLabels };
  const state = toolActivityState(steps);
  return /* @__PURE__ */ jsx("div", { "data-tool-activity": true, "data-state": state, className: styles.root({ class: className }), "aria-busy": state === "running" ? true : void 0, children: /* @__PURE__ */ jsx(Disclosure, { label: summary, open, onOpenChange, children: /* @__PURE__ */ jsx("ol", { className: styles.steps(), children: steps.map((step) => /* @__PURE__ */ jsxs("li", { "data-tool-step": step.id, "data-status": step.status, className: styles.item(), children: [
    /* @__PURE__ */ jsxs("div", { className: styles.step(), children: [
      step.kind && /* @__PURE__ */ jsx("span", { className: styles.kind(), children: step.kind }),
      /* @__PURE__ */ jsx("span", { className: styles.label(), children: step.label }),
      /* @__PURE__ */ jsx("span", { className: toolActivity({ state: step.status }).status(), children: labels[step.status] })
    ] }),
    detail && /* @__PURE__ */ jsx("div", { "data-tool-step-detail": true, className: styles.detail(), children: detail(step) })
  ] }, step.id)) }) }) });
}
export {
  ToolActivity
};

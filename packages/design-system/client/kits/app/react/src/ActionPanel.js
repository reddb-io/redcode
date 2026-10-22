import { jsx } from "react/jsx-runtime";
import { Card, SectionHeading } from "@reddb-io/design-system/base";
import { actionPanel } from "../../src/composites/action-panel.variants.js";
function ActionPanel({ title, description, level = 2, variant = "outline", padding = "md", actions, children, className, ...rest }) {
  const styles = actionPanel();
  return /* @__PURE__ */ jsx(Card, { ...rest, "data-action-panel": true, role: "region", "aria-label": rest["aria-label"] ?? title, raised: true, variant, padding, className: styles.root({ class: className }), header: /* @__PURE__ */ jsx(SectionHeading, { title, description, level, size: "sm", rule: false, className: styles.heading() }), footer: /* @__PURE__ */ jsx("div", { "data-action-panel-actions": true, className: styles.actions(), children: actions }), children: /* @__PURE__ */ jsx("div", { "data-action-panel-content": true, className: styles.content(), children }) });
}
export {
  ActionPanel
};

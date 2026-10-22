import { jsx, jsxs } from "react/jsx-runtime";
import { NODE_STATUS_TONES, nodeBadge } from "../../src/primitives/node-badge.variants.js";
function NodeBadge({ name, status = "unknown", showStatus = true, className, ...rest }) {
  const styles = nodeBadge({ status, labelled: showStatus });
  return /* @__PURE__ */ jsxs("span", { ...rest, className: styles.root({ class: className }), "data-node-status": status, "data-tone": NODE_STATUS_TONES[status], children: [
    /* @__PURE__ */ jsx("span", { className: styles.dot(), "aria-hidden": "true" }),
    /* @__PURE__ */ jsx("span", { className: styles.name(), children: name }),
    /* @__PURE__ */ jsx("span", { className: styles.status(), children: status })
  ] });
}
export {
  NodeBadge
};

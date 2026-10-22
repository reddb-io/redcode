import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { steps } from "../../src/steps.variants.js";
import { Link } from "./Link.js";
function Steps({ items, label = "Progress", className }) {
  const styles = steps();
  return /* @__PURE__ */ jsx("nav", { "aria-label": label, "data-steps": true, className: styles.root({ class: className }), children: /* @__PURE__ */ jsx("ol", { className: styles.list(), children: items.map((item, index) => {
    const content = /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.marker(), children: item.state === "complete" ? "\u2713" : index + 1 }),
      /* @__PURE__ */ jsx("span", { children: item.label }),
      item.state === "complete" && /* @__PURE__ */ jsx("span", { className: styles.status(), children: "Completed" })
    ] });
    return /* @__PURE__ */ jsx("li", { "data-step-state": item.state, className: styles.item(), children: item.state === "current" ? /* @__PURE__ */ jsxs("span", { "aria-current": "step", className: styles.content(), children: [
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.marker(), children: index + 1 }),
      /* @__PURE__ */ jsx("span", { className: styles.current(), children: item.label })
    ] }) : item.href !== void 0 ? /* @__PURE__ */ jsx(Link, { href: item.href, className: styles.content(), children: content }) : /* @__PURE__ */ jsx("span", { className: styles.content(), children: content }) }, item.id);
  }) }) });
}
export {
  Steps
};

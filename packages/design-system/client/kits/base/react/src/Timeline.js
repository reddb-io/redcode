import { jsx, jsxs } from "react/jsx-runtime";
import { timeline } from "../../src/timeline.variants.js";
import { Link } from "./Link.js";
function Timeline({ items, label = "Timeline", className, ...rest }) {
  const slots = timeline();
  return /* @__PURE__ */ jsx("ol", { ...rest, "data-timeline": true, "aria-label": label, className: slots.root({ class: className }), children: items.map((item) => /* @__PURE__ */ jsxs("li", { "data-timeline-item": true, className: slots.item(), children: [
    /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: slots.marker() }),
    /* @__PURE__ */ jsxs("span", { className: slots.content(), children: [
      /* @__PURE__ */ jsx("time", { dateTime: item.datetime, className: slots.time(), children: item.time }),
      item.href !== void 0 ? /* @__PURE__ */ jsx(Link, { href: item.href, className: slots.title(), children: item.title }) : /* @__PURE__ */ jsx("span", { className: slots.title(), children: item.title }),
      item.description !== void 0 && /* @__PURE__ */ jsx("p", { className: slots.description(), children: item.description })
    ] })
  ] }, item.id)) });
}
export {
  Timeline
};

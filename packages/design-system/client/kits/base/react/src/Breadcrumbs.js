import { jsx, jsxs } from "react/jsx-runtime";
import { breadcrumbs } from "../../src/breadcrumbs.variants.js";
import { breadcrumbList, serializeJsonLd } from "../../src/structured-data.js";
import { Link } from "./Link.js";
function Breadcrumbs({ items, label = "Breadcrumbs", structuredData = false, className }) {
  const styles = breadcrumbs();
  const jsonLd = structuredData === false ? void 0 : serializeJsonLd(breadcrumbList(items, structuredData === true ? {} : { origin: structuredData.origin }));
  return /* @__PURE__ */ jsxs("nav", { "aria-label": label, "data-breadcrumbs": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("ol", { className: styles.list(), children: items.map((item, index) => /* @__PURE__ */ jsxs("li", { className: styles.item(), children: [
      item.current ? /* @__PURE__ */ jsx("span", { "aria-current": "page", className: styles.current(), children: item.label }) : item.href !== void 0 ? /* @__PURE__ */ jsx(Link, { href: item.href, className: styles.link(), children: item.label }) : /* @__PURE__ */ jsx("span", { children: item.label }),
      index < items.length - 1 && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.separator(), children: "/" })
    ] }, item.id)) }),
    jsonLd && /* @__PURE__ */ jsx("script", { type: "application/ld+json", dangerouslySetInnerHTML: { __html: jsonLd } })
  ] });
}
export {
  Breadcrumbs
};

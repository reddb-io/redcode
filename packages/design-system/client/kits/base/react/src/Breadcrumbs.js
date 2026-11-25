"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useLayoutEffect, useRef, useState } from "react";
import { breadcrumbMenuItems, collapseBreadcrumbs } from "../../src/core/breadcrumbs.js";
import { observeRowCollapse, rowEntries } from "../../src/core/overflow.js";
import { breadcrumbs } from "../../src/breadcrumbs.variants.js";
import { breadcrumbList, serializeJsonLd } from "../../src/structured-data.js";
import { DropdownMenu } from "./DropdownMenu.js";
import { Link } from "./Link.js";
function Breadcrumbs({ items, label = "Breadcrumbs", structuredData = false, overflow = "collapse", moreLabel = "More", className }) {
  const styles = breadcrumbs({ overflow });
  const jsonLd = structuredData === false ? void 0 : serializeJsonLd(breadcrumbList(items, structuredData === true ? {} : { origin: structuredData.origin }));
  const list = useRef(null), observer = useRef(void 0), latest = useRef(items);
  latest.current = items;
  const [hidden, setHidden] = useState([]);
  useLayoutEffect(() => {
    if (overflow !== "collapse" || !list.current) return;
    const active = observeRowCollapse(list.current, { ids: () => latest.current.map((item) => item.id), plan: (measure) => collapseBreadcrumbs(latest.current, measure), onchange: setHidden });
    observer.current = active;
    return () => {
      active.disconnect();
      observer.current = void 0;
      setHidden([]);
    };
  }, [overflow]);
  useLayoutEffect(() => {
    observer.current?.update();
  }, [items, hidden]);
  const entries = rowEntries(items, overflow === "collapse" ? hidden : []);
  return /* @__PURE__ */ jsxs("nav", { "aria-label": label, "data-breadcrumbs": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("ol", { ref: list, "data-overflow": overflow, className: styles.list(), children: entries.map((entry, index) => entry.kind === "more" ? /* @__PURE__ */ jsxs("li", { "data-overflow-more": true, className: styles.item(), children: [
      /* @__PURE__ */ jsx(DropdownMenu, { triggerLabel: moreLabel, contentLabel: `${label}: ${moreLabel}`, items: breadcrumbMenuItems(entry.items), variant: "ghost", size: "sm" }),
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.separator(), children: "/" })
    ] }, "\0more") : /* @__PURE__ */ jsxs("li", { className: styles.item(), "data-overflow-item": overflow === "collapse" ? entry.item.id : void 0, children: [
      entry.item.current ? /* @__PURE__ */ jsx("span", { "aria-current": "page", className: styles.current(), children: entry.item.label }) : entry.item.href !== void 0 ? /* @__PURE__ */ jsx(Link, { href: entry.item.href, className: styles.link(), children: entry.item.label }) : /* @__PURE__ */ jsx("span", { children: entry.item.label }),
      index < entries.length - 1 && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.separator(), children: "/" })
    ] }, entry.item.id)) }),
    jsonLd && /* @__PURE__ */ jsx("script", { type: "application/ld+json", dangerouslySetInnerHTML: { __html: jsonLd } })
  ] });
}
export {
  Breadcrumbs
};

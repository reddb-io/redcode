"use client";
import { jsx } from "react/jsx-runtime";
import { useId } from "react";
import { MediaObject, SectionHeading } from "@reddb-io/design-system/base";
import { incentive } from "../../src/composites/incentive.variants.js";
function Incentive({ title, description, level = 2, icon, actions, className, ...rest }) {
  const id = useId(), styles = incentive();
  return /* @__PURE__ */ jsx(MediaObject, { ...rest, "data-incentive": true, role: "region", "aria-labelledby": `${id}-title`, media: /* @__PURE__ */ jsx("div", { "data-incentive-icon": true, "aria-hidden": "true", className: styles.icon(), children: icon }), align: "start", gap: "md", contentClass: styles.content(), className: styles.root({ class: className }), children: /* @__PURE__ */ jsx(SectionHeading, { title, description, level, actions, titleId: `${id}-title`, size: "sm", rule: false, className: styles.heading() }) });
}
export {
  Incentive
};

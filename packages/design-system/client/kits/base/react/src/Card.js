"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { Icon } from "./Icon.js";
import { Image } from "./Image.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { card, CARD_RATIO_VALUES } from "../../src/card.variants.js";
import { warnDeprecated } from "../../src/deprecation.js";
function Card({ variant = "outline", raised = false, busy = false, busyLabel = "Loading card content", busyLabelHidden = false, tone = "neutral", padding = "md", actionsAlign = "start", orientation = "vertical", fit = "cover", position = "center", ratio = "16/9", span = "two-fifths", title, icon, description, header, media, image, priority = false, footer, className, children, ...rest }) {
  const slots = card({ variant, raised, tone, padding, actionsAlign, orientation, fit, position, ratio, span });
  const hasMediaSlot = media !== void 0 && media !== null && media !== false;
  const hasHeaderSlot = header !== void 0 && header !== null && header !== false;
  const hasFooterSlot = footer !== void 0 && footer !== null && footer !== false;
  const hasMedia = hasMediaSlot || Boolean(image);
  const hasHeader = hasHeaderSlot || Boolean(icon ?? title ?? description);
  useEffect(() => {
    if (tone === "brand") warnDeprecated("Card", 'tone="brand"', "a tone (neutral, info, success, warning, danger); the accent is an emphasis, not a tone");
  }, [tone]);
  const sections = /* @__PURE__ */ jsxs(Fragment, { children: [
    hasHeader && /* @__PURE__ */ jsx("div", { "data-card-header": true, className: slots.header(), children: hasHeaderSlot ? header : /* @__PURE__ */ jsxs(Fragment, { children: [
      icon ? /* @__PURE__ */ jsxs("div", { "data-card-title-row": true, className: slots.titleRow(), children: [
        /* @__PURE__ */ jsx(Icon, { icon, "aria-hidden": "true", className: slots.icon() }),
        title && /* @__PURE__ */ jsx("p", { "data-card-title": true, className: slots.title(), children: title })
      ] }) : title && /* @__PURE__ */ jsx("p", { "data-card-title": true, className: slots.title(), children: title }),
      description && /* @__PURE__ */ jsx("p", { "data-card-description": true, className: slots.description(), children: description })
    ] }) }),
    /* @__PURE__ */ jsxs("div", { "data-card-body": true, className: slots.body(), children: [
      busy && /* @__PURE__ */ jsx(LoadingIndicator, { label: busyLabel, labelHidden: busyLabelHidden, size: "sm", className: "mb-[var(--reddb-spatial-gap-sm)]", "data-card-busy": true }),
      children
    ] }),
    hasFooterSlot && /* @__PURE__ */ jsx("div", { "data-card-footer": true, className: slots.footer(), children: footer })
  ] });
  const region = /* @__PURE__ */ jsxs("div", { "data-card-media": true, "data-card-media-fit": fit, "data-card-media-position": position, "data-card-media-ratio": ratio, "data-card-media-span": span, className: slots.media(), children: [
    hasMediaSlot ? media : image && /* @__PURE__ */ jsx(Image, { ...image, ratio: image.ratio ?? (ratio === "auto" ? void 0 : CARD_RATIO_VALUES[ratio]), fit, position, priority, className: "size-full" }),
    span === "background" && /* @__PURE__ */ jsx("span", { "data-background-media-scrim": "strong", "aria-hidden": "true", className: "pointer-events-none absolute inset-0 bg-background/80" })
  ] });
  const content = /* @__PURE__ */ jsx("div", { "data-card-content": true, className: slots.content(), children: sections });
  return /* @__PURE__ */ jsx("div", { ...rest, "data-card": true, "data-raised": raised || void 0, "data-tone": tone, "data-card-orientation": orientation, "aria-busy": busy || void 0, className: slots.root({ class: className }), children: hasMedia ? span === "background" ? /* @__PURE__ */ jsxs(Fragment, { children: [
    region,
    content
  ] }) : /* @__PURE__ */ jsxs("div", { "data-card-layout": true, className: slots.layout(), children: [
    region,
    content
  ] }) : sections });
}
export {
  Card
};

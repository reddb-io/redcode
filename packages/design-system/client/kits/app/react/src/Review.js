"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Avatar, Card, MediaObject, Rating } from "@reddb-io/design-system/base";
import { review } from "../../src/composites/review.variants.js";
function Review({ author, avatarSrc, avatarFallback, rating: score, maxRating = 5, datetime, time, children, actions, className, ...rest }) {
  const id = useId(), styles = review();
  return /* @__PURE__ */ jsx("article", { ...rest, "data-review": true, "aria-label": rest["aria-label"] ?? `Review by ${author}`, className: styles.root({ class: className }), children: /* @__PURE__ */ jsx(Card, { className: styles.card(), header: /* @__PURE__ */ jsx(MediaObject, { media: /* @__PURE__ */ jsx(Avatar, { src: avatarSrc, name: author, fallback: avatarFallback }), children: /* @__PURE__ */ jsxs("div", { className: styles.identity(), children: [
    /* @__PURE__ */ jsx("span", { "data-review-author": true, className: styles.author(), children: author }),
    datetime !== void 0 && time !== void 0 && /* @__PURE__ */ jsx("time", { dateTime: datetime, className: styles.time(), children: time })
  ] }) }), children: /* @__PURE__ */ jsxs("div", { "data-review-content": true, className: styles.content(), children: [
    /* @__PURE__ */ jsx(Rating, { id: `${id}-score`, legend: `Rating by ${author}`, name: `${id}-score`, value: score, max: maxRating, disabled: true }),
    /* @__PURE__ */ jsx("div", { "data-review-body": true, className: styles.body(), children }),
    actions != null && actions !== false && /* @__PURE__ */ jsx("footer", { "data-review-actions": true, className: styles.actions(), children: actions })
  ] }) }) });
}
export {
  Review
};

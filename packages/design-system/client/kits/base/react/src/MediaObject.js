import { jsx, jsxs } from "react/jsx-runtime";
import { mediaObject } from "../../src/media-object.variants.js";
function MediaObject({ media, children, align = "start", gap = "md", className, mediaClass, contentClass, ...rest }) {
  const styles = mediaObject({ align, gap });
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-media-object": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("div", { "data-media-object-media": true, className: styles.media({ class: mediaClass }), children: media }),
    /* @__PURE__ */ jsx("div", { "data-media-object-content": true, className: styles.content({ class: contentClass }), children })
  ] });
}
export {
  MediaObject
};

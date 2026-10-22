import { jsx } from "react/jsx-runtime";
import { contentMask, CONTENT_MASK_CLIP_PATHS } from "../../src/content-mask.variants.js";
function ContentMask({ shape, style, className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, "data-content-mask": true, "data-shape": shape, style: { ...style, clipPath: CONTENT_MASK_CLIP_PATHS[shape] }, className: contentMask({ class: className }) });
}
export {
  ContentMask
};

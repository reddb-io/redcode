import { jsx } from "react/jsx-runtime";
import { aspectRatio, DEFAULT_ASPECT_RATIO } from "../../src/aspect-ratio.variants.js";
function AspectRatio({ ratio = DEFAULT_ASPECT_RATIO, style, className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, "data-aspect-ratio": true, style: { ...style, aspectRatio: String(ratio) }, className: aspectRatio({ class: className }) });
}
export {
  AspectRatio
};

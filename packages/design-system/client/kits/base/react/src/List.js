import { jsx } from "react/jsx-runtime";
import { list } from "../../src/list.variants.js";
function List({ ordered = false, gap = "md", className, ...rest }) {
  const classes = list({ gap, class: className });
  if (ordered) return /* @__PURE__ */ jsx("ol", { ...rest, "data-list": true, className: classes });
  return /* @__PURE__ */ jsx("ul", { ...rest, "data-list": true, className: classes });
}
export {
  List
};

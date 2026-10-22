import { jsx } from "react/jsx-runtime";
import { gridList } from "../../src/grid-list.variants.js";
import { list as listAppearance } from "../../src/list.variants.js";
import { List } from "./List.js";
function GridList({ columns = 1, gap = "md", list = true, className, ...rest }) {
  const classes = gridList({ columns, class: className });
  if (list) return /* @__PURE__ */ jsx(List, { ...rest, "data-grid-list": true, gap, className: classes });
  return /* @__PURE__ */ jsx("div", { ...rest, "data-grid-list": true, className: listAppearance({ gap, class: classes }) });
}
export {
  GridList
};

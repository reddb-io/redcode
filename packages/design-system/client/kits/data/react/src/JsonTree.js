"use client";
import { Fragment, jsx } from "react/jsx-runtime";
import TreeView from "./TreeView.js";
import { buildJsonTree } from "../../src/viewer-tree.js";
import { buildJsonTree as buildJsonTree2, dottedPath } from "../../src/viewer-tree.js";
function JsonTree(props) {
  const {
    value,
    label = "JSON tree",
    expanded,
    onExpandedChange,
    selected,
    onSelectedChange,
    className = ""
  } = props;
  function reportExpanded(next) {
    onExpandedChange?.(next);
  }
  function reportSelected(path) {
    if (path === null) return;
    onSelectedChange?.(path);
  }
  const nodes = buildJsonTree(value);
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("div", { "data-json-tree": true, className, children: /* @__PURE__ */ jsx(
    TreeView,
    {
      label,
      nodes,
      expanded,
      onExpandedChange: reportExpanded,
      selected,
      onSelectedChange: reportSelected,
      renamable: false,
      reorderable: false
    }
  ) }) });
}
var JsonTree_default = JsonTree;
export {
  JsonTree,
  buildJsonTree2 as buildJsonTree,
  JsonTree_default as default,
  dottedPath
};

"use client";
import { Fragment, jsx } from "react/jsx-runtime";
import TreeView from "./TreeView.js";
import { buildXmlTree } from "../../src/viewer-tree.js";
import { buildXmlTree as buildXmlTree2, dottedPath } from "../../src/viewer-tree.js";
function XmlTree(props) {
  const {
    value,
    label = "XML tree",
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
  const nodes = buildXmlTree(value);
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("div", { "data-xml-tree": true, className, children: /* @__PURE__ */ jsx(
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
var XmlTree_default = XmlTree;
export {
  XmlTree,
  buildXmlTree2 as buildXmlTree,
  XmlTree_default as default,
  dottedPath
};

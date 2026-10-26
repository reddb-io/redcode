import {
  layoutSankey
} from "../../src/core/sankey-layout.js";
function SankeyLayout({
  data,
  width,
  height,
  nodeWidth,
  nodePadding,
  children
}) {
  return children(layoutSankey(data, width, height, nodeWidth, nodePadding));
}
export {
  SankeyLayout as default
};

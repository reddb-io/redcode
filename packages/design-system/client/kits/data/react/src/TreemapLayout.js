import {
  treemap
} from "d3-hierarchy";
function TreemapLayout({
  hierarchy,
  width,
  height,
  paddingInner,
  paddingTop,
  children
}) {
  const result = treemap().size([Math.max(1, width), Math.max(1, height)]).paddingInner(paddingInner).paddingTop(paddingTop)(hierarchy.copy());
  return children({ nodes: result.descendants() });
}
export {
  TreemapLayout as default
};

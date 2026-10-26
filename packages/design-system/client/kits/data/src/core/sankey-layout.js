import { sankey } from "d3-sankey";
function layoutSankey(data, width, height, nodeWidth = 12, nodePadding = 24) {
  const result = sankey().size([Math.max(1, width), Math.max(1, height)]).nodeId((node) => node.id).nodeWidth(nodeWidth).nodePadding(nodePadding)({ nodes: data.nodes.map((node) => ({ ...node })), links: data.links.map((link) => ({ ...link })) });
  return result;
}
export {
  layoutSankey
};

import { tokenColor } from "./color-token.js";
const tags = /* @__PURE__ */ new Set(["g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const attributes = /* @__PURE__ */ new Set(["d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "transform", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "strokeDasharray", "fillOpacity", "strokeOpacity", "opacity"]);
function validateNodes(nodes) {
  for (const node of nodes) {
    if (!tags.has(node.tag)) throw new Error(`Unsupported illustration element: ${node.tag}`);
    for (const [key, value] of Object.entries(node.attrs)) if (!attributes.has(key) || typeof value !== "string" || /[<>]|\b(?:url|expression)\s*\(|javascript:/i.test(value)) throw new Error(`Unsupported illustration attribute: ${key}`);
    if (node.children) validateNodes(node.children);
  }
}
function defineStateIllustration(asset) {
  validateNodes(asset.nodes);
  const freeze = (nodes) => {
    for (const node of nodes) {
      if (node.children) freeze(node.children);
      Object.freeze(node.attrs);
      Object.freeze(node);
    }
    Object.freeze(nodes);
  };
  freeze(asset.nodes);
  return Object.freeze(asset);
}
function illustrationNodes(asset) {
  if (!asset || !Array.isArray(asset.nodes) || !asset.name) throw new Error("StateIllustration requires a named illustration asset");
  validateNodes(asset.nodes);
  return asset.nodes;
}
function illustrationAttributes(node, accent) {
  const paint = tokenColor(accent, "var(--reddb-color-primary,currentColor)");
  return Object.fromEntries(Object.entries(node.attrs).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value === "var(--reddb-color-primary,currentColor)" ? paint : value]));
}
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function illustrationSvg(asset, accent) {
  const render = (nodes) => nodes.map((node) => {
    const attrs = Object.entries(illustrationAttributes(node, accent)).map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
    return node.children?.length ? `<${node.tag}${attrs}>${render(node.children)}</${node.tag}>` : `<${node.tag}${attrs}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300" aria-hidden="true" focusable="false">${render(illustrationNodes(asset))}</svg>
`;
}
export {
  defineStateIllustration,
  illustrationAttributes,
  illustrationNodes,
  illustrationSvg
};

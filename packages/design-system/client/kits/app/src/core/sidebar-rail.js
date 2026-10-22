import { navigationBadge } from "../composites/navigation.behavior.js";
function face(item) {
  return item.fallback ?? item.label.slice(0, 2).toUpperCase();
}
const words = (text) => text.normalize("NFKD").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function nameOf(item, labelled = false) {
  if (item.icon) return item.label;
  if (labelled) {
    return [item.label, item.badge === void 0 ? void 0 : navigationBadge(item.badge), face(item)].filter(Boolean).join(", ");
  }
  const shown = words(face(item));
  if (shown.length === 0) return item.label;
  const named = words(item.label);
  const held = named.some((_, start) => shown.every((word, offset) => named[start + offset] === word));
  return held ? item.label : `${face(item)}, ${item.label}`;
}
export {
  face,
  nameOf
};

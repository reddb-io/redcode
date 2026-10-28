import { CONTENT_STATES } from "./contracts/contentstate.js";
function contentStateHeight(height) {
  if (height === void 0) return void 0;
  if (typeof height === "number") {
    if (!Number.isFinite(height) || height <= 0) throw new RangeError("ContentState height must be positive and finite");
    return `${height}px`;
  }
  const value = height.trim();
  if (!value || /^(?:auto|min-content|max-content|fit-content|initial|inherit|unset|revert|revert-layer)$/.test(value)) {
    throw new RangeError("ContentState height must reserve a definite CSS length");
  }
  return value === "fill" ? "100%" : value;
}
function contentStateSemantics(state, label, emptyTitle, announcement) {
  if (!CONTENT_STATES.includes(state)) throw new Error("ContentState requires loading, ready, empty or error state");
  if (!label.trim()) throw new Error("ContentState requires a nonempty region label");
  return {
    busy: state === "loading",
    message: announcement ?? (state === "error" ? "" : `${label}: ${state === "loading" ? "loading" : state === "ready" ? "loaded" : emptyTitle}`)
  };
}
export {
  contentStateHeight,
  contentStateSemantics
};

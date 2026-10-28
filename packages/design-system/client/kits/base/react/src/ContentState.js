import { jsx, jsxs } from "react/jsx-runtime";
import { Skeleton } from "./Skeleton.js";
import { EmptyState } from "./EmptyState.js";
import { Alert } from "./Alert.js";
import { ScrollArea } from "./ScrollArea.js";
import { contentStateSemantics, contentStateHeight } from "../../src/core/content-state.js";
import { contentState } from "../../src/content-state.variants.js";
function ContentState({
  state,
  label,
  height,
  shape = "rectangle",
  rows = 5,
  columns = 4,
  animated = true,
  emptyTitle = "No results",
  emptyDescription,
  errorMessage = "Could not load content.",
  announcement,
  children,
  loading,
  empty,
  failure,
  className,
  style,
  ...rest
}) {
  const semantics = contentStateSemantics(state, label, emptyTitle, announcement), reserved = contentStateHeight(height), styles = contentState({ bounded: reserved !== void 0 });
  const content = state === "loading" ? loading ?? /* @__PURE__ */ jsx(Skeleton, { shape, rows, columns, animated, className: "h-full max-w-none", style: reserved === void 0 ? void 0 : { gridTemplateRows: "none" } }) : state === "empty" ? empty ?? /* @__PURE__ */ jsx(EmptyState, { title: emptyTitle, description: emptyDescription, bordered: false }) : state === "error" ? failure ? failure(errorMessage) : /* @__PURE__ */ jsx(Alert, { tone: "danger", children: errorMessage }) : children;
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-content-state": state, className: styles.root({ class: className }), style: reserved === void 0 ? style : { ...style, height: reserved }, children: [
    /* @__PURE__ */ jsx("p", { role: "status", "aria-live": "polite", "aria-atomic": "true", className: styles.announcement(), children: semantics.message }),
    reserved !== void 0 ? /* @__PURE__ */ jsx(ScrollArea, { label, variant: "plain", orientation: "both", "aria-busy": semantics.busy, className: styles.region(), "data-content-state-region": true, children: content }) : /* @__PURE__ */ jsx("div", { role: "region", "aria-label": label, "aria-busy": semantics.busy, className: styles.region(), "data-content-state-region": true, children: content })
  ] });
}
export {
  ContentState
};

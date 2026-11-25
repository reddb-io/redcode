import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Alert, Button, ContentState, LoadingIndicator, Timeline, collectionView } from "@reddb-io/design-system/base";
import { activityFeed } from "../../src/composites/activity-feed.variants.js";
function ActivityFeed({
  items,
  label = "Activity feed",
  state,
  errorMessage = "Could not load activity.",
  retryLabel = "Retry",
  loadingRows = 5,
  onRetry,
  className,
  "aria-busy": ariaBusy,
  ...rest
}) {
  const view = collectionView(state, items.length);
  if (view.placeholder)
    return /* @__PURE__ */ jsx(ContentState, { state: view.placeholder, label, emptyTitle: "No activity", errorMessage, retryLabel, onRetry, shape: "list", rows: loadingRows, "data-activity-feed-state": view.placeholder, className, children: /* @__PURE__ */ jsx("span", {}) });
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    view.stale && /* @__PURE__ */ jsxs(Alert, { tone: "danger", children: [
      errorMessage,
      onRetry && /* @__PURE__ */ jsxs(Fragment, { children: [
        " ",
        /* @__PURE__ */ jsx(Button, { size: "sm", variant: "secondary", onClick: onRetry, children: retryLabel })
      ] })
    ] }),
    state === "refreshing" && /* @__PURE__ */ jsx(LoadingIndicator, { size: "sm", label: "Refreshing" }),
    /* @__PURE__ */ jsx(Timeline, { ...rest, "aria-busy": view.busy ? true : ariaBusy, "data-activity-feed": true, "data-state": state ?? "ready", items, label, className: activityFeed().root({ class: className }) })
  ] });
}
export {
  ActivityFeed
};

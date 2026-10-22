import { jsx } from "react/jsx-runtime";
import { Timeline } from "@reddb-io/design-system/base";
import { activityFeed } from "../../src/composites/activity-feed.variants.js";
function ActivityFeed({ items, label = "Activity feed", className, ...rest }) {
  return /* @__PURE__ */ jsx(Timeline, { ...rest, "data-activity-feed": true, items, label, className: activityFeed().root({ class: className }) });
}
export {
  ActivityFeed
};

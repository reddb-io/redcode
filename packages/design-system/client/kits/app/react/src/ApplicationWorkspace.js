"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { applicationWorkspace } from "../../src/application-workspace.variants.js";
import { WorkspaceTabs } from "./WorkspaceTabs.js";
function ApplicationWorkspace({ label, landmarks = true, navigationLabel = "Navigation", documentLabel = "Documents", items, selected, onselectedchange, oncloserequest, emptyLabel, panelClass, navigation, toolbar, children, content, navigationClass, contentClass, className }) {
  const styles = applicationWorkspace();
  const Root = landmarks ? "section" : "div", Navigation = landmarks ? "aside" : "div";
  return /* @__PURE__ */ jsxs(Root, { role: landmarks ? void 0 : "group", "aria-label": label, "data-application-workspace": true, className: styles.root({ class: className }), children: [
    navigation != null && /* @__PURE__ */ jsx(Navigation, { role: landmarks ? void 0 : "group", "aria-label": navigationLabel, "data-application-workspace-navigation": true, className: styles.navigation({ class: navigationClass }), children: navigation }),
    /* @__PURE__ */ jsxs("div", { "data-application-workspace-content": true, className: styles.content({ class: contentClass }), children: [
      toolbar != null && /* @__PURE__ */ jsx("div", { "data-application-workspace-toolbar": true, className: styles.toolbar(), children: toolbar }),
      items ? /* @__PURE__ */ jsx(WorkspaceTabs, { label: documentLabel, items, selected, onselectedchange, oncloserequest, emptyLabel, panelClass, className: "min-h-0 flex-1", children }) : content
    ] })
  ] });
}
export {
  ApplicationWorkspace
};

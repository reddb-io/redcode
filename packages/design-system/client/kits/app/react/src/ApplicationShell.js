"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useContext } from "react";
import { Container, SkipLink, Stack } from "@reddb-io/design-system/base";
import { applicationShell } from "../../src/composites/application-shell.variants.js";
import { MainLandmarkContext } from "./layout-state.js";
function ApplicationShell({ mainId = "main-content", header, children, footer, fullWidth = false, embedded, className, ...rest }) {
  const owned = useContext(MainLandmarkContext), rendersMain = !(embedded ?? owned), styles = applicationShell({ fullWidth }), size = fullWidth ? "full" : "wide", containerClass = fullWidth ? "px-0" : void 0;
  const region = /* @__PURE__ */ jsx(Container, { size, className: styles.mainContainer({ class: fullWidth ? "h-full min-h-0 px-0 py-0" : void 0 }), children: /* @__PURE__ */ jsx(Stack, { className: fullWidth ? "h-full min-h-0" : void 0, children }) });
  return /* @__PURE__ */ jsx(MainLandmarkContext, { value: owned || rendersMain, children: /* @__PURE__ */ jsxs("div", { ...rest, "data-application-shell": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(SkipLink, { href: `#${mainId}` }),
    header != null && header !== false && /* @__PURE__ */ jsx("header", { className: styles.header(), "data-application-shell-region": "header", children: /* @__PURE__ */ jsx(Container, { size, className: styles.headerContainer({ class: containerClass }), children: header }) }),
    rendersMain ? /* @__PURE__ */ jsx("main", { id: mainId, tabIndex: -1, className: styles.main(), "data-application-shell-region": "main", children: region }) : /* @__PURE__ */ jsx("div", { id: mainId, tabIndex: -1, className: styles.main(), "data-application-shell-region": "main", children: region }),
    footer != null && footer !== false && /* @__PURE__ */ jsx("footer", { className: styles.footer(), "data-application-shell-region": "footer", children: /* @__PURE__ */ jsx(Container, { size, className: styles.footerContainer({ class: containerClass }), children: footer }) })
  ] }) });
}
export {
  ApplicationShell
};

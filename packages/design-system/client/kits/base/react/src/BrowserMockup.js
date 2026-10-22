import { jsx, jsxs } from "react/jsx-runtime";
import { AspectRatio } from "./AspectRatio.js";
import { browserMockup, DEFAULT_BROWSER_MOCKUP_RATIO } from "../../src/browser-mockup.variants.js";
function BrowserMockup({ address, ratio = DEFAULT_BROWSER_MOCKUP_RATIO, className, children, ...rest }) {
  const styles = browserMockup();
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-browser-mockup": true, role: "presentation", className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs("div", { "data-browser-mockup-chrome": true, "aria-hidden": "true", className: styles.chrome(), children: [
      /* @__PURE__ */ jsxs("span", { className: styles.controls(), children: [
        /* @__PURE__ */ jsx("span", { className: styles.control() }),
        /* @__PURE__ */ jsx("span", { className: styles.control() }),
        /* @__PURE__ */ jsx("span", { className: styles.control() })
      ] }),
      /* @__PURE__ */ jsx("span", { className: styles.address(), children: address ?? "" })
    ] }),
    /* @__PURE__ */ jsx(AspectRatio, { "data-browser-mockup-viewport": true, ratio, className: styles.viewport(), children })
  ] });
}
export {
  BrowserMockup
};

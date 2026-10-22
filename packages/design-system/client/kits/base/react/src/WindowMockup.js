import { jsx, jsxs } from "react/jsx-runtime";
import { AspectRatio } from "./AspectRatio.js";
import { windowMockup, DEFAULT_WINDOW_MOCKUP_RATIO } from "../../src/window-mockup.variants.js";
function WindowMockup({ title, ratio = DEFAULT_WINDOW_MOCKUP_RATIO, className, children, ...rest }) {
  const styles = windowMockup();
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-window-mockup": true, role: "presentation", className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs("div", { "data-window-mockup-chrome": true, "aria-hidden": "true", className: styles.chrome(), children: [
      /* @__PURE__ */ jsxs("span", { className: styles.controls(), children: [
        /* @__PURE__ */ jsx("span", { className: styles.control() }),
        /* @__PURE__ */ jsx("span", { className: styles.control() }),
        /* @__PURE__ */ jsx("span", { className: styles.control() })
      ] }),
      /* @__PURE__ */ jsx("span", { className: styles.title(), children: title ?? "" }),
      /* @__PURE__ */ jsx("span", { className: styles.balance() })
    ] }),
    /* @__PURE__ */ jsx(AspectRatio, { "data-window-mockup-viewport": true, ratio, className: styles.viewport(), children })
  ] });
}
export {
  WindowMockup
};

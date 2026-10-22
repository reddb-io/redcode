import { jsx, jsxs } from "react/jsx-runtime";
import { AspectRatio } from "./AspectRatio.js";
import { phoneMockup, DEFAULT_PHONE_MOCKUP_RATIO } from "../../src/phone-mockup.variants.js";
function PhoneMockup({ ratio = DEFAULT_PHONE_MOCKUP_RATIO, className, children, ...rest }) {
  const styles = phoneMockup();
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-phone-mockup": true, role: "presentation", className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("div", { "data-phone-mockup-chrome": true, "aria-hidden": "true", className: styles.chrome(), children: /* @__PURE__ */ jsx("span", { className: styles.speaker() }) }),
    /* @__PURE__ */ jsx(AspectRatio, { "data-phone-mockup-viewport": true, ratio, className: styles.viewport(), children })
  ] });
}
export {
  PhoneMockup
};

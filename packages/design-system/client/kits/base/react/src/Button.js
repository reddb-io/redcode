import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { button, buttonSpinner } from "../../src/button.variants.js";
function Button({ variant = "secondary", tone, size = "md", loading = false, block = false, disabled = false, children, className, ...rest }) {
  const inert = disabled || loading;
  const spinner = buttonSpinner({ size });
  const content = /* @__PURE__ */ jsxs(Fragment, { children: [
    loading && /* @__PURE__ */ jsxs("svg", { className: spinner.root(), viewBox: "0 0 24 24", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("circle", { className: spinner.track(), cx: "12", cy: "12", r: "9", strokeWidth: "3" }),
      /* @__PURE__ */ jsx("path", { className: spinner.head(), d: "M21 12a9 9 0 0 0-9-9", strokeWidth: "3", strokeLinecap: "round" })
    ] }),
    children
  ] });
  if (rest.href !== void 0) {
    const { href, ...anchor } = rest;
    return /* @__PURE__ */ jsx(
      "a",
      {
        ...anchor,
        href: inert ? void 0 : href,
        tabIndex: inert ? -1 : anchor.tabIndex,
        onClick: inert ? void 0 : anchor.onClick,
        "aria-disabled": inert || void 0,
        "aria-busy": loading || void 0,
        className: button({ variant, tone, size, block, class: className }),
        children: content
      }
    );
  }
  const native = rest;
  return /* @__PURE__ */ jsx(
    "button",
    {
      ...native,
      type: native.type ?? "button",
      disabled: inert,
      "aria-busy": loading || void 0,
      className: button({ variant, tone, size, block, class: className }),
      children: content
    }
  );
}
export {
  Button
};

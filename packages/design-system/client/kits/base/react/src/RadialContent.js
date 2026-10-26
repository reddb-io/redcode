import { jsx, jsxs } from "react/jsx-runtime";
import { Avatar } from "./Avatar.js";
import { radialContent } from "../../src/radial-content.variants.js";
function RadialContent({ title, value, description, avatar, className }) {
  const styles = radialContent();
  return /* @__PURE__ */ jsxs("div", { "data-radial-content": true, className: styles.root({ class: className }), children: [
    avatar && /* @__PURE__ */ jsx(Avatar, { ...avatar, size: "sm" }),
    title && /* @__PURE__ */ jsx("span", { title, className: styles.title(), children: title }),
    /* @__PURE__ */ jsx("strong", { title: String(value), className: styles.value(), children: value }),
    description && /* @__PURE__ */ jsx("span", { title: description, className: styles.description(), children: description })
  ] });
}
export {
  RadialContent
};

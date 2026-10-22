import { jsx, jsxs } from "react/jsx-runtime";
import { emptyState } from "../../src/empty-state.variants.js";
function EmptyState({ title, description, hint, size = "md", bordered = true, media, actions, className, ...rest }) {
  const slots = emptyState({ size, bordered });
  const hasMedia = media !== void 0 && media !== null && media !== false;
  const hasActions = actions !== void 0 && actions !== null && actions !== false;
  return /* @__PURE__ */ jsxs("div", { ...rest, className: slots.root({ class: className }), children: [
    hasMedia && /* @__PURE__ */ jsx("div", { className: slots.media(), "aria-hidden": "true", children: media }),
    /* @__PURE__ */ jsx("p", { className: slots.title(), children: title }),
    description && /* @__PURE__ */ jsx("p", { className: slots.description(), children: description }),
    hint && /* @__PURE__ */ jsx("code", { className: slots.hint(), children: hint }),
    hasActions && /* @__PURE__ */ jsx("div", { className: slots.actions(), children: actions })
  ] });
}
export {
  EmptyState
};

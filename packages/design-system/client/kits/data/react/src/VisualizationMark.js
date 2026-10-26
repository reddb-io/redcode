"use client";
import { jsx, jsxs } from "react/jsx-runtime";
function VisualizationMark({
  id,
  label,
  selected,
  onSelect,
  children
}) {
  return /* @__PURE__ */ jsxs(
    "g",
    {
      "data-mark-id": id,
      "data-selected": selected === id ? "" : void 0,
      role: onSelect ? "button" : "group",
      tabIndex: onSelect ? 0 : void 0,
      "aria-pressed": onSelect ? selected === id : void 0,
      onClick: onSelect ? () => onSelect(id) : void 0,
      onKeyDown: onSelect ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(id);
        }
      } : void 0,
      className: "outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus",
      style: { cursor: onSelect ? "pointer" : void 0 },
      children: [
        /* @__PURE__ */ jsx("title", { children: label }),
        children
      ]
    }
  );
}
export {
  VisualizationMark as default
};

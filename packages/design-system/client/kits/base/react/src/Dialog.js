"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useImperativeHandle, useRef } from "react";
import { createModalController } from "../../src/core/modal.js";
import { button } from "../../src/button.variants.js";
import { dialog, dialogClose } from "../../src/dialog.variants.js";
import { useValue } from "./state.js";
function Dialog(props) {
  const { triggerLabel, title, description, header, trigger, children, actions, initialFocus = "body", showClose = true, open = false, onOpenChange, dismissible = true, size = "md", className, ref, ...rest } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), id = useId();
  const element = useRef(null), controller = useRef(null);
  const latest = useRef({ initialFocus, dismissible });
  latest.current = { initialFocus, dismissible };
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => {
    controller.current = createModalController(element.current, { initialFocus: () => latest.current.initialFocus, dismissible: () => latest.current.dismissible, requestOpen: setActive });
    return () => {
      controller.current?.destroy();
      controller.current = null;
    };
  }, [setActive]);
  useEffect(() => controller.current?.sync(active), [active]);
  const close = () => setActive(false);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    triggerLabel && /* @__PURE__ */ jsx("button", { type: "button", "data-dialog-trigger": true, "aria-label": triggerLabel, "aria-haspopup": "dialog", "aria-expanded": active, className: button({ variant: "secondary", size: "sm" }), onClick: () => setActive(true), children: trigger ?? triggerLabel }),
    /* @__PURE__ */ jsxs(
      "dialog",
      {
        ...rest,
        ref: element,
        "aria-modal": "true",
        "aria-labelledby": `${id}-title`,
        "aria-describedby": description ? `${id}-description` : void 0,
        className: dialog({ size, class: [header ? "open:flex open:flex-col overflow-hidden" : "", className].filter(Boolean).join(" ") }),
        tabIndex: -1,
        children: [
          /* @__PURE__ */ jsx("h2", { id: `${id}-title`, "data-dialog-title": true, className: [header ? "sr-only" : "text-heading", showClose ? "pr-[var(--reddb-spatial-control-height-md)]" : ""].join(" "), children: title }),
          header && /* @__PURE__ */ jsx("div", { "data-dialog-header": true, className: "shrink-0", children: header({ close }) }),
          description && /* @__PURE__ */ jsx("p", { id: `${id}-description`, "data-dialog-description": true, className: "mt-[var(--reddb-spatial-gap-sm)] text-ink-muted", children: description }),
          showClose && !header && /* @__PURE__ */ jsx("button", { type: "button", "data-dialog-close": true, "aria-label": `Close ${title}`, className: button({ variant: "ghost", size: "sm", class: dialogClose() }), onClick: close, children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\xD7" }) }),
          children != null && /* @__PURE__ */ jsx("div", { "data-dialog-body": true, className: header ? "min-h-0 flex-1 overflow-y-auto" : "mt-[var(--reddb-spatial-gap-lg)]", children }),
          actions && /* @__PURE__ */ jsx("div", { "data-dialog-actions": true, children: actions({ close }) })
        ]
      }
    )
  ] });
}
export {
  Dialog
};

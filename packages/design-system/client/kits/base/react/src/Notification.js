"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { feedbackTone } from "../../src/core/feedback.js";
import { notification } from "../../src/notification.variants.js";
import { Alert } from "./Alert.js";
import { Button } from "./Button.js";
function Notification({ tone, title, children, dismissLabel = "Dismiss", onDismiss, className, ...rest }) {
  const [visible, setVisible] = useState(true);
  const slots = notification();
  if (!visible) return null;
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-notification": true, className: slots.root({ class: className }), children: [
    /* @__PURE__ */ jsx(Alert, { tone: feedbackTone(tone), title, className: slots.announcement(), children }),
    /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", className: slots.dismiss(), "aria-label": dismissLabel, onClick: () => {
      setVisible(false);
      onDismiss?.();
    }, children: dismissLabel })
  ] });
}
export {
  Notification
};

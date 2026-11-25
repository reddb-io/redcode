"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toastRole } from "../../src/core/toast-queue.js";
import { watchToasterAttention, watchToasterHost } from "../../src/core/toaster-dom.js";
import { toaster } from "../../src/toaster.variants.js";
import { Button } from "./Button.js";
import { Notification } from "./Notification.js";
const NONE = [];
function Toaster({ queue, label = "Notifications", position = "bottom-end", dismissLabel = "Dismiss", className }) {
  const shown = useSyncExternalStore(
    (notify) => queue.subscribe(() => notify()),
    () => queue.snapshot(),
    () => NONE
  );
  const [host, setHost] = useState(null);
  const region = useRef(null);
  const slots = toaster({ position });
  useEffect(() => watchToasterHost(document, setHost), []);
  useEffect(() => {
    if (!region.current) return;
    return watchToasterAttention(region.current, () => queue.pause(), () => queue.resume());
  }, [queue, host]);
  const act = (toast) => {
    toast.action?.onaction();
    queue.dismiss(toast.id);
  };
  if (!host) return null;
  return createPortal(
    /* @__PURE__ */ jsx("section", { ref: region, "aria-label": label, "data-toaster": true, className: slots.region({ class: className }), children: /* @__PURE__ */ jsx("ol", { className: slots.list(), children: shown.map((toast) => /* @__PURE__ */ jsx("li", { className: slots.item(), "data-toast": toast.id, role: toastRole(toast.tone), children: /* @__PURE__ */ jsxs(Notification, { tone: toast.tone, title: toast.title, dismissLabel, onDismiss: () => queue.dismiss(toast.id), children: [
      toast.description && /* @__PURE__ */ jsx("p", { className: slots.detail(), children: toast.description }),
      toast.action && /* @__PURE__ */ jsx(Button, { size: "sm", variant: "secondary", className: slots.action(), onClick: () => act(toast), children: toast.action.label })
    ] }) }, toast.id)) }) }),
    host
  );
}
export {
  Toaster
};

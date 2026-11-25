"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Button } from "@reddb-io/design-system/base";
import { approvalPrompt } from "../../src/composites/approval-prompt.variants.js";
function ApprovalPrompt({ title, description, decisions, pending = false, onDecide, request, className }) {
  const styles = approvalPrompt();
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => setAnnouncement(`Approval needed: ${title}`), [title]);
  return /* @__PURE__ */ jsxs("section", { "data-approval-prompt": true, "aria-label": title, "aria-busy": pending ? true : void 0, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("p", { className: styles.title(), children: title }),
    description && /* @__PURE__ */ jsx("p", { className: styles.description(), children: description }),
    request != null && request !== false && /* @__PURE__ */ jsx("div", { className: styles.request(), children: request }),
    /* @__PURE__ */ jsx("div", { className: styles.decisions(), children: decisions.map((decision) => /* @__PURE__ */ jsx(Button, { size: "sm", variant: decision.primary ? "primary" : "secondary", tone: decision.tone, disabled: pending, onClick: () => onDecide?.(decision.value), children: decision.label }, decision.value)) }),
    /* @__PURE__ */ jsx("span", { role: "status", className: styles.announcement(), children: announcement })
  ] });
}
export {
  ApprovalPrompt
};

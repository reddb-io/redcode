"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog.js";
import { Button } from "./Button.js";
import { alertDialog, alertDialogActions } from "../../src/alert-dialog.variants.js";
import { createConfirmationSession } from "../../src/core/confirmation.js";
import { useValue } from "./state.js";
function AlertDialog(props) {
  const { confirmLabel, cancelLabel = "Cancel", onConfirm, open = false, onOpenChange, className, ...rest } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), [pending, setPending] = useState(false);
  const session = useRef(null);
  session.current ??= createConfirmationSession(setPending);
  useLayoutEffect(() => {
    session.current.reset();
    return () => session.current.reset();
  }, [active]);
  return /* @__PURE__ */ jsx(
    Dialog,
    {
      ...rest,
      open: active,
      onOpenChange: setActive,
      role: "alertdialog",
      "data-alert-dialog": "",
      className: alertDialog({ class: className }),
      initialFocus: "actions",
      showClose: false,
      dismissible: false,
      actions: ({ close }) => /* @__PURE__ */ jsxs("div", { "data-alert-dialog-actions": true, className: alertDialogActions(), children: [
        /* @__PURE__ */ jsx(Button, { "data-alert-dialog-cancel": true, variant: "secondary", size: "sm", disabled: pending, onClick: close, children: cancelLabel }),
        /* @__PURE__ */ jsx(Button, { "data-alert-dialog-confirm": true, variant: "primary", tone: "danger", size: "sm", loading: pending, onClick: (event) => {
          void session.current.confirm(() => onConfirm?.(event.nativeEvent), close);
        }, children: confirmLabel })
      ] })
    }
  );
}
export {
  AlertDialog
};

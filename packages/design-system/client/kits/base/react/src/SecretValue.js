"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState, useId } from "react";
import { Button } from "./Button.js";
import { secretValue } from "../../src/secret-value.variants.js";
import {
  createSecretExposure,
  secretIsVisible
} from "../../src/core/secret-value.js";
function SecretValue(props) {
  const {
    label,
    value,
    revealable = false,
    revealed = false,
    hideAfter = 3e4,
    pending = false,
    error,
    onrevealedchange,
    hiddenLabel = "Hidden value",
    revealLabel = "Reveal",
    hideLabel = "Hide",
    className
  } = props;
  const s = secretValue(), id = useId(), root = useRef(null);
  const latest = useRef(props);
  latest.current = { ...props, revealed, hideAfter };
  const [exposed, setExposed] = useState(false);
  const exposure = useRef(null);
  useEffect(() => {
    const controller = createSecretExposure(() => latest.current, setExposed);
    exposure.current = controller;
    const document = root.current.ownerDocument;
    const changed = () => {
      if (document.visibilityState === "hidden") controller.hide("visibility");
    };
    document.addEventListener("visibilitychange", changed);
    controller.sync();
    return () => {
      controller.destroy();
      document.removeEventListener("visibilitychange", changed);
      exposure.current = null;
    };
  }, []);
  useEffect(() => {
    exposure.current?.sync();
  });
  const visible = exposed && secretIsVisible(props) && !!exposure.current?.matches(value);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: root,
      "data-secret-value": true,
      "data-revealed": visible,
      role: "group",
      "aria-labelledby": `${id}-label`,
      className: s.root({ class: className }),
      children: [
        /* @__PURE__ */ jsx("span", { id: `${id}-label`, className: s.label(), children: label }),
        /* @__PURE__ */ jsxs("div", { className: s.row(), "aria-busy": pending, children: [
          /* @__PURE__ */ jsx("span", { "data-secret-content": true, className: s.value(), children: visible ? value : /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" }),
            /* @__PURE__ */ jsx("span", { className: "sr-only", children: hiddenLabel })
          ] }) }),
          revealable && onrevealedchange && /* @__PURE__ */ jsx(
            Button,
            {
              variant: "ghost",
              size: "sm",
              loading: pending,
              "aria-label": `${visible ? hideLabel : revealLabel} ${label}`,
              "aria-pressed": visible,
              onClick: () => exposure.current?.request(!visible),
              children: visible ? hideLabel : revealLabel
            }
          )
        ] }),
        error && /* @__PURE__ */ jsx("p", { role: "alert", className: s.error(), children: error })
      ]
    }
  );
}
var SecretValue_default = SecretValue;
export {
  SecretValue,
  SecretValue_default as default
};

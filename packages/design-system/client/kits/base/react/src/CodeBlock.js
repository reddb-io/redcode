"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.js";
import { CODE_TOKEN_CLASSES, codeBlock, codeTokens } from "../../src/code-block.variants.js";
import { copyCodeSource, observeCodeOverflow } from "../../src/core/code-block.js";
function CodeBlock({ code, language, grammar, lineNumbers = false, copyLabel = "Copy code", copiedLabel = "Copied", copyErrorLabel = "Copy failed. Try again.", regionLabel, className, ...rest }) {
  const pre = useRef(null), request = useRef(0);
  const [overflowing, setOverflowing] = useState(false);
  const [copyState, setCopyState] = useState("idle");
  const slots = codeBlock(), tokens = codeTokens(code, grammar);
  useEffect(() => {
    setCopyState("idle");
    request.current++;
    return () => {
      request.current++;
    };
  }, [code]);
  useEffect(() => {
    if (pre.current) return observeCodeOverflow(pre.current, setOverflowing);
  }, [code, grammar]);
  async function copy() {
    const current = ++request.current;
    const copied = await copyCodeSource(code);
    if (current === request.current) setCopyState(copied ? "copied" : "failed");
  }
  const label = copyState === "copied" ? copiedLabel : copyState === "failed" ? copyErrorLabel : copyLabel;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ...rest,
      "data-code-block": true,
      "data-code-block-copied-label": copiedLabel,
      "data-code-block-copy-error-label": copyErrorLabel,
      "data-code-block-region-label": regionLabel ?? (language ? `${language} code` : "Code sample"),
      className: slots.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("div", { className: slots.toolbar(), children: [
          language ? /* @__PURE__ */ jsx("span", { "data-code-block-language": true, className: slots.language(), children: language }) : /* @__PURE__ */ jsx("span", { "aria-hidden": "true" }),
          /* @__PURE__ */ jsx(Button, { "data-code-block-copy": true, variant: "secondary", size: "sm", "aria-label": label, onClick: copy, children: /* @__PURE__ */ jsx("span", { "aria-live": "polite", children: label }) })
        ] }),
        /* @__PURE__ */ jsxs(
          "pre",
          {
            ref: pre,
            className: slots.pre({ class: lineNumbers ? "flex" : void 0 }),
            tabIndex: overflowing ? 0 : void 0,
            role: overflowing ? "region" : void 0,
            "aria-label": overflowing ? regionLabel ?? (language ? `${language} code` : "Code sample") : void 0,
            "data-code-block-overflowing": overflowing ? "true" : void 0,
            children: [
              lineNumbers && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: slots.gutter(), children: code.split("\n").map((_, index) => index + 1).join("\n") }),
              /* @__PURE__ */ jsx("code", { className: slots.code(), children: grammar ? tokens.map((token, index) => /* @__PURE__ */ jsx("span", { "data-code-token": token.kind, className: CODE_TOKEN_CLASSES[token.kind], children: token.value }, index)) : code })
            ]
          }
        )
      ]
    }
  );
}
export {
  CodeBlock
};

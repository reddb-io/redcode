"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Fieldset } from "./Fieldset.js";
import { oneTimeCodeInput } from "../../src/one-time-code-input.variants.js";
import { codeLength, codeCharacters, codeSegments } from "../../src/core/one-time-code.js";
import { afterFormReset, associatedForm } from "../../src/core/native-controls.js";
function OneTimeCodeInput({ label, name, length = 6, value, defaultValue = "", help, error, required = false, inputMode = "numeric", pattern = "[0-9]*", id, onComplete, onValueChange, className, segmentClass, ref, ...rest }) {
  const count = codeLength(length), generated = useId(), prefix = id ?? `${generated}-segment`;
  const initial = useRef((value ?? defaultValue).slice(0, count));
  const [local, setLocal] = useState(initial.current), [buffer, setBuffer] = useState(() => codeSegments(initial.current, count));
  const current = (value ?? local).slice(0, count);
  const segments = buffer.length === count && buffer.join("") === current ? buffer : codeSegments(current, count);
  const controls = useRef([]), element = useRef(null);
  const latest = useRef({ value, count });
  latest.current = { value, count };
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => afterFormReset(associatedForm(element.current, rest.form), () => {
    const next = (latest.current.value ?? initial.current).slice(0, latest.current.count);
    if (latest.current.value === void 0) setLocal(next);
    setBuffer(codeSegments(next, latest.current.count));
  }), [rest.form]);
  function publish(next) {
    const joined = next.join("");
    setBuffer(next);
    if (value === void 0) setLocal(joined);
    if (joined !== current) onValueChange?.(joined);
    if (next.every(Boolean)) onComplete?.(joined);
  }
  function focus(index) {
    controls.current[Math.max(0, Math.min(index, count - 1))]?.focus();
  }
  const styles = oneTimeCodeInput(), helpId = `${prefix}-help`, errorId = `${prefix}-error`;
  const describedBy = [help ? helpId : void 0, error ? errorId : void 0].filter(Boolean).join(" ") || void 0;
  return /* @__PURE__ */ jsx(Fieldset, { ...rest, ref: element, legend: label, className: styles.root({ class: className }), "data-one-time-code-input": true, "aria-invalid": error ? "true" : void 0, children: () => /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { className: styles.list(), "data-otp-list": true, children: segments.map((character, index) => /* @__PURE__ */ jsx(
      "input",
      {
        ref: (node) => {
          controls.current[index] = node;
        },
        id: `${prefix}-${index}`,
        type: "text",
        value: character,
        maxLength: 1,
        inputMode,
        pattern,
        autoComplete: index === 0 ? "one-time-code" : "off",
        required,
        form: rest.form,
        "aria-label": `Digit ${index + 1} of ${count}`,
        "aria-describedby": describedBy,
        "aria-invalid": error ? "true" : void 0,
        "data-otp-segment": true,
        className: styles.segment({ class: segmentClass }),
        onChange: (event) => {
          const next = [...segments];
          next[index] = codeCharacters(event.currentTarget.value, event.currentTarget.value.length).at(-1) ?? "";
          publish(next);
          if (next[index]) focus(index + 1);
        },
        onPaste: (event) => {
          const characters = codeCharacters(event.clipboardData.getData("text"), count - index);
          if (!characters.length) return;
          event.preventDefault();
          const next = [...segments];
          next.splice(index, characters.length, ...characters);
          publish(next);
          focus(index + characters.length - 1);
        },
        onKeyDown: (event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            focus(event.key === "Home" ? 0 : event.key === "End" ? count - 1 : index + (event.key === "ArrowLeft" ? -1 : 1));
          } else if (event.key === "Backspace" && !segments[index]) focus(index - 1);
        }
      },
      index
    )) }),
    name && /* @__PURE__ */ jsx("input", { type: "hidden", name, value: current, form: rest.form }),
    help && /* @__PURE__ */ jsx("p", { className: styles.help(), id: helpId, children: help }),
    error && /* @__PURE__ */ jsx("p", { className: styles.error(), id: errorId, role: "alert", children: error })
  ] }) });
}
export {
  OneTimeCodeInput
};

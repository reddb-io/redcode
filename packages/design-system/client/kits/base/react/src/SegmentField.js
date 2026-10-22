"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Field } from "./Field.js";
import { Input } from "./Input.js";
import { dateField } from "../../src/date-field.variants.js";
import { timeField } from "../../src/time-field.variants.js";
import { possibleDate, possibleTime, segmentDigits } from "../../src/core/date-segments.js";
import { afterFormReset } from "../../src/core/native-controls.js";
import { useValue } from "./state.js";
function SegmentField({ kind, label, name, value, initialValue, onValueChange, help, error, required = false, disabled = false, id, className, segmentClass }) {
  const [current, setCurrent, resetCurrent] = useValue(value, initialValue, onValueChange);
  const parse = kind === "date" ? possibleDate : possibleTime, separator = kind === "date" ? "-" : ":";
  const segments = kind === "date" ? ["year", "month", "day"] : ["hour", "minute"];
  const initial = useRef(initialValue), [draft, setDraft] = useState(() => segments.map((_, index) => parse(current)?.[index + 1] ?? ""));
  const draftRef = useRef(draft), published = useRef(current), controls = useRef([]), controlled = useRef(value);
  controlled.current = value;
  useEffect(() => {
    if (current === published.current) return;
    const match = parse(current);
    const next = segments.map((_, index) => match?.[index + 1] ?? "");
    draftRef.current = next;
    setDraft(next);
    published.current = current;
  }, [current, kind]);
  useEffect(() => afterFormReset(controls.current[0]?.form, () => {
    const nextValue = controlled.current ?? initial.current, match = parse(nextValue), next = segments.map((_, index) => match?.[index + 1] ?? "");
    draftRef.current = next;
    setDraft(next);
    published.current = nextValue;
    if (controlled.current === void 0) resetCurrent(nextValue);
  }), [kind, resetCurrent]);
  const styles = kind === "date" ? dateField() : timeField();
  return /* @__PURE__ */ jsx(Field, { label, help, error, required, id, className: styles.root({ class: className }), children: (control) => /* @__PURE__ */ jsxs("div", { className: styles.segments(), ...kind === "date" ? { "data-date-field": "", "data-date-segments": "" } : { "data-time-field": "", "data-time-segments": "" }, children: [
    segments.map((segment, index) => /* @__PURE__ */ jsxs("span", { className: "contents", children: [
      index > 0 && /* @__PURE__ */ jsx("span", { className: styles.separator(), "aria-hidden": "true", children: separator }),
      /* @__PURE__ */ jsx(
        Input,
        {
          ...control,
          ref: (node) => {
            controls.current[index] = node;
          },
          id: index === 0 ? control.id : `${control.id}-${segment}`,
          type: "text",
          inputMode: "numeric",
          maxLength: segment === "year" ? 4 : 2,
          value: draft[index],
          disabled,
          "aria-label": `${label}, ${segment}`,
          ...kind === "date" ? { "data-date-segment": segment } : { "data-time-segment": segment },
          className: kind === "date" && segment === "year" ? dateField().year({ class: segmentClass }) : styles.segment({ class: segmentClass }),
          onInput: (event) => {
            const text = segmentDigits(event.currentTarget.value, segment), next = [...draftRef.current];
            next[index] = text;
            event.currentTarget.value = text;
            draftRef.current = next;
            setDraft(next);
            const candidate = next.join(separator), nextValue = parse(candidate) ? candidate : "";
            published.current = nextValue;
            if (nextValue !== current) setCurrent(nextValue);
            if (text.length === (segment === "year" ? 4 : 2)) controls.current[index + 1]?.focus();
          },
          onKeyDown: (event) => {
            const next = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : -1;
            if (next >= 0 && next < segments.length) {
              event.preventDefault();
              controls.current[next]?.focus();
            }
          }
        }
      )
    ] }, segment)),
    name && parse(draft.join(separator)) && parse(current) && !disabled && /* @__PURE__ */ jsx("input", { type: "hidden", name, value: current })
  ] }) });
}
export {
  SegmentField
};

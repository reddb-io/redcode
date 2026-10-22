"use client";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { afterFormReset } from "../../src/core/native-controls.js";
function useBinaryChoice(checked, defaultChecked, ref, form) {
  const initial = useRef(defaultChecked ?? false);
  const [local, setLocal] = useState(initial.current);
  const supplied = useRef(checked);
  supplied.current = checked;
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => afterFormReset(element.current?.form, () => {
    const next = supplied.current ?? initial.current;
    if (supplied.current === void 0) setLocal(next);
    if (element.current) element.current.checked = next;
  }), [form]);
  return { element, current: checked ?? local, update: (next) => {
    if (checked === void 0) setLocal(next);
  } };
}
export {
  useBinaryChoice
};

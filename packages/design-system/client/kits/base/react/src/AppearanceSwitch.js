"use client";
import { jsx } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Field } from "./Field.js";
import { Select } from "./Select.js";
import { appearanceStorageKey } from "../../src/appearance-switch.behavior.js";
import { appearancePersistence, appearanceValue, commitAppearance, readAppearance } from "../../src/core/appearance-switch.js";
import { afterFormReset } from "../../src/core/native-controls.js";
function AppearanceSwitch({ label, axis, options, value, defaultValue, root, storage, persistKey, className, onValueChange, ref, ...rest }) {
  const [local, setLocal] = useState(() => appearanceValue(options, defaultValue));
  const initial = useRef(local), controlled = useRef(value);
  controlled.current = value;
  const selected = appearanceValue(options, value ?? local);
  const key = persistKey ?? appearanceStorageKey(axis);
  const scope = useRef(null);
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => {
    const persistence = appearancePersistence(storage), previous = scope.current;
    const changed = !previous || previous.axis !== axis || previous.key !== key || previous.storage !== storage;
    scope.current = { axis, key, storage };
    const next = changed && value === void 0 ? appearanceValue(options, readAppearance(persistence, key), selected) : selected;
    if (value === void 0 && next !== local) setLocal(next);
    commitAppearance(root ?? globalThis.document?.documentElement, axis, next, persistence, key);
  }, [axis, key, storage, root, selected, value, local, options]);
  useEffect(() => afterFormReset(element.current?.form, () => {
    if (controlled.current === void 0) setLocal(initial.current);
  }), [rest.form]);
  return /* @__PURE__ */ jsx(Field, { label, id: rest.id, children: (control) => /* @__PURE__ */ jsx(
    Select,
    {
      ...rest,
      ...control,
      ref: element,
      options,
      value: selected ?? "",
      className,
      "data-appearance-switch": true,
      "data-appearance-axis": axis,
      onValueChange: (next) => {
        if (!options.some((option) => !option.disabled && option.value === next) || next === selected) return;
        if (value === void 0) {
          setLocal(next);
          commitAppearance(root ?? globalThis.document?.documentElement, axis, next, appearancePersistence(storage), key);
        }
        onValueChange?.(next);
      }
    }
  ) });
}
export {
  AppearanceSwitch
};

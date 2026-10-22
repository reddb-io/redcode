"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Field } from "./Field.js";
import { Input } from "./Input.js";
import { fileInput } from "../../src/file-input.variants.js";
import { afterFormReset, fileNames } from "../../src/core/native-controls.js";
function FileInput({ label, help, error, required = false, id, files, onFilesChange, ref, className, fieldClass, multiple = false, onChange, ...rest }) {
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  const [names, setNames] = useState(() => fileNames(files));
  const selected = files === void 0 ? names : fileNames(files);
  const styles = fileInput();
  useEffect(() => {
    const input = element.current;
    if (!input || files === void 0) return;
    if (files === null) input.value = "";
    else if (input.files !== files) input.files = files;
  });
  useEffect(() => {
    const input = element.current;
    return afterFormReset(input?.form, () => {
      setNames([]);
    });
  }, [rest.form]);
  return /* @__PURE__ */ jsxs("div", { className: styles.root(), "data-file-input": true, children: [
    /* @__PURE__ */ jsx(Field, { label, help, error, required, id, className: styles.field({ class: fieldClass }), children: (control) => /* @__PURE__ */ jsx(
      Input,
      {
        ...rest,
        ...control,
        ref: element,
        type: "file",
        multiple,
        className: styles.control({ class: className }),
        onChange: (event) => {
          setNames(fileNames(event.currentTarget.files));
          onFilesChange?.(event.currentTarget.files);
          onChange?.(event);
        }
      }
    ) }),
    /* @__PURE__ */ jsx("p", { className: styles.filename(), "aria-live": "polite", "data-file-name": true, children: selected.length ? selected.join(", ") : multiple ? "No files selected" : "No file selected" })
  ] });
}
export {
  FileInput
};

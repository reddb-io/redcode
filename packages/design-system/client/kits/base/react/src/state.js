"use client";
import { afterFormReset } from "../../src/core/native-controls.js";
import { observePortalAppearance } from "../../src/core/portal-appearance.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
function useValue(value, fallback, changed) {
  const [local, setLocal] = useState(fallback);
  const current = value === void 0 ? local : value;
  const latest = useRef({ value, changed });
  latest.current = { value, changed };
  const update = useCallback((next) => {
    if (latest.current.value === void 0) setLocal(next);
    latest.current.changed?.(next);
  }, []);
  const reset = useCallback((next) => {
    if (latest.current.value === void 0) setLocal(next);
  }, []);
  return [current, update, reset];
}
function usePortalAppearance(source, open) {
  const [container, setContainer] = useState();
  const [attributes, setAttributes] = useState({});
  useLayoutEffect(() => {
    if (!open || !source.current) return;
    return observePortalAppearance(source.current, (next) => {
      setAttributes(next.attributes);
      setContainer(next.container);
    });
  }, [source, open]);
  return { attributes, container };
}
function useNativeFormReset(source, reset) {
  const latest = useRef(reset);
  latest.current = reset;
  useEffect(() => {
    const node = source.current;
    const form = node && "form" in node ? node.form : node?.closest("form");
    return afterFormReset(form, () => latest.current());
  }, [source]);
}
export {
  useNativeFormReset,
  usePortalAppearance,
  useValue
};

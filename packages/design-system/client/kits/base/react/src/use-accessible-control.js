"use client";
import { useEffect, useImperativeHandle, useRef } from "react";
import { checkButtonName, checkFieldName } from "../../src/core/a11y.js";
function useAccessibleControl(component, ref, fromContent = false) {
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => {
    if (fromContent) checkButtonName(component, element.current ?? void 0);
    else checkFieldName(component, element.current ?? void 0);
  });
  return element;
}
export {
  useAccessibleControl
};

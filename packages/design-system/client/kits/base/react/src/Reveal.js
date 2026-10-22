"use client";
import { jsx } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { reveal } from "../../src/reveal.variants.js";
import { initialRevealState, mountReveal, revealDelay } from "../../src/core/reveal.js";
function Reveal({ direction = "up", delay = 0, debug = false, className, children, style, ref, ...rest }) {
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  const [state, setState] = useState(initialRevealState);
  const wait = revealDelay(delay);
  useEffect(() => {
    if (element.current) return mountReveal(element.current, direction, wait, setState);
  }, [direction, wait]);
  return /* @__PURE__ */ jsx(
    "div",
    {
      ...rest,
      ref: element,
      className: reveal({ direction, path: state.path, entered: state.entered, debug, class: className }),
      style: { ...style, "--reveal-delay": `${wait}ms`, "--reveal-x": state.reducedMotion ? "0px" : void 0, "--reveal-y": state.reducedMotion ? "0px" : void 0 },
      "data-reveal": true,
      "data-reveal-path": state.path,
      "data-reveal-motion": state.reducedMotion ? "fade" : "position-and-fade",
      "data-reveal-direction": direction,
      "data-reveal-delay": wait,
      "data-reveal-debug": debug ? "" : void 0,
      "data-reveal-entered": state.entered ? "" : void 0,
      children
    }
  );
}
export {
  Reveal
};

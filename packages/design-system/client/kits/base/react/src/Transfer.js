"use client";
import { jsx } from "react/jsx-runtime";
import { transfer } from "../../src/transfer.variants.js";
import { useEffect, useRef } from "react";
import { transferPresentation } from "../../src/core/operational-motion.js";
function Transfer({
  fromId,
  toId,
  trigger,
  duration = 400,
  paused = false
}) {
  const host = useRef(null), previous = useRef(trigger);
  useEffect(() => {
    const changed = trigger !== previous.current;
    previous.current = trigger;
    if (changed && !paused && host.current)
      return transferPresentation(host.current, fromId, toId, duration);
  }, [trigger, fromId, toId, duration, paused]);
  return /* @__PURE__ */ jsx("span", { ref: host, "data-transfer": true, "aria-hidden": "true", className: transfer() });
}
export {
  Transfer
};

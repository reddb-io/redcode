import { jsx, jsxs } from "react/jsx-runtime";
import { Button, Select, Slider } from "@reddb-io/design-system/base";
import { PLAYBACK_SPEEDS } from "../../src/core/operational.js";
import { operational } from "../../src/operational.variants.js";
function PlaybackControls({
  label,
  playing,
  position,
  duration,
  speed = 1,
  onplayingchange,
  onpositionchange,
  onspeedchange,
  onstep,
  className
}) {
  const s = operational(), end = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const speeds = PLAYBACK_SPEEDS;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "data-playback-controls": true,
      role: "group",
      "aria-label": label,
      className: s.body({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("div", { className: s.actions(), children: [
          /* @__PURE__ */ jsx(
            Button,
            {
              disabled: !onplayingchange || !end,
              onClick: () => onplayingchange?.(!playing),
              children: playing ? "Pause" : "Play"
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              disabled: !onstep || playing || position >= end,
              onClick: () => onstep?.(),
              children: "Next step"
            }
          ),
          /* @__PURE__ */ jsx("div", { className: s.speed(), children: /* @__PURE__ */ jsx(
            Select,
            {
              "aria-label": "Playback speed",
              value: String(speed),
              options: speeds,
              disabled: !onspeedchange,
              onValueChange: (value) => onspeedchange?.(Number(value))
            }
          ) })
        ] }),
        /* @__PURE__ */ jsx(
          Slider,
          {
            fieldClass: s.seek(),
            label: "Replay position",
            value: position,
            min: 0,
            max: Math.max(1, end),
            disabled: !onpositionchange || !end,
            onValueChange: (value) => onpositionchange?.(value),
            formatValue: (value) => `${value} / ${end}`
          }
        )
      ]
    }
  );
}
export {
  PlaybackControls
};

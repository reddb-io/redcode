"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";
import { AudioMeter } from "./AudioMeter.js";
function VoiceInput({ recording, value = 0, label = "Voice input", onRecordingChange, disabled = false, ...rest }) {
  return /* @__PURE__ */ jsxs(Button, { ...rest, disabled, size: "sm", variant: "secondary", "aria-label": label, "aria-pressed": recording, "data-voice-input": true, onClick: () => onRecordingChange?.(!recording), children: [
    /* @__PURE__ */ jsx(Icon, { icon: "mic", size: "sm", color: "current", "aria-hidden": "true" }),
    recording && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: /* @__PURE__ */ jsx(AudioMeter, { value, compact: true }) })
  ] });
}
export {
  VoiceInput
};

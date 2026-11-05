import { jsx, jsxs } from "react/jsx-runtime";
import { audioLevel, audioWaveform } from "../../src/core/audio.js";
import { audioMeter } from "../../src/audio-meter.variants.js";
function AudioMeter({ value, label = "Input level", mode = "level", samples = [], compact = false, className, ...rest }) {
  const level = audioLevel(value);
  const slots = audioMeter({ compact });
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-audio-meter": true, "data-mode": mode, className: slots.root({ class: className }), role: "meter", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(level * 100), "aria-valuetext": `${Math.round(level * 100)}%`, children: [
    !compact && /* @__PURE__ */ jsxs("div", { className: slots.summary(), "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("span", { children: label }),
      /* @__PURE__ */ jsxs("span", { className: slots.value(), children: [
        Math.round(level * 100),
        "%"
      ] })
    ] }),
    mode === "waveform" ? /* @__PURE__ */ jsxs("svg", { className: slots.waveform(), viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("path", { d: "M0 50 H100", fill: "none", stroke: "currentColor", opacity: "0.25", vectorEffect: "non-scaling-stroke" }),
      /* @__PURE__ */ jsx("polyline", { points: audioWaveform(samples), fill: "none", stroke: "currentColor", strokeWidth: "2", vectorEffect: "non-scaling-stroke" })
    ] }) : /* @__PURE__ */ jsx("div", { className: slots.track(), "aria-hidden": "true", children: Array.from({ length: compact ? 6 : 20 }, (_, i) => /* @__PURE__ */ jsx("span", { "data-audio-segment": true, className: slots.segment({ class: level * (compact ? 6 : 20) > i ? i >= (compact ? 5 : 18) ? "bg-feedback-danger-foreground" : i >= (compact ? 4 : 15) ? "bg-feedback-warning-foreground" : "bg-feedback-success-foreground" : "" }) }, i)) })
  ] });
}
export {
  AudioMeter
};

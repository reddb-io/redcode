const TONES = ["neutral", "info", "success", "warning", "danger"];
const FEEDBACK_TONES = ["info", "success", "warning", "danger"];
function isTone(value) {
  return typeof value === "string" && TONES.includes(value);
}
export {
  FEEDBACK_TONES,
  TONES,
  isTone
};

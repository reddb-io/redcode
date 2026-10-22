function feedbackTone(tone, legacy) {
  return tone ?? legacy ?? "neutral";
}
function feedbackAnnouncement(tone) {
  return tone === "danger" ? "alert" : "status";
}
export {
  feedbackAnnouncement,
  feedbackTone
};

function feedbackTone(tone) {
  return tone ?? "neutral";
}
function feedbackAnnouncement(tone) {
  return tone === "danger" ? "alert" : "status";
}
export {
  feedbackAnnouncement,
  feedbackTone
};

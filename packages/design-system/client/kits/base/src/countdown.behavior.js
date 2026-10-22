function normalizeRemaining(remaining) {
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.floor(remaining));
}
function formatDuration(remaining) {
  const seconds = normalizeRemaining(remaining);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  const pair = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pair(minutes)}:${pair(rest)}` : `${minutes}:${pair(rest)}`;
}
function durationAttribute(remaining) {
  const seconds = normalizeRemaining(remaining);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}${rest > 0 || seconds === 0 ? `${rest}S` : ""}`;
}
export {
  durationAttribute,
  formatDuration,
  normalizeRemaining
};

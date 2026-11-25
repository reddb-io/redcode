const PROMPT_COMPOSER_STATUSES = ["idle", "submitting", "streaming"];
function shouldSubmitPrompt(event) {
  if (event.key !== "Enter" || event.shiftKey) return false;
  return !event.isComposing && event.keyCode !== 229;
}
export {
  PROMPT_COMPOSER_STATUSES,
  shouldSubmitPrompt
};

function codeLength(length) {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error("OneTimeCodeInput: length must be a positive integer.");
  return length;
}
function codeCharacters(text, limit) {
  return text.replace(/[^a-zA-Z0-9]/g, "").slice(0, limit).split("");
}
function codeSegments(value, length) {
  return Array.from({ length: codeLength(length) }, (_, index) => value[index] ?? "");
}
const ONE_TIME_CODE_INPUT_MODES = ["none", "text", "decimal", "numeric", "tel", "search", "email", "url"];
export {
  ONE_TIME_CODE_INPUT_MODES,
  codeCharacters,
  codeLength,
  codeSegments
};

const warned = /* @__PURE__ */ new Set();
function warnDeprecated(component, used, instead) {
  if (!import.meta.env?.DEV) return;
  const key = `${component}\0${used}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[reddb ${component}] ${used} is deprecated and is removed in the next release. Use ${instead}.`
  );
}
export {
  warnDeprecated
};

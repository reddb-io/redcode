import { applyAppearance } from "../appearance-switch.behavior.js";
function appearanceValue(options, ...candidates) {
  for (const value of candidates) if (options.some((option) => !option.disabled && option.value === value)) return value;
  return options.find((option) => !option.disabled)?.value;
}
function appearancePersistence(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return void 0;
  }
}
function readAppearance(storage, key) {
  try {
    return storage?.getItem(key) ?? void 0;
  } catch {
    return void 0;
  }
}
function commitAppearance(root, axis, value, storage, key) {
  if (value === void 0) return;
  if (root) applyAppearance(root, axis, value);
  try {
    storage?.setItem(key, value);
  } catch {
  }
}
export {
  appearancePersistence,
  appearanceValue,
  commitAppearance,
  readAppearance
};

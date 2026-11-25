import { warnDeprecated } from "../deprecation.js";
function resolveFieldSize(component, props, fallback = "md") {
  const { controlSize: legacySize } = props;
  let size;
  let htmlSize = props.htmlSize;
  if (typeof props.size === "string") size = props.size;
  else if (typeof props.size === "number") {
    htmlSize ??= props.size;
    warnDeprecated(component, "a numeric size", "htmlSize for the native attribute; size is the sm | md | lg height step");
  }
  if (legacySize !== void 0) {
    size ??= legacySize;
    warnDeprecated(component, "controlSize", "size");
  }
  return { size: size ?? fallback, htmlSize };
}
export {
  resolveFieldSize
};

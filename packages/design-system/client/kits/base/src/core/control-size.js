const CONTROL_SIZES = ["sm", "md", "lg"];
const CONTROL_SIZE_CONTEXT = /* @__PURE__ */ Symbol.for("reddb.control-size");
function resolveControlSize(own, group, fallback = "md") {
  return own ?? group ?? fallback;
}
export {
  CONTROL_SIZES,
  CONTROL_SIZE_CONTEXT,
  resolveControlSize
};

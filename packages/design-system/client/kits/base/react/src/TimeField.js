import { jsx } from "react/jsx-runtime";
import { SegmentField } from "./SegmentField.js";
function TimeField(props) {
  const { value = "", required = false, disabled = false } = props;
  return /* @__PURE__ */ jsx(SegmentField, { ...props, required, disabled, initialValue: value, kind: "time" });
}
export {
  TimeField
};

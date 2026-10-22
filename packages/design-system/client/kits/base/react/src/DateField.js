import { jsx } from "react/jsx-runtime";
import { SegmentField } from "./SegmentField.js";
function DateField(props) {
  const { value = "", required = false, disabled = false } = props;
  return /* @__PURE__ */ jsx(SegmentField, { ...props, required, disabled, initialValue: value, kind: "date" });
}
export {
  DateField
};

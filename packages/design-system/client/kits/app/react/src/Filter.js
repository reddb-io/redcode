import { jsx } from "react/jsx-runtime";
import { ToggleGroup } from "@reddb-io/design-system/base";
import { filter } from "../../src/composites/filter.variants.js";
function Filter(props) {
  const { legend, options, value = "", name, disabled = false, size = "md", className, listClass, optionClass, onValueChange, ...rest } = props;
  const styles = filter();
  return /* @__PURE__ */ jsx(ToggleGroup, { ...rest, legend, options, value: props.value, name, disabled, size, "data-filter": true, className: styles.root({ class: className }), overflow: "wrap", listClass: styles.list({ class: listClass }), optionClass, onValueChange });
}
export {
  Filter
};

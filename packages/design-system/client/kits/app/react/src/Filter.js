import { jsx } from "react/jsx-runtime";
import { ToggleGroup } from "@reddb-io/design-system/base";
import { filter } from "../../src/composites/filter.variants.js";
function Filter(props) {
  const { legend, options, value = "", name, disabled = false, className, listClass, optionClass, onValueChange, ...rest } = props;
  const styles = filter();
  return /* @__PURE__ */ jsx(ToggleGroup, { ...rest, legend, options, value: props.value, name, disabled, "data-filter": true, className: styles.root({ class: className }), listClass: styles.list({ class: listClass }), optionClass, onValueChange });
}
export {
  Filter
};

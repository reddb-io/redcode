import { jsx } from "react/jsx-runtime";
import { form } from "../../src/form.variants.js";
function Form({ className, ...rest }) {
  return /* @__PURE__ */ jsx("form", { ...rest, className: form({ class: className }) });
}
export {
  Form
};

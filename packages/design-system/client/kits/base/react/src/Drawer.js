import { jsx } from "react/jsx-runtime";
import { Dialog } from "./Dialog.js";
import { drawer } from "../../src/drawer.variants.js";
function Drawer(props) {
  const { side = "right", open = false, className, ...rest } = props;
  return /* @__PURE__ */ jsx(Dialog, { ...rest, open: props.open, "data-drawer": "", className: drawer({ side, class: className }) });
}
export {
  Drawer
};

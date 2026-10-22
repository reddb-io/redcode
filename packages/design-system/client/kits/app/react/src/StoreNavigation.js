import { jsx, jsxs } from "react/jsx-runtime";
import { Navbar } from "@reddb-io/design-system/base";
import { navigationItems } from "../../src/composites/navigation.behavior.js";
import { storeNavigation } from "../../src/composites/store-navigation.variants.js";
function StoreNavigation({ label, items, currentId, collapse = "responsive", announcement, brand, actions, className, ...rest }) {
  const styles = storeNavigation(), links = navigationItems(items, currentId).map((item) => ({ id: item.id, label: item.label, href: item.href, current: item.current, disabled: item.disabled, onselect: item.onselect }));
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-store-navigation": "", className: styles.root({ class: className }), children: [
    announcement && /* @__PURE__ */ jsx("div", { "data-store-announcement": "", className: styles.announcement(), children: announcement }),
    /* @__PURE__ */ jsx(Navbar, { label, links, collapse, brand, actions, className: styles.navbar() })
  ] });
}
export {
  StoreNavigation
};

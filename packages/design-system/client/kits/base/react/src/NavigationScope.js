"use client";
import { jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from "react";
import { routableAnchor } from "../../src/core/navigation.js";
const NavigationContext = createContext(void 0);
function useNavigation() {
  return useContext(NavigationContext);
}
function NavigationScope({ navigate, resolve, owns, children }) {
  const [active, setActive] = useState(false);
  useEffect(() => setActive(true), []);
  return /* @__PURE__ */ jsx(NavigationContext, { value: { navigate, resolve, owns }, children: /* @__PURE__ */ jsx("div", { "data-navigation-scope": true, "data-navigation-active": active ? "" : void 0, className: "contents", onClick: (event) => {
    const anchor = routableAnchor(event.nativeEvent, event.currentTarget, owns);
    if (!anchor) return;
    event.preventDefault();
    navigate(anchor.getAttribute("href"), event.nativeEvent);
  }, children }) });
}
export {
  NavigationContext,
  NavigationScope,
  useNavigation
};

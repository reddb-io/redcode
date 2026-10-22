"use client";
import { createContext, useContext, useEffect, useRef } from "react";
import { createNavigationDisclosures as createNavigationDisclosures2 } from "../../src/core/navigation-disclosures.js";
const NavigationDisclosureContext = createContext(void 0);
function useNavigationDisclosure(open, close) {
  const coordinator = useContext(NavigationDisclosureContext), latest = useRef(close);
  latest.current = close;
  const registration = useRef(void 0);
  useEffect(() => {
    registration.current = coordinator?.register(() => latest.current());
    return () => {
      registration.current?.destroy();
      registration.current = void 0;
    };
  }, [coordinator]);
  useEffect(() => {
    if (open) registration.current?.open();
  }, [coordinator, open]);
}
export {
  NavigationDisclosureContext,
  createNavigationDisclosures2 as createNavigationDisclosures,
  useNavigationDisclosure
};

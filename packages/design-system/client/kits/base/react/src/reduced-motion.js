"use client";
import { useEffect, useState } from "react";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  const [current, setCurrent] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!media) return;
    const update = () => setCurrent(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return { current };
}
export {
  REDUCED_MOTION_QUERY,
  useReducedMotion
};

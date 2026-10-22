"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.js";
import { Image } from "./Image.js";
import { carousel } from "../../src/carousel.variants.js";
function Carousel({ label, slides, viewport, initialIndex = 0, autoplay = false, interval = 5e3, onValueChange, priority = false, className, viewportClass, slideClass, controlsClass, ...rest }) {
  const [requested, setRequested] = useState(() => Math.max(0, Math.trunc(initialIndex) || 0)), [rotating, setRotating] = useState(autoplay && slides.length > 1), [reduced, setReduced] = useState(true);
  const active = Math.max(0, Math.min(requested, slides.length - 1)), firstIndex = useRef(active).current, playing = rotating && !reduced, styles = carousel();
  const latest = useRef({ active, onValueChange });
  latest.current = { active, onValueChange };
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      setReduced(false);
      return;
    }
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const select = (index) => {
    if (!slides.length) return;
    const next = (index + slides.length) % slides.length;
    setRequested(next);
    latest.current.onValueChange?.(next);
  };
  useEffect(() => {
    if (!playing || slides.length < 2) return;
    const timer = setInterval(() => select(latest.current.active + 1), Math.max(1, interval));
    return () => clearInterval(timer);
  }, [playing, slides.length, interval]);
  const pause = (target) => {
    if (autoplay && !(target instanceof Element && target.closest("[data-carousel-rotation]"))) setRotating(false);
  };
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-carousel": true, role: "region", "aria-roledescription": "carousel", "aria-label": label, className: styles.root({ class: className }), onFocus: (event) => {
    rest.onFocus?.(event);
    pause(event.target);
  }, onMouseEnter: (event) => {
    rest.onMouseEnter?.(event);
    pause(event.target);
  }, children: [
    /* @__PURE__ */ jsx("div", { "data-carousel-viewport": true, "aria-live": playing ? "off" : "polite", className: styles.viewport({ class: viewportClass }), children: viewport ? viewport({ slides, active, playing, firstIndex }) : slides.map((slide, index) => /* @__PURE__ */ jsx("div", { "data-carousel-slide": true, role: "group", "aria-roledescription": "slide", "aria-label": `${index + 1} of ${slides.length} \u2014 ${slide.label}`, hidden: index !== active, className: styles.slide({ class: slideClass }), children: slide.content ?? (slide.image && /* @__PURE__ */ jsx(Image, { ...slide.image, priority: priority && index === firstIndex, className: "w-full" })) }, index)) }),
    /* @__PURE__ */ jsxs("div", { "data-carousel-controls": true, className: styles.controls({ class: controlsClass }), children: [
      /* @__PURE__ */ jsx(Button, { variant: "secondary", size: "sm", "aria-label": "Previous slide", disabled: slides.length < 2, onClick: () => select(active - 1), children: "Previous" }),
      /* @__PURE__ */ jsx("span", { "data-carousel-position": true, "aria-live": "off", className: styles.position(), children: slides.length ? `${active + 1} of ${slides.length}` : "0 of 0" }),
      /* @__PURE__ */ jsx(Button, { variant: "secondary", size: "sm", "aria-label": "Next slide", disabled: slides.length < 2, onClick: () => select(active + 1), children: "Next" }),
      autoplay && /* @__PURE__ */ jsx(Button, { "data-carousel-rotation": true, variant: "secondary", size: "sm", "aria-label": playing ? "Pause slide rotation" : "Resume slide rotation", "aria-pressed": playing, className: styles.rotation(), disabled: slides.length < 2 || reduced, onClick: () => setRotating(!rotating), children: playing ? "Pause" : "Resume" })
    ] })
  ] });
}
export {
  Carousel
};

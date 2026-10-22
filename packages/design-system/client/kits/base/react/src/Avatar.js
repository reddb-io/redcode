"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { avatar } from "../../src/avatar.variants.js";
import { avatarImageFailed, avatarImageVisible } from "../../src/core/avatar.js";
function Avatar({ src, name, icon, fallback, size = "md", className, imageClass, fallbackClass, ...rest }) {
  const [request, setRequest] = useState({ src, failed: false });
  if (request.src !== src) setRequest({ src, failed: false });
  const failedSrc = request.src === src && request.failed ? src : void 0;
  const image = useRef(null);
  useEffect(() => {
    if (avatarImageFailed(image.current)) setRequest({ src, failed: true });
  }, [src]);
  const styles = avatar({ size });
  return /* @__PURE__ */ jsxs("span", { ...rest, "data-avatar": true, role: "img", "aria-label": name, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("span", { "data-avatar-fallback": true, "aria-hidden": "true", className: styles.fallback({ class: fallbackClass }), children: icon !== void 0 ? /* @__PURE__ */ jsx(Icon, { icon, size, "aria-hidden": "true", "data-avatar-icon": true }) : fallback }),
    avatarImageVisible(src, failedSrc) && /* @__PURE__ */ jsx("img", { ref: image, "data-avatar-image": true, src, alt: "", "aria-hidden": "true", style: { aspectRatio: "1 / 1" }, className: styles.image({ class: imageClass }), onError: () => setRequest({ src, failed: true }) }, src)
  ] });
}
export {
  Avatar
};

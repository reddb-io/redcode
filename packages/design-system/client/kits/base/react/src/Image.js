import { jsx, jsxs } from "react/jsx-runtime";
import { assertImageContract, image, imageRatio } from "../../src/image.variants.js";
function Image({ src, alt, decorative = false, width, height, ratio, srcset, sizes, sources = [], priority = false, loading, fit = "cover", position = "center", className, ...rest }) {
  assertImageContract({ alt, decorative, width, height, ratio });
  const img = /* @__PURE__ */ jsx(
    "img",
    {
      ...rest,
      src,
      alt: decorative ? "" : alt,
      width,
      height,
      srcSet: srcset,
      sizes,
      loading: loading ?? (priority ? "eager" : "lazy"),
      decoding: priority ? "sync" : "async",
      fetchPriority: priority ? "high" : void 0,
      style: { aspectRatio: String(imageRatio({ width, height, ratio })) },
      "data-image": true,
      "data-image-priority": priority || void 0,
      className: image({ fit, position, class: className })
    }
  );
  return sources.length ? /* @__PURE__ */ jsxs("picture", { "data-image-picture": true, className: "contents", children: [
    sources.map((source) => /* @__PURE__ */ jsx("source", { srcSet: source.srcset, type: source.type, media: source.media, sizes: source.sizes ?? sizes }, source.srcset)),
    img
  ] }) : img;
}
export {
  Image
};

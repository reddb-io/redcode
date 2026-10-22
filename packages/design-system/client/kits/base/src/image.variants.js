import { tv } from "tailwind-variants";
const image = tv({
  base: "block h-auto max-w-full",
  variants: {
    /** How the picture fills the box its dimensions or ratio reserve. */
    fit: {
      cover: "object-cover",
      contain: "object-contain"
    },
    /** The focal point kept in frame when `cover` crops. */
    position: {
      center: "object-center",
      top: "object-top",
      bottom: "object-bottom",
      start: "object-left",
      end: "object-right"
    }
  },
  defaultVariants: { fit: "cover", position: "center" }
});
const IMAGE_FITS = ["cover", "contain"];
const IMAGE_POSITIONS = [
  "center",
  "top",
  "bottom",
  "start",
  "end"
];
function assertImageContract(asset) {
  if (asset.decorative) {
    if (asset.alt) {
      throw new Error(
        `Image: a decorative image renders alt="", so its alt ${JSON.stringify(asset.alt)} would be dropped; drop decorative or the alt.`
      );
    }
  } else if (typeof asset.alt !== "string" || asset.alt.trim() === "") {
    throw new Error(
      'Image: alt is required; pass decorative to mean the image carries no information (alt="").'
    );
  }
  const sized = isPositive(asset.width) && isPositive(asset.height);
  if (!sized && !isPositive(asset.ratio)) {
    throw new Error(
      "Image: pass width and height (the intrinsic size) or ratio, so the image reserves its box before it loads."
    );
  }
}
function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function imageRatio(asset) {
  if (isPositive(asset.ratio)) return asset.ratio;
  return asset.width / asset.height;
}
export {
  IMAGE_FITS,
  IMAGE_POSITIONS,
  assertImageContract,
  image,
  imageRatio
};

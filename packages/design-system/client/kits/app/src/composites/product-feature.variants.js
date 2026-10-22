import { mediaObject } from "@reddb-io/design-system/base/recipes";
import { tv } from "tailwind-variants";
const ROOT = mediaObject({ gap: "lg" }).root({
  class: "@container/product-feature w-full flex-wrap gap-[var(--reddb-spatial-layout-gap-md)]"
});
const REGION = "min-w-0 grow basis-full @3xl/product-feature:basis-0";
const productFeature = tv({
  slots: {
    root: ROOT,
    media: `${REGION} overflow-hidden rounded-lg bg-muted`,
    content: REGION,
    heading: "items-start pb-0",
    body: "flex flex-col gap-[var(--reddb-spatial-gap-md)] text-foreground",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-md)]"
  },
  variants: {
    mediaSide: {
      start: {},
      end: { media: "order-last" }
    }
  },
  defaultVariants: { mediaSide: "start" }
});
const PRODUCT_FEATURE_MEDIA_SIDES = ["start", "end"];
export {
  PRODUCT_FEATURE_MEDIA_SIDES,
  productFeature
};

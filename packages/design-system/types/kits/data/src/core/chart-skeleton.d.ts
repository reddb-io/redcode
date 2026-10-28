import type { SkeletonShape } from "@reddb-io/design-system/base/recipes";
import type { CompositeModel } from "./composite-chart";
/** Match the pending drawing without importing its rendering engine. */
export declare function compositeSkeletonShape(model: CompositeModel, orientation: "horizontal" | "vertical"): SkeletonShape;

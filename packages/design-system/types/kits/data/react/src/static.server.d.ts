/** Server/build-only entry. Import the chosen component separately. */
import { type ComponentType } from "react";
/** Render trusted figure HTML without hydration or a visualization registry. */
export declare function renderStaticVisualization<Props extends {
    interactive?: boolean;
}>(component: ComponentType<Props>, props: Props): string;

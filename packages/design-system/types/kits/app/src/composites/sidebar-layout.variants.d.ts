import { type VariantProps } from "tailwind-variants";
export declare const sidebarLayout: import("tailwind-variants").TVReturnType<{
    side: {
        readonly start: {
            readonly sidebar: "";
            readonly content: "";
        };
        readonly end: {
            readonly sidebar: "";
            readonly content: "";
        };
    };
    rail: {
        false: {
            root: string;
        };
        true: {
            root: string;
            panel: string;
        };
    };
    railOpen: {
        false: {
            railRegion: string;
        };
        true: {};
    };
    panelOpen: {
        false: {
            panel: string;
        };
        true: {
            panel: string;
        };
    };
}, {
    root: string;
    region: string;
    sidebar: string;
    content: string;
    railRegion: string;
    panel: string;
    main: string;
}, undefined, {
    side: {
        readonly start: {
            readonly sidebar: "";
            readonly content: "";
        };
        readonly end: {
            readonly sidebar: "";
            readonly content: "";
        };
    };
    rail: {
        false: {
            root: string;
        };
        true: {
            root: string;
            panel: string;
        };
    };
    railOpen: {
        false: {
            railRegion: string;
        };
        true: {};
    };
    panelOpen: {
        false: {
            panel: string;
        };
        true: {
            panel: string;
        };
    };
}, {
    root: string;
    region: string;
    sidebar: string;
    content: string;
    railRegion: string;
    panel: string;
    main: string;
}, import("tailwind-variants").TVReturnType<{
    side: {
        readonly start: {
            readonly sidebar: "";
            readonly content: "";
        };
        readonly end: {
            readonly sidebar: "";
            readonly content: "";
        };
    };
    rail: {
        false: {
            root: string;
        };
        true: {
            root: string;
            panel: string;
        };
    };
    railOpen: {
        false: {
            railRegion: string;
        };
        true: {};
    };
    panelOpen: {
        false: {
            panel: string;
        };
        true: {
            panel: string;
        };
    };
}, {
    root: string;
    region: string;
    sidebar: string;
    content: string;
    railRegion: string;
    panel: string;
    main: string;
}, undefined, unknown, unknown, undefined>>;
export type SidebarLayoutVariants = VariantProps<typeof sidebarLayout>;
export type SidebarSide = NonNullable<SidebarLayoutVariants["side"]>;
export declare const SIDEBAR_SIDES: readonly SidebarSide[];
/** Page navigation uses one item model for a desktop rail and a mobile bottom bar. */
export declare const responsiveNavigationLayout: import("tailwind-variants").TVReturnType<{
    header: {
        true: {
            root: string;
        };
        false: {
            root: string;
        };
    };
    dockable: {
        true: {};
        false: {
            root: string;
            rail: string;
        };
    };
    panel: {
        true: {
            root: string;
        };
        false: {};
    };
    side: {
        start: {};
        end: {};
    };
}, {
    root: string;
    header: string;
    rail: string;
    panel: string;
    main: string;
    bottom: string;
    more: string;
    drawer: string;
    menu: string;
}, undefined, {
    header: {
        true: {
            root: string;
        };
        false: {
            root: string;
        };
    };
    dockable: {
        true: {};
        false: {
            root: string;
            rail: string;
        };
    };
    panel: {
        true: {
            root: string;
        };
        false: {};
    };
    side: {
        start: {};
        end: {};
    };
}, {
    root: string;
    header: string;
    rail: string;
    panel: string;
    main: string;
    bottom: string;
    more: string;
    drawer: string;
    menu: string;
}, import("tailwind-variants").TVReturnType<{
    header: {
        true: {
            root: string;
        };
        false: {
            root: string;
        };
    };
    dockable: {
        true: {};
        false: {
            root: string;
            rail: string;
        };
    };
    panel: {
        true: {
            root: string;
        };
        false: {};
    };
    side: {
        start: {};
        end: {};
    };
}, {
    root: string;
    header: string;
    rail: string;
    panel: string;
    main: string;
    bottom: string;
    more: string;
    drawer: string;
    menu: string;
}, undefined, unknown, unknown, undefined>>;

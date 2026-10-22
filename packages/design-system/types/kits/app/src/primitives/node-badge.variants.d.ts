import { type VariantProps } from "tailwind-variants";
/** What each reachability reading means, as a tone (ADR 0026). */
export declare const NODE_STATUS_TONES: {
    /** Reachable, and keeping up. */
    readonly online: "success";
    /** Reachable, and behind — lagging, rebalancing, or under pressure. */
    readonly degraded: "warning";
    /** Known to the cluster, and not answering. */
    readonly offline: "danger";
    /** The default: no reading yet. */
    readonly unknown: "neutral";
};
export declare const nodeBadge: import("tailwind-variants").TVReturnType<{
    status: {
        readonly online: {
            readonly dot: "border-[var(--reddb-color-feedback-success-border)] bg-[var(--reddb-color-feedback-success-foreground)]";
        };
        readonly degraded: {
            readonly dot: "border-[var(--reddb-color-feedback-warning-border)] bg-[var(--reddb-color-feedback-warning-foreground)]";
        };
        readonly offline: {
            readonly dot: "border-[var(--reddb-color-feedback-danger-border)] bg-[var(--reddb-color-feedback-danger-foreground)]";
        };
        readonly unknown: {
            readonly dot: "border-control-edge bg-transparent";
        };
    };
    labelled: {
        /** The default: the status word is drawn next to the node's name. */
        readonly true: {
            readonly status: "text-ink-muted";
        };
        /** Announced, never drawn — for a dense cluster list. */
        readonly false: {
            readonly status: "sr-only";
        };
    };
}, {
    root: string;
    dot: string;
    name: string;
    status: string;
}, undefined, {
    status: {
        readonly online: {
            readonly dot: "border-[var(--reddb-color-feedback-success-border)] bg-[var(--reddb-color-feedback-success-foreground)]";
        };
        readonly degraded: {
            readonly dot: "border-[var(--reddb-color-feedback-warning-border)] bg-[var(--reddb-color-feedback-warning-foreground)]";
        };
        readonly offline: {
            readonly dot: "border-[var(--reddb-color-feedback-danger-border)] bg-[var(--reddb-color-feedback-danger-foreground)]";
        };
        readonly unknown: {
            readonly dot: "border-control-edge bg-transparent";
        };
    };
    labelled: {
        /** The default: the status word is drawn next to the node's name. */
        readonly true: {
            readonly status: "text-ink-muted";
        };
        /** Announced, never drawn — for a dense cluster list. */
        readonly false: {
            readonly status: "sr-only";
        };
    };
}, {
    root: string;
    dot: string;
    name: string;
    status: string;
}, import("tailwind-variants").TVReturnType<{
    status: {
        readonly online: {
            readonly dot: "border-[var(--reddb-color-feedback-success-border)] bg-[var(--reddb-color-feedback-success-foreground)]";
        };
        readonly degraded: {
            readonly dot: "border-[var(--reddb-color-feedback-warning-border)] bg-[var(--reddb-color-feedback-warning-foreground)]";
        };
        readonly offline: {
            readonly dot: "border-[var(--reddb-color-feedback-danger-border)] bg-[var(--reddb-color-feedback-danger-foreground)]";
        };
        readonly unknown: {
            readonly dot: "border-control-edge bg-transparent";
        };
    };
    labelled: {
        /** The default: the status word is drawn next to the node's name. */
        readonly true: {
            readonly status: "text-ink-muted";
        };
        /** Announced, never drawn — for a dense cluster list. */
        readonly false: {
            readonly status: "sr-only";
        };
    };
}, {
    root: string;
    dot: string;
    name: string;
    status: string;
}, undefined, unknown, unknown, undefined>>;
export type NodeBadgeVariants = VariantProps<typeof nodeBadge>;
export type NodeStatus = NonNullable<NodeBadgeVariants["status"]>;
export declare const NODE_STATUSES: readonly NodeStatus[];

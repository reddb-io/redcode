import { tv } from "tailwind-variants";
const NODE_STATUS_TONES = {
  /** Reachable, and keeping up. */
  online: "success",
  /** Reachable, and behind — lagging, rebalancing, or under pressure. */
  degraded: "warning",
  /** Known to the cluster, and not answering. */
  offline: "danger",
  /** The default: no reading yet. */
  unknown: "neutral"
};
const MARK = {
  neutral: "border-control-edge bg-ink-muted",
  info: "border-[var(--reddb-color-feedback-info-border)] bg-[var(--reddb-color-feedback-info-foreground)]",
  success: "border-[var(--reddb-color-feedback-success-border)] bg-[var(--reddb-color-feedback-success-foreground)]",
  warning: "border-[var(--reddb-color-feedback-warning-border)] bg-[var(--reddb-color-feedback-warning-foreground)]",
  danger: "border-[var(--reddb-color-feedback-danger-border)] bg-[var(--reddb-color-feedback-danger-foreground)]"
};
const STATUS = {
  online: { dot: MARK[NODE_STATUS_TONES.online] },
  degraded: { dot: MARK[NODE_STATUS_TONES.degraded] },
  offline: { dot: MARK[NODE_STATUS_TONES.offline] },
  // Hollow: no reading is drawn as an empty mark, not a grey fill.
  unknown: { dot: "border-control-edge bg-transparent" }
};
const LABELLED = {
  /** The default: the status word is drawn next to the node's name. */
  true: { status: "text-ink-muted" },
  /** Announced, never drawn — for a dense cluster list. */
  false: { status: "sr-only" }
};
const nodeBadge = tv({
  slots: {
    root: "inline-flex items-center gap-[var(--reddb-spatial-gap-md)] rounded-full border border-muted px-2.5 py-1 text-xs leading-tight whitespace-nowrap",
    dot: "size-2 shrink-0 rounded-full border",
    name: "font-mono text-foreground",
    status: ""
  },
  variants: { status: STATUS, labelled: LABELLED },
  defaultVariants: { status: "unknown", labelled: true }
});
const NODE_STATUSES = Object.keys(STATUS);
export {
  NODE_STATUSES,
  NODE_STATUS_TONES,
  nodeBadge
};

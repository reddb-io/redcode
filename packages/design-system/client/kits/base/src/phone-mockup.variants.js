import { tv } from "tailwind-variants";
const DEFAULT_PHONE_MOCKUP_RATIO = 9 / 16;
const phoneMockup = tv({
  slots: {
    root: "mx-auto w-full max-w-sm rounded-2xl border border-muted bg-background p-[var(--reddb-spatial-inset-sm)] text-foreground shadow-lg",
    chrome: "flex h-[var(--reddb-spatial-control-height-sm)] items-center justify-center",
    speaker: "h-1 w-12 rounded-full bg-muted",
    viewport: "rounded-2xl border border-muted bg-background"
  }
});
export {
  DEFAULT_PHONE_MOCKUP_RATIO,
  phoneMockup
};

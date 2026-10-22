import { tv } from "tailwind-variants";
const codeBlock = tv({
  slots: {
    // The root does not clip: an overflowing pre draws the canonical focus
    // ring 2px outside itself (wave 5A), and clipping would cut it off.
    root: "min-w-0 [contain:inline-size] rounded-lg border border-muted bg-transparent text-foreground",
    toolbar: "flex items-center justify-between gap-[var(--reddb-spatial-gap-md)] border-b border-muted px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)]",
    language: "min-w-0 truncate text-sm text-ink-muted",
    // Its own panel is the root: the pre states no edge or ground, so a
    // document around it (Prose) cannot add a second one.
    // While it overflows it is a focusable region (wave 5A) with the ink ring.
    // Its bottom corners follow the panel's, so its scrollbar stays inside.
    pre: [
      "m-0 overflow-x-auto rounded-t-none rounded-b-lg border-0 bg-transparent p-[var(--reddb-spatial-inset-md)]",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    ].join(" "),
    code: "block whitespace-pre font-mono text-sm leading-relaxed text-foreground"
  }
});
const CODE_TOKEN_CLASSES = {
  keyword: "text-primary-text",
  string: "text-[var(--reddb-color-feedback-success-foreground)]",
  number: "text-[var(--reddb-color-feedback-info-foreground)]",
  comment: "text-ink-muted italic"
};
function codeTokens(code, tokenizer) {
  if (!tokenizer) return [{ kind: "text", value: code }];
  const tokens = tokenizer.tokenize(code);
  return tokens.map((token) => token.value).join("") === code ? tokens : [{ kind: "text", value: code }];
}
export {
  CODE_TOKEN_CLASSES,
  codeBlock,
  codeTokens
};

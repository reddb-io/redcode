import { tv } from "tailwind-variants";
const glyphLabel = tv({
  base: "inline-flex min-w-0 items-center gap-[var(--reddb-glyph-gap)]",
  variants: {
    role: {
      display: "[--reddb-glyph-size:var(--reddb-type-display-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-display-glyph-gap)]",
      title: "[--reddb-glyph-size:var(--reddb-type-title-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-title-glyph-gap)]",
      heading: "[--reddb-glyph-size:var(--reddb-type-heading-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-heading-glyph-gap)]",
      body: "[--reddb-glyph-size:var(--reddb-type-body-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-body-glyph-gap)]",
      label: "[--reddb-glyph-size:var(--reddb-type-label-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-label-glyph-gap)]",
      code: "[--reddb-glyph-size:var(--reddb-type-code-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-code-glyph-gap)]",
      caption: "[--reddb-glyph-size:var(--reddb-type-caption-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-caption-glyph-gap)]",
      eyebrow: "[--reddb-glyph-size:var(--reddb-type-eyebrow-glyph-size)] [--reddb-glyph-gap:var(--reddb-type-eyebrow-glyph-gap)]"
    }
  },
  defaultVariants: { role: "label" }
});
const GLYPH_ROLES = ["display", "title", "heading", "body", "label", "code", "caption", "eyebrow"];
export {
  GLYPH_ROLES,
  glyphLabel
};

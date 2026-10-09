<!--
  The canonical application frame: keyboard bypass, optional product chrome,
  and one focusable main landmark. Container and Stack remain the Base Kit's
  contracts; this Composite only puts them in the application-specific order.
-->
<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { Container, SkipLink, Stack } from "@reddb-io/design-system/base";
  import { applicationShell } from "./application-shell.variants";
  import { claimMainLandmark, mainLandmarkOwned } from "./main-landmark";

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "class"> {
    /** The id shared by the keyboard bypass and the main landmark. */
    mainId?: string;
    /** Product-wide chrome before the page content. */
    header?: Snippet;
    /** Page content; its arrangement and business language stay caller-owned. */
    children?: Snippet;
    /** Product-wide status or legal chrome after the page content. */
    footer?: Snippet;
    /** Let application layouts consume the viewport edge instead of the prose measure. */
    fullWidth?: boolean;
    /**
     * The shell is embedded in a host document that already owns the page's
     * `<main>` (a preview, a documentation frame). Its main region stays the
     * focusable skip-link target but is not a second `main` landmark. Defaults
     * to `true` inside another ApplicationShell, which owns `<main>`, and to
     * `false` everywhere else.
     */
    embedded?: boolean;
    /** Extra classes merged onto the application frame. */
    class?: string;
  }

  let {
    mainId = "main-content",
    header,
    children,
    footer,
    fullWidth = false,
    embedded,
    class: className,
    ...rest
  }: Props = $props();

  // ApplicationShell owns the page's one `<main>` (DESIGN.md, "Landmarks").
  // A shell nested in another one is embedded unless the caller says not. The
  // context records a `<main>` actually rendered, so an embedded shell (its
  // host places `<main>` itself, maybe below it) claims nothing.
  const nested = mainLandmarkOwned();
  const rendersMain = $derived(!(embedded ?? nested));
  if (!(untrack(() => embedded) ?? nested)) claimMainLandmark();

  const slots = $derived(applicationShell());
  // Full width is the Container's own `full` size (ADR 0021); the shell only
  // drops the inline inset, so an application layout reaches the edge.
  const containerSize = $derived(fullWidth ? "full" : "wide");
  const containerClass = $derived(fullWidth ? "px-0" : undefined);
</script>

<div
  {...(rest as Record<string, unknown>)}
  data-application-shell
  class={slots.root({ class: className })}
>
  <SkipLink href={`#${mainId}`} />

  {#if header}
    <header class={slots.header()} data-application-shell-region="header">
      <Container size={containerSize} class={slots.headerContainer({ class: containerClass })}>
        {@render header()}
      </Container>
    </header>
  {/if}

  {#snippet region()}
    <Container
      size={containerSize}
      class={slots.mainContainer({
        class: fullWidth ? "h-full min-h-0 px-0 py-0" : undefined,
      })}
    >
      <Stack class={fullWidth ? "h-full min-h-0" : undefined}>{@render children?.()}</Stack>
    </Container>
  {/snippet}

  <!-- Two static elements, never `<svelte:element>`: before Svelte 5.57.2 a
       dynamic element is detached and re-inserted while it hydrates, and the
       browser then repaints the whole region — the page's Largest Contentful
       Paint included — only once the JavaScript has run. -->
  {#if !rendersMain}
    <div id={mainId} tabindex="-1" class={slots.main()} data-application-shell-region="main">
      {@render region()}
    </div>
  {:else}
    <main id={mainId} tabindex="-1" class={slots.main()} data-application-shell-region="main">
      {@render region()}
    </main>
  {/if}

  {#if footer}
    <footer class={slots.footer()} data-application-shell-region="footer">
      <Container
        size={containerSize}
        class={slots.footerContainer({ class: containerClass })}
      >{@render footer()}</Container>
    </footer>
  {/if}
</div>

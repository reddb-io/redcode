<!-- Preformatted source with a canonical Button copy affordance. -->
<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import Button from "./Button.svelte";
  import {
    CODE_TOKEN_CLASSES,
    codeBlock,
    codeTokens,
    type CodeTokenizer,
  } from "./code-block.variants";

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "class"> {
    /** Exact source shown and copied; whitespace is never normalised. */
    code: string;
    /** Optional human-readable language label. */
    language?: string;
    /**
     * A synchronous tokenizer (a Data Kit `CodeFieldGrammar` fits) that highlights the code into
     * token spans during render — on the server too, so the prerendered HTML is already highlighted.
     * Omitted, the code renders as plain text.
     */
    grammar?: CodeTokenizer;
    /** Accessible and visible copy labels. */
    copyLabel?: string;
    /** Label shown and announced after the code is copied. Defaults to `Copied`. */
    copiedLabel?: string;
    /**
     * Accessible name of the scrolling code region, announced when a keyboard user tabs into a
     * block too wide to show at once. Defaults to `<language> code`, or `Code sample` without one.
     */
    regionLabel?: string;
    /** Extra classes merged onto the code block root. */
    class?: string;
  }

  const {
    code,
    language,
    grammar,
    copyLabel = "Copy code",
    copiedLabel = "Copied",
    regionLabel,
    class: className,
    ...rest
  }: Props = $props();

  let copied = $state(false);
  const slots = $derived(codeBlock());
  const tokens = $derived(codeTokens(code, grammar));

  // A block wider than its column scrolls, and a keyboard user can only scroll
  // what they can focus (WCAG 2.1.1). The <pre> becomes a named, focusable
  // region only while it overflows, so a block that fits adds no tab stop. The
  // server renders the fitting state and the measurement runs after hydration,
  // so the markup never mismatches.
  let pre = $state<HTMLPreElement>();
  let overflowing = $state(false);
  const name = $derived(regionLabel ?? (language ? `${language} code` : "Code sample"));

  $effect(() => {
    const element = pre;
    if (!element) return;
    const measure = () => {
      overflowing = element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  async function copyCode(): Promise<void> {
    await navigator.clipboard.writeText(code);
    copied = true;
  }
</script>

<div {...rest} data-code-block class={slots.root({ class: className })}>
  <div class={slots.toolbar()}>
    {#if language}
      <span data-code-block-language class={slots.language()}>{language}</span>
    {:else}
      <span aria-hidden="true"></span>
    {/if}
    <Button
      data-code-block-copy
      variant="secondary"
      size="sm"
      aria-label={copied ? copiedLabel : copyLabel}
      onclick={copyCode}
    >
      <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
    </Button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (an overflowing block is a named region that must be keyboard-scrollable) -->
  <pre
    bind:this={pre}
    class={slots.pre()}
    tabindex={overflowing ? 0 : undefined}
    role={overflowing ? "region" : undefined}
    aria-label={overflowing ? name : undefined}
    data-code-block-overflowing={overflowing ? "true" : undefined}><code class={slots.code()}>{#if grammar}{#each tokens as token, index (index)}<span data-code-token={token.kind} class={CODE_TOKEN_CLASSES[token.kind]}>{token.value}</span>{/each}{:else}{code}{/if}</code></pre>
</div>

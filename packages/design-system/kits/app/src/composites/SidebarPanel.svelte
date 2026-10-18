<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { Badge, Button, ScrollArea, StatusIndicator, type Tone } from "@reddb-io/design-system/base";
  import { navigationBadge, navigationMarkerLabel, type NavigationStatus } from "./navigation.behavior";
  import { sidebarPanel } from "./sidebar-panel.variants";

  interface Props extends Omit<HTMLAttributes<HTMLElement>, "class" | "title" | "children"> {
    /** Visible panel heading and accessible region name. */
    title: string;
    /** Optional header notification count or short text. Numeric counts above 99 display 99+ while retaining the exact accessible count. */
    badge?: number | string;
    /** Complete accessible notification description. */
    badgeLabel?: string;
    /** Semantic notification tone. Defaults to neutral. */
    badgeTone?: Tone;
    /** Application-owned presence or health shown beside the heading. */
    status?: NavigationStatus;
    /** Heading outline depth, independent of its compact visual size. */
    headingLevel?: 2 | 3 | 4 | 5 | 6;
    /** Optional contextual back destination. No back control is rendered without it. */
    backHref?: string;
    /** Visible name for the contextual back link. */
    backLabel?: string;
    /** Optional close action. No close control is rendered without it. A custom toolbar replaces it. */
    ondismiss?: () => void;
    /** Replaces the complete contextual toolbar, including built-in Back and Close controls. */
    toolbar?: Snippet;
    /** Header actions, such as New conversation or an overflow menu. */
    actions?: Snippet;
    /** Search, filters or other controls below the heading, outside the scrolling body. */
    controls?: Snippet;
    /** Caller-owned links, rich rows and labelled groups. */
    children?: Snippet;
    /** Optional persistent account or supporting content below the scrolling body. */
    footer?: Snippet;
    /** Extra classes merged onto the panel, including its application-owned height constraint. */
    class?: string;
  }
  let { title, badge, badgeLabel, badgeTone = "neutral", status, headingLevel = 2, backHref, backLabel = "Back", ondismiss, toolbar, actions, controls, children, footer, class: className, ...rest }: Props = $props();
  const styles = sidebarPanel();
</script>

<section {...rest} data-sidebar-panel aria-label={navigationMarkerLabel({ badge, badgeLabel, status }, title)} class={styles.root({ class: className })}>
  {#if toolbar || backHref || ondismiss}
    <div data-sidebar-panel-toolbar class={styles.toolbar()}>
      {#if toolbar}{@render toolbar()}
      {:else}
        {#if backHref}<Button href={backHref} variant="ghost" size="sm">{backLabel}</Button>{:else}<span></span>{/if}
        {#if ondismiss}<Button variant="ghost" size="sm" aria-label={`Close ${title}`} onclick={ondismiss}>Close</Button>{/if}
      {/if}
    </div>
  {/if}
  <div class={styles.header()}>
    <div class="flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]">
      <svelte:element this={`h${headingLevel}`} class="m-0 min-w-0 break-words text-heading">{title}</svelte:element>
      {#if badge !== undefined}<Badge tone={badgeTone} variant="filled" role="img" aria-label={badgeLabel ?? `${badge} notifications`}>{navigationBadge(badge)}</Badge>{/if}
      {#if status}<StatusIndicator label={status.label} tone={status.tone} showLabel={false} />{/if}
    </div>
    {#if actions}<div data-sidebar-panel-actions class={styles.actions()}>{@render actions()}</div>{/if}
  </div>
  {#if controls}<div data-sidebar-panel-controls class={styles.controls()}>{@render controls()}</div>{/if}
  <ScrollArea label={`${title} items`} variant="plain" class={styles.body()}>{@render children?.()}</ScrollArea>
  {#if footer}<div data-sidebar-panel-footer class={styles.footer()}>{@render footer()}</div>{/if}
</section>

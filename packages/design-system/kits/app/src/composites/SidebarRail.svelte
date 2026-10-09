<!-- A compact, externally selected application/workspace rail with roving focus. -->
<script lang="ts" module>
  import type { IconGlyph } from "@reddb-io/design-system/base";

  export interface SidebarRailItem {
    /** Stable identity emitted when this item is chosen. */
    id: string;
    /**
     * Accessible name and Tooltip content for the visually compact control. A tile that shows
     * initials is named `<initials>, <label>` unless `label` already holds them as words, so its
     * name starts with what it shows (WCAG 2.5.3).
     */
    label: string;
    /** Optional glyph rendered only through the Base Icon contract. */
    icon?: IconGlyph;
    /**
     * Initials or a short affordance such as "+" when no glyph is supplied; defaults to the first
     * two letters of `label`, upper-cased.
     */
    fallback?: string;
    /** Present but unavailable and omitted from the rail's roving focus order. */
    disabled?: boolean;
    /** Disclosure state when the selected rail item toggles an adjacent panel. */
    expanded?: boolean;
    /** Id of the adjacent panel controlled by this disclosure item. */
    controls?: string;
  }

  /** The text a glyph-less tile shows: its `fallback`, else the label's first two letters. */
  function face(item: SidebarRailItem): string {
    return item.fallback ?? item.label.slice(0, 2).toUpperCase();
  }

  const words = (text: string): string[] =>
    text.normalize("NFKD").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  /**
   * A tile's accessible name. WCAG 2.5.3 (Label in Name): a speech-input user
   * says what the tile shows, so visible initials lead the name unless the
   * label already holds them as words. A glyph or a symbol such as "+" shows
   * no words, and the label alone names it.
   */
  function nameOf(item: SidebarRailItem): string {
    if (item.icon) return item.label;
    const shown = words(face(item));
    if (shown.length === 0) return item.label;
    const named = words(item.label);
    const held = named.some((_, start) => shown.every((word, offset) => named[start + offset] === word));
    return held ? item.label : `${face(item)}, ${item.label}`;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { Icon, Tooltip } from "@reddb-io/design-system/base";
  import { warnDeprecated } from "@reddb-io/design-system/base";
  import { sidebarRail } from "./sidebar-rail.variants";

  interface Props extends Omit<HTMLAttributes<HTMLElement>, "class" | "onselect"> {
    /** Accessible name for this navigation landmark. */
    label: string;
    /** Caller-owned actions, organizations, and optional add affordance. */
    items: readonly SidebarRailItem[];
    /** Caller-owned current identity (ADR 0026); SidebarRail never changes it. */
    currentId?: string;
    /** @deprecated Renamed `currentId` (ADR 0026); removed next release. */
    selectedId?: string;
    /** Emits the chosen identity without retaining organization state. */
    onselect?: (id: string) => void;
    /** Brand or home control placed above the roving item collection. */
    top?: Snippet;
    /** Account control placed below the roving item collection. */
    bottom?: Snippet;
    /** Extra classes merged onto the navigation landmark. */
    class?: string;
  }

  let {
    label,
    items,
    currentId: currentIdProp,
    selectedId,
    onselect,
    top,
    bottom,
    class: className,
    ...rest
  }: Props = $props();

  const currentId = $derived(currentIdProp ?? selectedId);

  $effect(() => {
    if (selectedId !== undefined) warnDeprecated("SidebarRail", "selectedId", "currentId");
  });

  function initialFocusIndex(): number {
    const selected = items.findIndex((item) => item.id === currentId && !item.disabled);
    if (selected >= 0) return selected;
    const first = items.findIndex((item) => !item.disabled);
    return Math.max(first, 0);
  }

  let focusIndex = $state(initialFocusIndex());
  const styles = $derived(sidebarRail());

  $effect(() => {
    if (items[focusIndex] && !items[focusIndex]?.disabled) return;
    focusIndex = initialFocusIndex();
  });

  function controls(rail: HTMLElement): HTMLButtonElement[] {
    return [...rail.querySelectorAll<HTMLButtonElement>("[data-sidebar-rail-item]:not(:disabled)")];
  }

  function focusControl(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.dataset.sidebarRailItem) {
      return;
    }

    const available = controls(event.currentTarget as HTMLElement);
    const current = available.indexOf(event.target);
    if (current < 0) return;

    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % available.length;
    if (event.key === "ArrowUp") next = (current - 1 + available.length) % available.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = available.length - 1;
    if (next === undefined) return;

    event.preventDefault();
    const control = available[next]!;
    focusIndex = Number(control.dataset.sidebarRailIndex);
    control.focus();
  }

  function rememberFocusedControl(event: FocusEvent): void {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.dataset.sidebarRailItem) {
      return;
    }
    focusIndex = Number(event.target.dataset.sidebarRailIndex);
  }
</script>

<nav
  {...rest}
  aria-label={label}
  data-sidebar-rail
  class={styles.root({ class: className })}
  onkeydown={focusControl}
  onfocusin={rememberFocusedControl}
>
  <div data-sidebar-rail-region="top" class={styles.region()}>
    {@render top?.()}
  </div>

  <div data-sidebar-rail-region="middle" class={styles.region({ class: styles.middle() })}>
    <ul data-sidebar-rail-items class={styles.list()}>
      {#each items as item, index (item.id)}
        <li>
          <Tooltip
            label={nameOf(item)}
            content={item.label}
            disabled={item.disabled}
            tabindex={!item.disabled && index === focusIndex ? 0 : -1}
            aria-pressed={item.id === currentId}
            aria-expanded={item.expanded}
            aria-controls={item.controls}
            data-sidebar-rail-item={item.id}
            data-sidebar-rail-index={index}
            class={styles.item()}
            onclick={() => onselect?.(item.id)}
          >
            {#if item.icon}
              <Icon icon={item.icon} size="md" aria-hidden="true" />
            {:else}
              <span aria-hidden="true" class={styles.fallback()}>
                {face(item)}
              </span>
            {/if}
          </Tooltip>
        </li>
      {/each}
    </ul>
  </div>

  <div data-sidebar-rail-region="bottom" class={styles.region()}>
    {@render bottom?.()}
  </div>
</nav>

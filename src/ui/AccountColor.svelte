<script lang="ts">
  import { ACCOUNT_COLORS } from '../core/model';
  let { value = $bindable(1), label = 'Color' }: { value?: number; label?: string } = $props();
  const slots = Array.from({ length: ACCOUNT_COLORS }, (_, i) => i + 1);
</script>

<div class="swatches" role="radiogroup" aria-label={label}>
  {#each slots as n}
    <button type="button" class="swatch" class:on={value === n} style="background: var(--acc-{n})" role="radio" aria-checked={value === n} aria-label="{label} {n}" onclick={() => (value = n)}></button>
  {/each}
</div>

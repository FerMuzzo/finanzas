<script lang="ts">
  import { onMount } from 'svelte';
  import { app, init, startAutoLock } from './ui/app.svelte';
  import Icon from './ui/Icon.svelte';
  import Welcome from './ui/screens/Welcome.svelte';
  import CreateVault from './ui/screens/CreateVault.svelte';
  import RecoveryKey from './ui/screens/RecoveryKey.svelte';
  import Unlock from './ui/screens/Unlock.svelte';
  import Restore from './ui/screens/Restore.svelte';
  import Home from './ui/screens/Home.svelte';
  import Transactions from './ui/screens/Transactions.svelte';
  import Import from './ui/screens/Import.svelte';
  import Settings from './ui/screens/Settings.svelte';
  import Spending from './ui/screens/Spending.svelte';
  import Regular from './ui/screens/Regular.svelte';
  import AddSheet from './ui/AddSheet.svelte';
  import Charts from './ui/screens/Charts.svelte';

  onMount(() => {
    void init();
    startAutoLock();
  });

  const tabs = [
    { id: 'home', label: 'Overview', icon: 'home' },
    { id: 'spending', label: 'Spending', icon: 'pie' },
    { id: 'charts', label: 'Charts', icon: 'chart' },
    { id: 'regular', label: 'Regular', icon: 'repeat' },
    { id: 'transactions', label: 'Operations', icon: 'list' },
  ] as const;

  function go(id: (typeof tabs)[number]['id']) {
    app.tab = id;
    window.scrollTo({ top: 0 });
  }
</script>

{#if app.phase === 'loading'}
  <div class="page center"><span class="spinner" style="margin: 0 auto"></span></div>
{:else if app.phase === 'welcome'}
  <Welcome />
{:else if app.phase === 'create'}
  <CreateVault />
{:else if app.phase === 'recovery'}
  <RecoveryKey />
{:else if app.phase === 'locked'}
  <Unlock />
{:else if app.phase === 'restore'}
  <Restore />
{:else if app.phase === 'ready' && app.data}
  {#if app.demo}<div class="demo-banner">Demo with invented data. Nothing is saved.</div>{/if}
  {#if app.tab === 'home'}
    <Home />
  {:else if app.tab === 'spending'}
    <Spending />
  {:else if app.tab === 'charts'}
    <Charts />
  {:else if app.tab === 'regular'}
    <Regular />
  {:else if app.tab === 'transactions'}
    <Transactions />
  {:else if app.tab === 'import'}
    <Import />
  {:else}
    <Settings />
  {/if}
  {#if app.tab === 'home' || app.tab === 'transactions'}
    <button class="fab" aria-label="Add an expense or income" onclick={() => (app.adding = true)}>+</button>
  {/if}
  {#if app.adding}<AddSheet onclose={() => (app.adding = false)} />{/if}
  <nav class="nav">
    {#each tabs as t}
      <button class:on={app.tab === t.id} onclick={() => go(t.id)} aria-current={app.tab === t.id ? 'page' : undefined}>
        <Icon name={t.icon} />
        {t.label}
      </button>
    {/each}
  </nav>
{/if}

{#if app.toast}<div class="toast" role="status">{app.toast}</div>{/if}

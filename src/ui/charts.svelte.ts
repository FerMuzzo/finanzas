// Settings of the Charts tab, kept while you move between tabs.
export type ChartId = 'monthly' | 'stacked' | 'categories' | 'merchants' | 'accounts' | 'weekday' | 'sizes' | 'pace' | 'balances';

export const CHARTS: { id: ChartId; label: string }[] = [
  { id: 'monthly', label: 'Month by month' },
  { id: 'stacked', label: 'Categories over time' },
  { id: 'categories', label: 'By category' },
  { id: 'merchants', label: 'Top places' },
  { id: 'accounts', label: 'By account' },
  { id: 'weekday', label: 'Day of the week' },
  { id: 'sizes', label: 'Payment sizes' },
  { id: 'pace', label: 'Spending pace' },
  { id: 'balances', label: 'Account balances' },
];

export const chartState = $state({
  period: 'p6' as 'p3' | 'p6' | 'p12' | 'all' | 'custom',
  from: '',
  to: '',
  accountIds: [] as string[],
  categoryIds: [] as string[],
  kind: 'expense' as 'expense' | 'income',
  query: '',
  regular: 'all' as 'all' | 'only' | 'exclude',
  shown: ['monthly', 'categories', 'stacked'] as ChartId[],
  paceMonth: '',
  showFilters: true,
});

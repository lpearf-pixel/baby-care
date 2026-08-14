export type CareQuickAction = 'feeding' | 'diaper' | 'sleep';

export function QuickRecordBar({
  active,
  onSelect,
}: {
  active: CareQuickAction | null;
  onSelect: (action: CareQuickAction) => void;
}) {
  const actions: Array<{ id: CareQuickAction; label: string }> = [
    { id: 'feeding', label: '喂奶' },
    { id: 'diaper', label: '尿布' },
    { id: 'sleep', label: '睡觉/醒来' },
  ];
  return (
    <section className="quick-record" aria-label="快速记录">
      {actions.map((action) => (
        <button
          key={action.id}
          className={active === action.id ? 'primary quick-action' : 'secondary quick-action'}
          type="button"
          onClick={() => onSelect(action.id)}
        >
          {action.label}
        </button>
      ))}
    </section>
  );
}
